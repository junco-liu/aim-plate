/* ── wiring ─────────────────────────────────────────────── */

const setTab = scr => {
  body.classList.toggle('tab-scr', scr);
  $('tabScr').classList.toggle('on', scr); $('tabCam').classList.toggle('on', !scr);
  $('tabScr').setAttribute('aria-selected', scr); $('tabCam').setAttribute('aria-selected', !scr);
  $('scrMeta').hidden = !scr;
  if (scr) $('grpScreen').open = true;   // the tab is useless without its controls
};
$('tabCam').onclick = () => setTab(false);
$('tabScr').onclick = () => setTab(true);

const MODES = { pen: 'mPen', img: 'mImg', emo: 'mEmo' };
const setMode = m => {
  for (const k in MODES) {
    body.classList.toggle('m-' + k, k === m);
    $(MODES[k]).classList.toggle('on', k === m);
  }
};
for (const k in MODES) $(MODES[k]).onclick = () => setMode(k);
setMode('pen');

let rq;
const reRender = () => { cancelAnimationFrame(rq); rq = requestAnimationFrame(renderImage); };

$('penW').oninput = e => $('penWv').textContent = e.target.value + ' px';
$('nCol').oninput = e => { $('nColv').textContent = e.target.value; reRender(); };
$('zoom').oninput = e => { $('zoomv').textContent = e.target.value + '%'; reRender(); };
$('bgColor').oninput = () => { if (img.el) reRender(); };

$('scrSend').onclick = () => quiet(runOps(drawOps(scrOps)));
$('scrStop').onclick = () => { abort = true; };
$('scrClear').onclick = () => {
  scrFill($('bgColor').value);
  scrOps = []; showCost();
  quiet(runOps(drawOps([{ cmd_id: 'lcd_clear_screen', ...rgb($('bgColor').value) }])));
};

/* ── AI vision ────────────────────────────────────────────
   The aivision block rides along in every ws_status packet whether we look at
   it or not, so filtering in the browser saves nothing on the wire. The only
   real lever is upstream: unchecking a family sends tag_detection /
   model_detection false and the robot stops producing those objects at all. */

const SIGS = {
  // AprilTag starts unticked because that is the robot's own default — it is not
  // detecting tags until asked. Ticking the box sends tag_detection true.
  tag:          { label: 'AprilTag', c: '#E0A800', off: true },
  Robot:        { label: '机器人',   c: '#B23BA6' },   // label goes through t()
  BlueBarrel:   { label: '蓝桶',     c: '#2F6FD0' },
  OrangeBarrel: { label: '橙桶',     c: '#DB6A1E' },
  SportsBall:   { label: '球',       c: '#2E9E5B' },
};
const MODEL_SIGS = ['Robot', 'BlueBarrel', 'OrangeBarrel', 'SportsBall'];

$('sigs').innerHTML = Object.entries(SIGS).map(([k, v]) => `
  <label class="sig"><input type="checkbox" class="need" data-sig="${k}" disabled${v.off ? '' : ' checked'}>
    <i style="background:${v.c}"></i><span>${t(v.label)}</span><b id="n_${k}">0</b></label>`).join('');

const sigOn = k => $('sigs').querySelector(`[data-sig="${k}"]`).checked;

// type is the object-type bitmask from aim.py: 1 colour, 2 code, 4 AI model, 8 tag
function visionParse(v) {
  const names = {};
  for (const c of v?.classnames?.items ?? []) names[c.index] = c.name;
  const items = v?.objects?.items ?? [];
  const out = [];
  for (let i = 0; i < Math.min(+v?.objects?.count || 0, items.length); i++) {
    const o = items[i], t = +o.type;
    const x = +o.originx, y = +o.originy, w = +o.width, h = +o.height;
    const cx = x + w / 2, cy = y + h / 2;
    out.push({
      kind: t & 8 ? 'tag' : t & 4 ? (names[o.id] ?? o.name ?? `AI${o.id}`)
                          : t & 2 ? 'code' : 'color',
      id: +o.id, x, y, w, h, cx, cy,
      score: o.score === undefined ? null : +o.score,
      // tags report degrees; colour and code angles arrive in centi-degrees
      rot: t & 8 ? (+o.angle || 0) : (+o.angle || 0) * 0.01,
      // a tag also reports its four corners, which show the skew a box can't
      quad: o.x0 === undefined ? null
            : [0, 1, 2, 3].map(k => `${+o['x' + k]},${+o['y' + k]}`).join(' '),
      // same polynomial the Python client uses to turn frame pixels into a bearing
      bearing: -34.656 + cx * 0.22539 + cy * 0.011526
               + cx * cx * -0.000042011 + cx * cy * 0.000010433 + cy * cy * -0.00007073,
    });
  }
  return out;
}

