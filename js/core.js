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
let progActive = false, leftReason = null;

/* ── the robot leaving on its own ─────────────────────────
   A socket that is still open is not proof the robot is still there: pressing its power
   button, or the program ending, leaves the sockets up while the robot has stopped
   listening. It says so in the status flags, and the two bits the Python client watches
   (aim.py check_power_button_flag / check_program_active_flag) are the whole mechanism —
   bit 9 is the power button, bit 10 says a program is running. We send program_init like
   the library does, so bit 10 falling away after we have seen it set is the robot
   hanging up on us. */
const SYS_FLAGS_PWR_BUTTON = 1 << 9, SYS_FLAGS_PROG_ACTIVE = 1 << 10;

function robotLeft(flags) {
  const f = parseInt(flags, 16);
  if (!Number.isFinite(f)) return false;
  const active = !!(f & SYS_FLAGS_PROG_ACTIVE), wasActive = progActive;
  progActive = active;

  if (f & SYS_FLAGS_PWR_BUTTON) leftReason = t('机器人按了电源键，已结束这次连接');
  else if (wasActive && !active) leftReason = t('机器人的程序已停止（电源键？），已结束这次连接');
  else return false;

  disconnect();      // the same path as the 断开 button: cmdWs.onclose reports and tears down
  return true;
}
const pending = [];   // ws_cmd is strictly request/response — replies arrive in send order

function send(obj) {
  if (cmdWs?.readyState !== 1) return Promise.reject(new Error(t('未连接')));
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
  if (!host) { log(t('请输入机器人 IP 地址'), true); $('ip').focus(); return; }

  closeAll();                       // never stack sockets on top of a previous attempt
  curHost = host;
  everOpen = false;
  progActive = false; leftReason = null;   // a fresh session, not the last one's exit
  body.classList.remove('pristine');
  setState('busy', t('连接中…'));
  placeholder(t('正在连接…'), t('尝试 ws://{0}', host), t('连接中'), host);
  log(t('连接 {0}', host));

  // an unreachable host leaves the socket in CONNECTING for a minute or more — fail fast instead
  connectTimer = setTimeout(() => {
    if (everOpen) return;
    log(t('{0} 无响应 —— 机器人可能已休眠、断开局域网，或 IP 变了。按一下机器人电源键唤醒后重试。', host), true);
    teardown();
    setState(null, '未连接');
    placeholder(t('连接超时'), t('{0} 没有响应。确认机器人已唤醒且与本设备在同一局域网。', host),
                t('超时'), '—');
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
    catch { log(t('收到无法解析的命令回复，已丢弃'), true); p.rej(new Error('bad frame')); return; }
    if (r.status === 'error') { log(t('命令 {0} 失败: {1}', r.cmd_id, r.error_info ?? t('未知错误')), true); p.rej(r); }
    else p.res(r);
  };

  cmdWs.onopen = async () => {
    everOpen = true;
    clearTimeout(connectTimer);
    $('hostLabel').textContent = host;
    setState('live', t('已连接'));
    placeholder(t('画面未开启'), t('拨动图注条上的「画面」开关即可查看实时画面。'),
                t('已连接'), t('画面未开启'));
    log(t('已连接，初始化程序'));
    const sock = cmdWs;
    await send({ cmd_id: 'program_init' }).catch(() => {});
    if (cmdWs !== sock) return;   // link dropped while we awaited — don't open a stray status socket
    openStatus(host);
  };

  cmdWs.onerror = () => {};   // the close handler below reports; onerror carries no detail

  cmdWs.onclose = () => {
    pending.splice(0).forEach(p => p.rej(new Error(t('连接已关闭'))));
    const dropped = everOpen;
    teardown();
    setState(null, '未连接');
    if (leftReason) {
      log(leftReason, true);
      placeholder(t('机器人已退出'), t('机器人自己结束了连接。按电源键唤醒后重新点「连接」。'),
                  t('已退出'), '—');
    } else if (dropped) {
      log(t('连接中断 —— 机器人主动断开或离开了局域网'), true);
      placeholder(t('连接已中断'), t('与 {0} 的连接断开了。点「连接」重试。', host), t('已中断'), '—');
    } else {
      log(t('无法连接 {0} —— 确认 IP 正确、机器人已唤醒、本设备与它在同一局域网', host) +
          (isSecure ? t('。若浏览器弹出「访问本地网络设备」授权框，请点允许') : ''), true);
      placeholder(t('无法连接'), t('连不上 {0}。检查 IP 与局域网，或按电源键唤醒机器人。', host),
                  t('连接失败'), '—');
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
    $('capState').textContent = t('实时');
  };
  imgWs.onclose = () => {
    body.classList.remove('streaming');
    if (!body.classList.contains('live')) return;   // ordinary teardown — cmdWs reports that
    $('camToggle').checked = false;
    log(t('画面通道断开（ws_img）—— 机器人把视频 socket 关了。命令与标注不受影响，重新「连接」可恢复画面'), true);
    placeholder(t('画面通道断开'), t('视频流被机器人关掉了。重新点「连接」即可恢复；标注走的是状态包，不受影响。'),
                undefined, t('画面已断'));
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
      if (robotLeft(j.robot.flags)) return;   // the link is going down — paint nothing more
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
