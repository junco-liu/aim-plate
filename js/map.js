/* ── the field map: a third content for the same plate ────
   The robot reports robot_x / robot_y / heading in every ws_status packet — the same
   numbers get_x_position() hands Python — so the map is a projection, not a new channel:
   nothing extra goes on the wire.

   Coordinates are odometry, not absolute: the origin is wherever the robot was when it
   powered on, or wherever a set_xy_position() from the code panel last put it — not the
   centre of the field, which is why the caption bar says so. Heading follows the robot's
   own convention — 0° is +Y, 90° is +X.

   Drawn as SVG in a fixed 320×240 viewBox, like the vision overlay: the browser scales
   it to the plate, the strokes are CSS so both themes come free, and the labels stay
   upright however far the field is turned. */

const TILE = 231.3;                      // one printed field tile, mm
const FIELD_TILES = { '2v2': [2, 3], '3v3': [3, 4] };   // [across, along]

const MVB_W = 320, MVB_H = 240, MPAD = 18;

let mapPreset = '3v3', mapRot = 0;

// [x span, y span] in mm. Custom is entered in mm and clamped to something drawable.
const fieldSize = () => mapPreset === 'custom'
  ? [Math.min(9999, Math.max(TILE / 2, +$('mapFx').value || TILE * 3)),
     Math.min(9999, Math.max(TILE / 2, +$('mapFy').value || TILE * 4))]
  : FIELD_TILES[mapPreset].map(n => n * TILE);

/* One rotation matrix instead of a case per view angle: the four buttons only ever ask
   for multiples of 90°, but the scale is then fitted from the turned field's own extents,
   so nothing has to know which side is long at which angle. */
function mapXform(fx, fy) {
  const rad = mapRot * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  // base view is landscape: screen right is world +Y, screen down is world +X
  const rot = (x, y) => [y * c + x * s, -y * s + x * c];
  const corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => rot(i * fx / 2, j * fy / 2));
  const ex = Math.max(...corner.map(p => Math.abs(p[0]))) * 2;
  const ey = Math.max(...corner.map(p => Math.abs(p[1]))) * 2;
  const k = Math.min((MVB_W - MPAD * 2) / ex, (MVB_H - MPAD * 2) / ey);
  return {
    pt: (x, y) => { const [u, v] = rot(x, y); return [MVB_W / 2 + u * k, MVB_H / 2 + v * k]; },
    vec: rot,      // a world direction turns the same way the field does
  };
}

function drawMap() {
  if (!body.classList.contains('tab-map')) return;   // 5 packets a second: don't paint what's hidden

  const [fx, fy] = fieldSize();
  const { pt, vec } = mapXform(fx, fy);
  const p = (x, y) => pt(x, y).map(n => n.toFixed(1)).join(',');
  const seg = (x1, y1, x2, y2, cls) => {
    const [a, b] = pt(x1, y1), [c, d] = pt(x2, y2);
    return `<line x1="${a.toFixed(1)}" y1="${b.toFixed(1)}" x2="${c.toFixed(1)}" y2="${d.toFixed(1)}" class="${cls}"/>`;
  };

  let g = `<polygon class="mfield" points="${
    [[-fx / 2, -fy / 2], [fx / 2, -fy / 2], [fx / 2, fy / 2], [-fx / 2, fy / 2]]
      .map(([x, y]) => p(x, y)).join(' ')}"/>`;

  // tile grid, counted rather than stepped by a float so the last line never doubles the edge
  for (let i = 1; i * TILE < fx - 0.5; i++) g += seg(-fx / 2 + i * TILE, -fy / 2, -fx / 2 + i * TILE, fy / 2, 'mgrid');
  for (let i = 1; i * TILE < fy - 0.5; i++) g += seg(-fx / 2, -fy / 2 + i * TILE, fx / 2, -fy / 2 + i * TILE, 'mgrid');
  g += seg(-fx / 2, 0, fx / 2, 0, 'maxis') + seg(0, -fy / 2, 0, fy / 2, 'maxis');

  const r = body.classList.contains('live') ? lastStatus?.robot : null;

  if (!r) {
    g += `<text class="mhint" x="${MVB_W / 2}" y="${MVB_H / 2 - 6}" text-anchor="middle">${
      body.classList.contains('live') ? t('等待坐标…') : t('未连接')}</text>`;
  } else {
    const x = +r.robot_x, y = +r.robot_y, h = +r.heading;
    const [px, py] = pt(x, y);
    const rad = h * Math.PI / 180;
    const [dx, dy] = vec(Math.sin(rad), Math.cos(rad));   // heading 0° = +Y, 90° = +X
    g += `<line class="mdir" x1="${px.toFixed(1)}" y1="${py.toFixed(1)}"
             x2="${(px + dx * 22).toFixed(1)}" y2="${(py + dy * 22).toFixed(1)}"/>` +
         `<circle class="mbot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5.5"/>` +
         `<text class="mtag" x="${(px + 9).toFixed(1)}" y="${(py - 6).toFixed(1)}">${
            Math.round(x)}, ${Math.round(y)}</text>` +
         `<text class="mtag" x="${(px + 9).toFixed(1)}" y="${(py + 5).toFixed(1)}">${
            Math.round(h)}°</text>`;
  }

  $('mlay').innerHTML = g;
  $('mapMeta').textContent = `${Math.round(fx)} × ${Math.round(fy)} mm · ` +
    t('视角 {0}°', mapRot) +
    (r ? ` · ${Math.round(+r.robot_x)}, ${Math.round(+r.robot_y)} · ${Math.round(+r.heading)}°` : '');
}
onLang.push(drawMap);

/* ── controls ─────────────────────────────────────────── */

const MAP_SIZES = { '2v2': 'mSize2', '3v3': 'mSize3', custom: 'mSizeC' };

function setMapSize(k) {
  mapPreset = k;
  for (const n in MAP_SIZES) $(MAP_SIZES[n]).classList.toggle('on', n === k);
  drawMap();
}
$('mSize2').onclick = () => { popOpen(false); setMapSize('2v2'); };
$('mSize3').onclick = () => { popOpen(false); setMapSize('3v3'); };

/* 自定义 is two steps rather than two boxes that sit on the bar forever: the sheet opens
   filled with whatever the field measures now, and only 确定 applies it. */
function popOpen(on) {
  $('mapPop').hidden = !on;
  $('mSizeC').setAttribute('aria-expanded', on);
  if (!on) return;
  const [fx, fy] = fieldSize();
  $('mapFx').value = Math.round(fx);
  $('mapFy').value = Math.round(fy);
  $('mapFx').focus(); $('mapFx').select();
}
$('mSizeC').onclick = () => popOpen($('mapPop').hidden);
$('mapPop').onsubmit = e => { e.preventDefault(); setMapSize('custom'); popOpen(false); };
$('mapPop').onkeydown = e => { if (e.key === 'Escape') { popOpen(false); $('mSizeC').focus(); } };
// anywhere else on the page dismisses it, the way a menu does
document.addEventListener('pointerdown', e => {
  if ($('mapPop').hidden) return;
  // a pointerdown can land on something that is not an Element — the document itself has
  // no closest(), and letting that throw would leave the sheet stuck open
  if (!(e.target instanceof Element) || !e.target.closest('#mapPop, #mSizeC')) popOpen(false);
});

const turnMap = d => { mapRot = (mapRot + d + 360) % 360; drawMap(); };
$('mapCcw').onclick = () => turnMap(-90);
$('mapCw').onclick = () => turnMap(90);
