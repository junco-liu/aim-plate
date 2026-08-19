const $ = id => document.getElementById(id);
const body = document.body;
body.classList.add('pristine');

function log(msg, isErr) {
  const el = document.createElement('span');
  if (isErr) el.className = 'err';
  el.textContent = msg + '\n';
  $('log').append(el);
  $('log').scrollTop = 1e9;
  if (isErr) $('log').closest('details').open = true;
}

// the plate's own content is the state display: heading, hint, and caption bar
function placeholder(title, hint, cap, meta) {
  $('phTitle').textContent = title;
  $('phHint').textContent = hint;
  if (cap !== undefined) $('capState').textContent = cap;
  if (meta !== undefined) $('capMeta').textContent = meta;
}

let cmdWs, imgWs, statusWs, curHost, lastUrl, statusTimer, connectTimer, everOpen, frames = 0;
let lastStatus = null, statusSeq = 0;   // the newest ws_status packet, for Python
const pending = [];   // ws_cmd is strictly request/response — replies arrive in send order

function send(obj) {
  if (cmdWs?.readyState !== 1) return Promise.reject(new Error('未连接'));
  return new Promise((res, rej) => {
    pending.push({ res, rej });
    cmdWs.send(new TextEncoder().encode(JSON.stringify(obj)));
  });
}

function setState(cls, text) {
  body.classList.remove('live', 'busy');
  if (cls) body.classList.add(cls);
  $('stateText').textContent = text;
  const live = cls === 'live';
  $('ip').disabled = $('connect').disabled = live || cls === 'busy';
  $('disconnect').disabled = !live && cls !== 'busy';
  document.querySelectorAll('.need').forEach(b => b.disabled = !live);
  $('scrSend').disabled = !live || busy || !scrOps.length;
  $('emoOff').disabled = !live || emoOn === null;
  pySync();   // 运行 depends on the runtime being loaded too, not just on the link
}

function connect() {
  const host = $('ip').value.trim();
  if (!host) { log('请输入机器人 IP 地址', true); $('ip').focus(); return; }

  closeAll();                       // never stack sockets on top of a previous attempt
  curHost = host;
  everOpen = false;
  body.classList.remove('pristine');
  setState('busy', '连接中…');
  placeholder('正在连接…', `尝试 ws://${host}`, '连接中', host);
  log(`连接 ${host}`);

  // an unreachable host leaves the socket in CONNECTING for a minute or more — fail fast instead
  connectTimer = setTimeout(() => {
    if (everOpen) return;
    log(`${host} 无响应 —— 机器人可能已休眠、断开局域网，或 IP 变了。` +
        `按一下机器人电源键唤醒后重试。`, true);
    teardown();
    setState(null, '未连接');
    placeholder('连接超时', `${host} 没有响应。确认机器人已唤醒且与本设备在同一局域网。`,
                '超时', '—');
  }, 8000);

  cmdWs = new WebSocket(`ws://${host}/ws_cmd`);
  cmdWs.binaryType = 'arraybuffer';

  cmdWs.onmessage = e => {
    const p = pending.shift();
    if (!p) return;
    let r;
    // the entry is already shifted; if the frame is malformed and we let the throw
    // escape, this promise never settles and every await on it (halt included) hangs
    try { r = JSON.parse(new TextDecoder().decode(e.data)); }
    catch { log('收到无法解析的命令回复，已丢弃', true); p.rej(new Error('bad frame')); return; }
    if (r.status === 'error') { log(`命令 ${r.cmd_id} 失败: ${r.error_info ?? '未知错误'}`, true); p.rej(r); }
    else p.res(r);
  };

  cmdWs.onopen = async () => {
    everOpen = true;
    clearTimeout(connectTimer);
    $('hostLabel').textContent = host;
    setState('live', '已连接');
    placeholder('画面未开启', '拨动图注条上的「画面」开关即可查看实时画面。', '已连接', '画面未开启');
    log('已连接，初始化程序');
    const sock = cmdWs;
    await send({ cmd_id: 'program_init' }).catch(() => {});
    if (cmdWs !== sock) return;   // link dropped while we awaited — don't open a stray status socket
    openStatus(host);
  };

  cmdWs.onerror = () => {};   // the close handler below reports; onerror carries no detail

  cmdWs.onclose = () => {
    pending.splice(0).forEach(p => p.rej(new Error('连接已关闭')));
    const dropped = everOpen;
    teardown();
    setState(null, '未连接');
    if (dropped) {
      log('连接中断 —— 机器人主动断开或离开了局域网', true);
      placeholder('连接已中断', `与 ${host} 的连接断开了。点「连接」重试。`, '已中断', '—');
    } else {
      log(`无法连接 ${host} —— 确认 IP 正确、机器人已唤醒、本设备与它在同一局域网` +
          (isSecure ? '。若浏览器弹出「访问本地网络设备」授权框，请点允许' : ''), true);
      placeholder('无法连接', `连不上 ${host}。检查 IP 与局域网，或按电源键唤醒机器人。`,
                  '连接失败', '—');
    }
  };

}

