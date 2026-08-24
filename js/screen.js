/* ── the robot's screen ───────────────────────────────────
   240×240 coordinates over a circular r=120 panel. Per-pixel is not an option:
   45,239 pixels are visible and lcd_draw_pixel carries no colour of its own, so a
   multi-colour image would need a set_pen_color between most of them — call it 90k
   round trips on a socket that answers one request at a time.

   What works: quantise, run-length encode each row, merge runs that stack, then group
   by colour. lcd_draw_rectangle carries r,g,b for its fill but outlines in the current
   pen colour — grouping by colour means one lcd_set_pen_color per colour (not per run)
   and the outline lands on top of an identical fill. */

const SCR = 240, SCR_R = 120;
const scrCv = $('scrCv');
scrCv.width = scrCv.height = SCR;
const scrCtx = scrCv.getContext('2d', { willReadFrequently: true });

let scrOps = [];        // what the current image would cost to send
let sendRate = null;    // ms per command, measured on the wire — never guessed
let busy = false, abort = false;

function scrFill(hex) { scrCtx.fillStyle = hex; scrCtx.fillRect(0, 0, SCR, SCR); }
scrFill('#000000');

const scrPos = e => {
  const b = scrCv.getBoundingClientRect();
  return { x: (e.clientX - b.left) / b.width * SCR, y: (e.clientY - b.top) / b.height * SCR };
};

const fmtSec = s => s >= 60 ? t('{0} 分 {1} 秒', Math.floor(s / 60), Math.round(s % 60))
                            : t('{0} 秒', Math.max(1, Math.round(s)));

/* One request in flight, always — the same discipline the Python client keeps. Which is
   why a whole-image send is tens of thousands of round trips: minutes, not seconds. So
   the count, the share and the remaining time are all shown live, and the rate is
   re-measured as it goes rather than trusting the one stored from last time. */
async function runOps(ops) {
  // no link: the caller's local repaint already happened, and pressing on would only
  // flash an empty progress bar. Every caller routes through here, so one guard does.
  if (busy || !ops.length || cmdWs?.readyState !== 1) return;
  busy = true; abort = false;
  $('scrStop').disabled = false; $('scrSend').disabled = true;
  $('scrBar').hidden = $('scrProg').hidden = false;
  const t0 = performance.now();
  let i = 0;
  for (; i < ops.length; i++) {
    if (abort || cmdWs?.readyState !== 1) break;
    try { await send(ops[i]); } catch { break; }
    if ((i & 15) === 0) {
      const done = (i + 1) / ops.length;
      $('barFill').style.width = (done * 100) + '%';
      const rate = i > 8 ? (performance.now() - t0) / (i + 1) : sendRate;
      $('scrProg').textContent =
        t('{0} / {1} 条 · {2}%', (i + 1).toLocaleString(),
          ops.length.toLocaleString(), Math.round(done * 100)) +
        (rate ? t(' · 约剩 {0}', fmtSec((ops.length - i - 1) * rate / 1000)) : '');
    }
  }
  const dt = performance.now() - t0;
  if (i > 20) sendRate = dt / i;            // calibrate on the real link, then reuse
  $('barFill').style.width = '0';
  $('scrBar').hidden = $('scrProg').hidden = true;
  $('scrProg').textContent = '';       // or the next send flashes this one's last figure
  busy = false; $('scrStop').disabled = true;
  $('scrSend').disabled = !body.classList.contains('live') || !scrOps.length;
  if (i && ops.length > 8) log(t('屏幕：发出 {0}/{1} 条，用时 {2}s', i, ops.length, (dt / 1000).toFixed(1)) +
                               (abort ? t('（已取消）') : ''), abort || i < ops.length);
  showCost();
}

const showCost = () => $('cost').textContent = !scrOps.length
  ? t('选一张图片。拖动图版可平移，滚轮缩放。')
  : t('{0} 条命令', scrOps.length.toLocaleString()) +
    (sendRate ? t(' · 约 {0} 秒', Math.max(1, Math.round(scrOps.length * sendRate / 1000)))
              : t(' · 首次发送后才会估时'));
onLang.push(showCost);

/* ── pen: draw on the plate, send on pointer-up ─────────── */