/* The rows and the boxes are the same list in the same order — largest first, because
   the nearest thing usually matters most and the panel then needs no sort control.
   hovI ties them together: hovering a row thickens its box on the plate. */
let lastObjs = [], hovI = null;

function visionRender(objs) {
  lastObjs = objs;
  for (const k in SIGS) $('n_' + k).textContent = objs.filter(o => o.kind === k).length;

  const shown = objs.filter(o => SIGS[o.kind] && sigOn(o.kind))
                    .sort((a, b) => b.w * b.h - a.w * a.h);
  const name = o => o.kind === 'tag' ? `TAG ${o.id}` : SIGS[o.kind].label;

  $('vlay').innerHTML = !body.classList.contains('vlay') ? '' : shown.map((o, i) => {
    const c = SIGS[o.kind].c, w = i === hovI ? 3 : 1.6;
    return (o.quad ? `<polygon data-i="${i}" points="${o.quad}" fill="none" stroke="${c}" stroke-width="${w}"/>`
                   : `<rect data-i="${i}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="none" stroke="${c}" stroke-width="${w}"/>`)
         + `<text x="${o.x}" y="${Math.max(9, o.y - 3)}" fill="${c}">${name(o)}</text>`;
  }).join('');

  // the panel is hidden with the annotation off — nobody is reading the rows
  if (!body.classList.contains('vlay')) return;
  $('vcount').textContent = t('目标 {0}', shown.length);
  $('vempty').hidden = shown.length > 0;
  $('vrows').innerHTML = shown.map((o, i) => `<div class="vrow" data-i="${i}">
      <i style="background:${SIGS[o.kind].c}"></i>
      <span class="nm">${name(o)}</span>
      <span class="cen">${Math.round(o.cx)}, ${Math.round(o.cy)}</span>
      <span class="org">${o.x}, ${o.y}</span>
      <span class="size">${o.w} × ${o.h}</span>
      <span class="bear">${o.bearing.toFixed(1)}°</span>
      <span class="rot">${o.rot.toFixed(1)}°</span>
      <span class="sco">${o.score ?? '—'}</span>
    </div>`).join('');
}

// Straight at the attribute rather than a re-render: the next status packet is up to
// 200ms away, and a hover has to answer now.
function setHov(i) {
  hovI = i === null ? null : +i;
  for (const el of $('vlay').querySelectorAll('[data-i]'))
    el.setAttribute('stroke-width', +el.dataset.i === hovI ? 3 : 1.6);
}
$('vrows').onmouseover = e => setHov(e.target.closest('.vrow')?.dataset.i ?? null);
$('vrows').onmouseleave = () => setHov(null);

$('vtog').onclick = () => {
  const open = body.classList.toggle('vexp');
  $('vtog').setAttribute('aria-expanded', open);
};

onLang.push(() => visionRender(lastObjs));   // the count is the one label JS writes

// Push the checkbox state upstream so unwanted families are never detected.
// One request at a time — ws_cmd is request/response and the robot answers in order.
async function syncDetection(family) {
  if (cmdWs?.readyState !== 1) return;
  if (family === 'tag') await quiet(send({ cmd_id: 'tag_detection', b_enable: sigOn('tag') }));
  else await quiet(send({ cmd_id: 'model_detection', b_enable: MODEL_SIGS.some(sigOn) }));
}

$('sigs').onchange = e => syncDetection(e.target.dataset.sig === 'tag' ? 'tag' : 'model');
$('vToggle').onchange = e => {
  body.classList.toggle('vlay', e.target.checked);
  if (!e.target.checked) { $('vlay').innerHTML = ''; return; }
  // boxes over an empty plate look like the annotation killed the feed — it didn't,
  // the feed is simply off, and only the plate can say so
  if (!body.classList.contains('streaming') && body.classList.contains('live'))
    placeholder(t('标注已开启，画面未开启'),
                t('标注走的是状态包，不需要视频流。想同时看画面，请拨动左边的「画面」开关。'),
                t('已连接'), t('仅标注'));
};