// the feed socket opens on demand, never alongside another handshake
function openImg() {
  imgWs = new WebSocket(`ws://${curHost}/ws_img`);
  // arraybuffer, not blob: a bare probe socket differing only in this receives these
  // 23KB JPEG frames fine, while the blob-mode socket fails the frame parse
  imgWs.binaryType = 'arraybuffer';
  imgWs.onopen = () => setTimeout(() => {
    if (imgWs?.readyState === 1) imgWs.send(new Uint8Array([1]));
  }, 250);
  imgWs.onmessage = e => {
    const url = URL.createObjectURL(new Blob([e.data], { type: 'image/jpeg' }));
    $('view').src = url;
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = url;
    frames++;
    body.classList.add('streaming');
    $('camToggle').checked = true;      // the robot may already be streaming
    $('capState').textContent = '实时';
  };
  imgWs.onclose = () => {
    body.classList.remove('streaming');
    if (!body.classList.contains('live')) return;   // ordinary teardown — cmdWs reports that
    $('camToggle').checked = false;
    log('画面通道断开（ws_img）—— 机器人把视频 socket 关了。命令与标注不受影响，重新「连接」可恢复画面', true);
    placeholder('画面通道断开', '视频流被机器人关掉了。重新点「连接」即可恢复；标注走的是状态包，不受影响。',
                undefined, '画面已断');
  };
}

// The status socket answers only when polled, and the Python client keeps exactly one
// request outstanding: send, block on the reply, then sleep. A fixed setInterval stacks
// a second request whenever the robot is slower than the interval, and the replies come
// back over each other as garbage frames. Poll from the reply instead.
function openStatus(host) {
  statusWs = new WebSocket(`ws://${host}/ws_status`);
  statusWs.binaryType = 'arraybuffer';
  const poll = () => {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(poll, 1000);      // watchdog, in case a reply never lands
    if (statusWs?.readyState === 1) statusWs.send(new Uint8Array([1]));
  };
  statusWs.onopen = poll;
  statusWs.onmessage = e => {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(poll, 200);
    let j;
    try { j = JSON.parse(new TextDecoder().decode(e.data)); } catch { return; }
    lastStatus = j;
    statusSeq++;
    if (j.robot) {
      $('battery').textContent = j.robot.battery + '%';
      $('heading').textContent = Math.round(+j.robot.heading) + '°';
    }
    visionRender(visionParse(j.aivision));
  };
}

/* The newest status packet, kept for Python: the official library has a polling thread
   whose Robot methods read robot.status, and this is the same packet from the same
   socket. _seq counts packets so a program can tell a stale read from a fresh one —
   that is what the motion-flag waits and set_xy_position block on. */
window.aimStatus = () =>
  lastStatus === null ? null : JSON.stringify({ ...lastStatus, _seq: statusSeq });

// one fps sample per second, shown in the caption bar like a plate's spec line
setInterval(() => {
  if (!body.classList.contains('streaming')) return;
  const w = $('view').naturalWidth;                  // unknown until the first frame decodes
  $('capMeta').textContent = w ? `${w} × ${$('view').naturalHeight} · ${frames} fps`
                               : `${frames} fps`;
  frames = 0;
}, 1000);

function closeAll() {
  clearTimeout(statusTimer);
  clearTimeout(connectTimer);
  // stop the stream before dropping the socket, the way the Python client does
  if (imgWs?.readyState === 1) { try { imgWs.send(new Uint8Array([0])); } catch {} }
  for (const w of [cmdWs, imgWs, statusWs]) {
    if (!w) continue;
    w.onopen = w.onclose = w.onerror = w.onmessage = null;   // detach so we don't re-enter teardown
    if (w.readyState <= WebSocket.OPEN) w.close();
  }
  cmdWs = imgWs = statusWs = null;
  lastStatus = null;      // never let Python read a dead link's last packet
}

function teardown() {
  closeAll();
  body.classList.remove('streaming');
  $('camToggle').checked = false;
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  $('view').removeAttribute('src');
  $('battery').textContent = $('heading').textContent = '—';
  visionRender([]);
}

// Close only the command link; its onclose runs teardown, which detaches handlers before
// closing the rest — otherwise the feed socket's own close gets reported as a fault.
function disconnect() { if (cmdWs) cmdWs.close(); else teardown(); }