let stroke = null, pan = null;

scrCv.onpointerdown = e => {
  if (body.classList.contains('m-emo')) return;
  scrCv.setPointerCapture(e.pointerId);
  if (body.classList.contains('m-img')) { pan = { ...scrPos(e), ox: img.ox, oy: img.oy }; return; }
  const p = scrPos(e);
  const col = $('penTool').value === 'eraser' ? $('bgColor').value : $('penColor').value;
  stroke = { pts: [p], col, w: +$('penW').value };
  scrCtx.strokeStyle = col;
  scrCtx.lineWidth = stroke.w;
  scrCtx.lineCap = scrCtx.lineJoin = 'round';
};

scrCv.onpointermove = e => {
  const p = scrPos(e);
  if (pan) {
    img.ox = pan.ox + (p.x - pan.x); img.oy = pan.oy + (p.y - pan.y);
    reRender();
    return;
  }
  if (!stroke) return;
  const a = stroke.pts[stroke.pts.length - 1];
  if (Math.hypot(p.x - a.x, p.y - a.y) < 2) return;   // coalesce: one command per 2px
  stroke.pts.push(p);
  scrCtx.beginPath(); scrCtx.moveTo(a.x, a.y); scrCtx.lineTo(p.x, p.y); scrCtx.stroke();
};

scrCv.onpointerup = () => {
  pan = null;
  if (!stroke) return;
  const s = stroke; stroke = null;
  if (s.pts.length < 2 || cmdWs?.readyState !== 1) return;
  const r = Math.round;
  quiet(runOps(drawOps([
    { cmd_id: 'lcd_set_pen_width', width: s.w },
    { cmd_id: 'lcd_set_pen_color', ...rgb(s.col) },
    ...s.pts.slice(1).map((p, i) => ({ cmd_id: 'lcd_draw_line',
      x1: r(s.pts[i].x), y1: r(s.pts[i].y), x2: r(p.x), y2: r(p.y) })),
  ])));
};
scrCv.onpointercancel = scrCv.onpointerup;

/* ── image: crop, quantise, encode ──────────────────────── */

const img = { el: null, ox: 0, oy: 0 };

$('pick').onclick = () => $('file').click();
$('file').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const el = new Image();
  el.onload = () => { img.el = el; fitImage(); };
  el.onerror = () => log(t('这张图片读不出来'), true);
  el.src = URL.createObjectURL(f);
};

function fitImage() {
  img.ox = img.oy = 0;
  $('zoom').value = 100;
  renderImage();
}
$('fit').onclick = fitImage;

// scale that makes the image cover the 240 square; zoom multiplies it
const coverK = () => Math.max(SCR / img.el.width, SCR / img.el.height);

/* Wheel zooms about the pointer, so framing a crop is one gesture instead of
   zoom-then-drag-then-zoom. Non-passive: the rail must not scroll under the cursor. */