/* ── commands ─────────────────────────────────────────── */

/* The sliders read out percent, the unit the official API takes, and the same two
   factors convert it: 100% is 200 mm/s and 180 deg/s. The wire still carries absolutes. */
const DRIVE_PCT_TO_MMPS = 2, TURN_PCT_TO_DPS = 1.8;
const drive = angle => send({ cmd_id: 'drive', angle,
  speed: Math.round(+$('speed').value * DRIVE_PCT_TO_MMPS), stacking_type: 0 });
const spin  = dir   => send({ cmd_id: 'turn',
  turn_rate: dir * Math.round(+$('turn').value * TURN_PCT_TO_DPS), stacking_type: 0 });
const halt  = async () => {
  await send({ cmd_id: 'drive', angle: 0, speed: 0, stacking_type: 0 });
  await send({ cmd_id: 'turn', turn_rate: 0, stacking_type: 0 });
};
const quiet = p => p?.catch(() => {});

$('connect').onclick = connect;
$('disconnect').onclick = disconnect;
$('estop').onclick = () => { quiet(halt()); log(t('急停')); };
$('ip').onkeydown = e => { if (e.key === 'Enter') connect(); };  // no bare `&&` — a falsy return cancels the keypress

$('speed').oninput = e => $('speedv').textContent = e.target.value + '%';
$('turn').oninput  = e => $('turnv').textContent  = e.target.value + '%';

$('camToggle').onchange = e => {
  if (e.target.checked) {
    if (!imgWs || imgWs.readyState > 1) openImg();        // never opened, or the last one died
    else if (imgWs.readyState === 1) imgWs.send(new Uint8Array([1]));
    return;                                              // still CONNECTING: onopen starts it
  }
  if (imgWs?.readyState === 1) imgWs.send(new Uint8Array([0]));
  body.classList.remove('streaming');
  placeholder(t('画面已关闭'), body.classList.contains('vlay')
    ? t('标注还在跑，画的是同一批数据。把「画面」开关拨开即可恢复实时画面。')
    : t('把图注条上的「画面」开关拨开即可恢复。'), t('已连接'), t('画面已关闭'));
};

const rgb = h => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16),
                    b: parseInt(h.slice(5, 7), 16) });

$('ledOn').onclick = () => quiet(send({ cmd_id: 'light_set', [$('led').value]: rgb($('color').value) }));
$('ledOff').onclick = () => quiet(send({ cmd_id: 'light_set', [$('led').value]: { r: 0, g: 0, b: 0 } }));

document.querySelectorAll('[data-cmd]').forEach(b =>
  b.onclick = () => quiet(send({ cmd_id: b.dataset.cmd })));

document.querySelectorAll('[data-go],[data-spin],[data-halt]').forEach(b => {
  const go = () => quiet(b.dataset.halt ? halt()
    : 'go' in b.dataset ? drive(+b.dataset.go) : spin(+b.dataset.spin));
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); go(); });
  b.addEventListener('pointerup', () => { if (!b.dataset.halt) quiet(halt()); });
  b.addEventListener('pointercancel', () => { if (!b.dataset.halt) quiet(halt()); });
});

// ev.key.toLowerCase() turns 'ArrowUp' into 'arrowup', so both sets share one table
const keys = { w: () => drive(0),      s: () => drive(180),
               a: () => drive(-90),    d: () => drive(90),
               arrowup: () => drive(0), arrowdown: () => drive(180),
               arrowleft: () => drive(-90), arrowright: () => drive(90),
               q: () => spin(-1), e: () => spin(1), ' ': halt };
let held = null;
addEventListener('keydown', ev => {
  if (ev.target.matches('input, select, textarea')) return;
  const k = ev.key.toLowerCase();
  if (!keys[k] || held === k || !body.classList.contains('live')) return;
  held = k; ev.preventDefault(); quiet(keys[k]());
});
addEventListener('keyup', ev => {
  if (held !== ev.key.toLowerCase()) return;
  held = null;
  if (ev.key !== ' ') quiet(halt());
});
addEventListener('blur', () => { if (held) { held = null; quiet(halt()); } });
addEventListener('pagehide', closeAll);   // a closed tab must stop the stream too
