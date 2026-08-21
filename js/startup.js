/* Chrome 147+ gates local-network access (including WebSockets) behind a permission that is
   only granted to secure contexts. A plain-HTTP page on a public domain can never obtain it,
   so that origin can never reach the robot — no user action helps. Loopback and LAN origins
   are not restricted at all. */
const LAN = /^(localhost|127\.|\[?::1\]?|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/i;
const isSecure = window.isSecureContext;
const originIsLocal = LAN.test(location.hostname) || location.protocol === 'file:';

if (!isSecure && !originIsLocal) {
  $('alertBody').innerHTML =
    '<b>此页面通过明文 HTTP 从公网域名打开，Chrome 会拒绝它连接局域网设备。</b>' +
    '<ol><li>改用 <code>https://</code> 打开本页，连接时在弹出的「访问本地网络设备」中点<b>允许</b></li>' +
    '<li>或把本页放在局域网内提供服务（如 <code>http://192.168.x.x:8099</code>）</li>' +
    '<li>或下载 index.html 本地双击打开</li></ol>';
  $('alert').classList.add('show');
}

/* ?selftest=1 — the robot's listener backlog is small, so a leaked socket per retry bricks it.
   Stubs WebSocket and asserts retries don't stack and a drop closes everything. */
if (new URLSearchParams(location.search).has('selftest')) {
  const made = [], Real = WebSocket;
  window.WebSocket = function (url) {
    const o = { url, readyState: 0, close() { this.readyState = 3; }, send() {},
                onopen: null, onclose: null, onerror: null, onmessage: null, binaryType: '' };
    made.push(o); return o;
  };
  // these are non-enumerable statics — Object.assign would silently skip them
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const live = () => made.filter(o => o.readyState <= 1).length;

  $('ip').value = '10.0.0.1';
  connect(); connect(); connect();
  const afterRetries = live();

  const cmd = made[made.length - 1];
  cmd.readyState = 1; cmd.onopen();
  cmd.readyState = 3; cmd.onclose({});
  const afterDrop = live();

  window.WebSocket = Real;
  teardown(); setState(null, t('未连接'));

  // the parser turns a raw status block into what the overlay draws — check it too
  const v = visionParse({
    classnames: { count: 4, items: [{ index: 0, name: 'SportsBall' }, { index: 1, name: 'BlueBarrel' },
                                    { index: 2, name: 'OrangeBarrel' }, { index: 3, name: 'Robot' }] },
    objects: { count: 2, items: [
      { type: 4, id: 1, originx: 100, originy: 60, width: 40, height: 50, score: 91 },
      { type: 8, id: 7, originx: 10, originy: 10, width: 20, height: 20, angle: 12,
        x0: 10, y0: 10, x1: 30, y1: 12, x2: 28, y2: 30, x3: 8, y3: 28 },
      { type: 4, id: 3, originx: 0, originy: 0, width: 5, height: 5 },   // past count — must be ignored
    ] },
  });
  const vOk = v.length === 2 && v[0].kind === 'BlueBarrel' && v[0].cx === 120 && v[0].cy === 85
              && v[1].kind === 'tag' && v[1].rot === 12 && v[1].quad === '10,10 30,12 28,30 8,28'
              && Math.abs(v[0].bearing + 7.6) < 0.1;      // 120,85 sits left of the frame centre

  // encode(): rows must run-length merge, nothing may land outside the r=120 circle,
  // and set_pen_color must be emitted once per colour rather than once per rectangle
  const pal2 = [[0, 0, 0], [255, 0, 0]];
  const idx2 = new Int16Array(SCR * SCR);
  for (let y = 100; y < 140; y++) for (let x = 0; x < SCR; x++) idx2[y * SCR + x] = 1;
  const eOps = encode(idx2, pal2);
  const eRect = eOps.filter(o => o.cmd_id === 'lcd_draw_rectangle');
  const inCircle = (x, y) => Math.hypot(x - SCR_R, y - SCR_R) <= SCR_R + 1;
  const eOk = eRect.length > 0 && eRect.length < 2 * SCR          // merging actually happened
    && eOps.filter(o => o.cmd_id === 'lcd_set_pen_color').length === pal2.length
    && eRect.every(q => q.x >= 0 && q.y >= 0 && q.x + q.width <= SCR && q.y + q.height <= SCR
         && inCircle(q.x + 0.5, q.y + 0.5)
         && inCircle(q.x + q.width - 0.5, q.y + q.height - 0.5));

  // A body state class sharing a name with an element class is how `.scr { display: none }`
  // once matched <body> and took the whole page with it. Every state must leave body visible.
  const keep = body.className;
  const bOk = ['tab-scr', 'tab-map', 'm-pen', 'm-img', 'm-emo', 'emo-on', 'emo-nopic',
               'vlay', 'vexp', 'streaming', 'live', 'busy', 'pristine'].every(c => {
    body.className = c;
    return getComputedStyle(body).display !== 'none' && body.offsetWidth > 0;
  });
  body.className = keep;

  /* mapXform(): the field must stay inside the viewBox at every view angle, a 90° turn
     must swap which side is long, and a heading must turn with the field — otherwise the
     marker points somewhere the robot is not. */
  const [mfx, mfy] = [3 * TILE, 4 * TILE];
  const corners = f => [[-mfx / 2, -mfy / 2], [mfx / 2, mfy / 2]].map(([x, y]) => f.pt(x, y));
  const inVB = ([x, y]) => x >= 0 && x <= 320 && y >= 0 && y <= 240;
  const keepRot = mapRot;
  mapRot = 0; const m0 = mapXform(mfx, mfy);
  mapRot = 90; const m9 = mapXform(mfx, mfy);
  const wide = c => Math.abs(c[1][0] - c[0][0]) > Math.abs(c[1][1] - c[0][1]);
  const mOk = corners(m0).every(inVB) && corners(m9).every(inVB)
    && wide(corners(m0)) && !wide(corners(m9))          // 0° is landscape, 90° is portrait
    && Math.abs(Math.hypot(...m0.vec(0, 1)) - 1) < 1e-9  // a unit heading stays unit length
    && Math.abs(m0.vec(0, 1)[0] - 1) < 1e-9             // heading 0° (+Y) points screen-right
    && Math.abs(m9.vec(0, 1)[1] + 1) < 1e-9;            // turned 90°, the same heading points up
  mapRot = keepRot;

  const ok = afterRetries <= 2 && afterDrop === 0 && vOk && eOk && bOk && mOk;
  const msg = `自检 ${ok ? '通过' : '失败'}：3 次重试后存活 ${afterRetries} 个（应 ≤2），` +
              `断线后存活 ${afterDrop} 个（应 0），视觉解析 ${vOk ? '正常' : '异常'}，` +
              `屏幕编码 ${eOk ? '正常' : '异常'}（${eRect.length} 块），` +
              `状态类 ${bOk ? '正常' : '有冲突'}，地图投影 ${mOk ? '正常' : '异常'}`;
  log(msg, !ok);
  (ok ? console.log : console.error)(msg);
}