scrCv.addEventListener('wheel', e => {
  if (!img.el || !body.classList.contains('m-img')) return;
  e.preventDefault();
  const box = $('zoom'), z0 = +box.value;
  const z1 = Math.min(+box.max, Math.max(+box.min,
    Math.round(z0 * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
  if (z1 === z0) return;
  const p = scrPos(e), k0 = coverK() * z0 / 100, k1 = coverK() * z1 / 100;
  // hold the pixel under the cursor still: it sits (c - start) / k0 into the image
  const hold = (c, o, len) =>
    c - (c - ((SCR - len * k0) / 2 + o)) / k0 * k1 - (SCR - len * k1) / 2;
  img.ox = hold(p.x, img.ox, img.el.width);
  img.oy = hold(p.y, img.oy, img.el.height);
  box.value = z1;
  reRender();
}, { passive: false });

// Median cut: split the box with the widest channel until we have n of them. The
// standard answer for "pick n colours from this image", and barely longer than the
// naive popularity histogram that falls apart on anything but flat art.
function medianCut(px, n) {
  let boxes = [px];
  const span = b => {
    const lo = [255, 255, 255], hi = [0, 0, 0];
    for (const p of b) for (let c = 0; c < 3; c++) {
      if (p[c] < lo[c]) lo[c] = p[c];
      if (p[c] > hi[c]) hi[c] = p[c];
    }
    return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  };
  while (boxes.length < n) {
    boxes.sort((a, b) => Math.max(...span(b)) - Math.max(...span(a)));
    const b = boxes[0];
    if (b.length < 2) break;
    const sp = span(b), ch = sp.indexOf(Math.max(...sp));
    b.sort((p, q) => p[ch] - q[ch]);
    boxes.splice(0, 1, b.slice(0, b.length >> 1), b.slice(b.length >> 1));
  }
  return boxes.map(b => {
    const sum = [0, 0, 0];      // not `t` — that name is the translator
    for (const p of b) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
    return sum.map(v => Math.round(v / b.length));
  });
}

function renderImage() {
  if (!img.el) return;
  const z = +$('zoom').value / 100;
  // cover the 240 square at zoom 1, then pan/zoom on top
  const k = coverK() * z;
  const w = img.el.width * k, h = img.el.height * k;
  scrFill($('bgColor').value);
  scrCtx.drawImage(img.el, (SCR - w) / 2 + img.ox, (SCR - h) / 2 + img.oy, w, h);

  const id = scrCtx.getImageData(0, 0, SCR, SCR), d = id.data;
  const sample = [];
  for (let i = 0; i < d.length; i += 4 * 7) sample.push([d[i], d[i + 1], d[i + 2]]);
  const pal = medianCut(sample, +$('nCol').value);

  const idx = new Int16Array(SCR * SCR);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let best = 0, bd = Infinity;
    for (let c = 0; c < pal.length; c++) {
      const dr = d[i] - pal[c][0], dg = d[i + 1] - pal[c][1], db = d[i + 2] - pal[c][2];
      const q = dr * dr + dg * dg + db * db;
      if (q < bd) { bd = q; best = c; }
    }
    idx[j] = best;
    d[i] = pal[best][0]; d[i + 1] = pal[best][1]; d[i + 2] = pal[best][2];
  }
  scrCtx.putImageData(id, 0, 0);
  scrOps = encode(idx, pal);
  showCost();
  $('scrSend').disabled = busy || !body.classList.contains('live');
}

function encode(idx, pal) {
  const runs = [];
  for (let y = 0; y < SCR; y++) {
    // clip each row to the visible circle — the corners are 21% of the square
    const dy = y + 0.5 - SCR_R, dx = Math.floor(Math.sqrt(Math.max(0, SCR_R * SCR_R - dy * dy)));
    const x0 = SCR_R - dx, x1 = SCR_R + dx;
    if (x1 <= x0) continue;
    let s = x0, c = idx[y * SCR + x0];
    for (let x = x0 + 1; x <= x1; x++) {
      const v = x < x1 ? idx[y * SCR + x] : -1;
      if (v !== c) { runs.push({ x: s, y, w: x - s, h: 1, c }); s = x; c = v; }
    }
  }
  // stack runs that sit directly on top of each other with the same span and colour
  runs.sort((a, b) => a.x - b.x || a.w - b.w || a.c - b.c || a.y - b.y);
  const box = [];
  for (const r of runs) {
    const p = box[box.length - 1];
    if (p && p.x === r.x && p.w === r.w && p.c === r.c && p.y + p.h === r.y) p.h++;
    else box.push({ ...r });
  }
  // one lcd_set_pen_color per colour, not per rectangle
  box.sort((a, b) => a.c - b.c);
  const ops = [{ cmd_id: 'lcd_clear_screen', ...rgb($('bgColor').value) },
               { cmd_id: 'lcd_set_pen_width', width: 1 }];
  let cur = -1;
  for (const r of box) {
    const p = pal[r.c];
    if (r.c !== cur) { cur = r.c; ops.push({ cmd_id: 'lcd_set_pen_color', r: p[0], g: p[1], b: p[2] }); }
    ops.push({ cmd_id: 'lcd_draw_rectangle', x: r.x, y: r.y, width: r.w, height: r.h,
               r: p[0], g: p[1], b: p[2], b_transparency: false });
  }
  return ops;
}

/* ── emoji: the robot has 36 built in, one command each ─── */

// index === the robot's EmojiType value, and the preview file is `${i+1}-${name}.png`
const EMOJI = ['EXCITED', 'CONFIDENT', 'SILLY', 'AMAZED', 'STRONG', 'THRILLED', 'HAPPY',
  'PROUD', 'LAUGHING', 'OPTIMISTIC', 'DETERMINED', 'AFFECTIONATE', 'CALM', 'QUIET', 'SHY',
  'CHEERFUL', 'LOVED', 'SURPRISED', 'THINKING', 'TIRED', 'CONFUSED', 'BORED', 'EMBARRASSED',
  'WORRIED', 'SAD', 'SICK', 'DISAPPOINTED', 'NERVOUS', 'ANNOYED', 'STRESSED', 'ANGRY',
  'FRUSTRATED', 'JEALOUS', 'SHOCKED', 'FEAR', 'DISGUST'];
const EMOJI_CN = ['兴奋', '自信', '调皮', '惊叹', '强壮', '激动', '开心', '得意', '大笑',
  '乐观', '坚定', '喜爱', '平静', '安静', '害羞', '愉快', '被爱', '惊讶', '思考', '困倦',
  '困惑', '无聊', '尴尬', '担心', '难过', '生病', '失望', '紧张', '烦躁', '压力', '生气',
  '沮丧', '嫉妒', '震惊', '害怕', '厌恶'];
const LOOK_CN = ['正面', '向左', '向右'];
const emoUrl = i => `https://api.vex.com/aim/_images/${i + 1}-${EMOJI[i].toLowerCase()}.png`;
// the robot's own EmojiType names are already English, so English mode title-cases those
// rather than carrying 36 more dictionary rows
const emoName = i => lang === 'en'
  ? EMOJI[i][0] + EMOJI[i].slice(1).toLowerCase()
  : EMOJI_CN[i];

let emoOn = null, emoLook = 0;

const renderEmos = () => $('emos').innerHTML = EMOJI.map((n, i) => `
  <button class="emo" data-i="${i}" title="${n}">
    <img src="${emoUrl(i)}" alt="" loading="lazy" onerror="this.remove()">
    <span>${emoName(i)}</span>
  </button>`).join('');
renderEmos();
onLang.push(() => { renderEmos(); paintEmoji(); });

$('emoView').onload  = () => body.classList.remove('emo-nopic');
$('emoView').onerror = () => body.classList.add('emo-nopic');   // no internet: show the name

function paintEmoji() {
  const on = emoOn !== null;
  body.classList.toggle('emo-on', on);
  [...$('emos').children].forEach((b, k) => b.classList.toggle('on', on && k === emoOn));
  $('emoOff').disabled = !on;      // hiding it locally works with no link
  $('scrMeta').textContent = on
    ? t('表情 · {0} · {1}', emoName(emoOn), t(LOOK_CN[emoLook]))
    : t('240 × 240 · 可见区 r=120');
  if (!on) return;
  $('emoLbl').textContent = `${emoName(emoOn)} · ${t(LOOK_CN[emoLook])}`;
  const u = emoUrl(emoOn);
  if ($('emoView').getAttribute('src') !== u) $('emoView').src = u;
}

// The emoji covers whatever the screen has drawn, so anything that draws has to clear it
// first — otherwise the commands land and the screen visibly does nothing.
function drawOps(ops) {
  if (emoOn === null) return ops;
  emoOn = null; paintEmoji();
  return [{ cmd_id: 'hide_emoji' }, ...ops];
}

$('emos').onclick = e => {
  const b = e.target.closest('.emo');
  if (!b || busy) return;
  emoOn = +b.dataset.i; paintEmoji();
  quiet(runOps([{ cmd_id: 'show_emoji', name: emoOn, look: emoLook }]));
};

$('looks').onclick = e => {
  const b = e.target.closest('.segb');
  if (!b || busy) return;
  emoLook = +b.dataset.look;
  [...$('looks').children].forEach(x => x.classList.toggle('on', x === b));
  paintEmoji();
  if (emoOn !== null) quiet(runOps([{ cmd_id: 'show_emoji', name: emoOn, look: emoLook }]));
};

$('emoOff').onclick = () => {
  if (busy) return;
  emoOn = null; paintEmoji();
  quiet(runOps([{ cmd_id: 'hide_emoji' }]));
};
