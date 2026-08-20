/* ── i18n ─────────────────────────────────────────────────
   The Chinese copy is the key. There is no key file to invent names for and none to
   fall out of step with the markup — the same trick gettext plays.

   Static text is swapped by walking the DOM: every text node and the three text-bearing
   attributes get looked up, both directions, so switching back and forth is lossless.
   Where a sentence carries inline markup the whole element is replaced instead
   (data-i18n-html), because Chinese and English word order differ and a phrase-by-phrase
   swap would produce nonsense.

   Anything JavaScript writes goes through t(), and anything JavaScript builds registers
   a re-render in onLang so a switch redraws it. */

const I18N = {
  // header
  'AIM 控制台': 'AIM Console',
  '未连接': 'Not connected',
  '连接中…': 'Connecting…',
  '已连接': 'Connected',
  '机器人 IP 地址': 'Robot IP address',
  '连接': 'Connect',
  '断开': 'Disconnect',
  '电量': 'BATTERY',
  '朝向': 'HEADING',
  '急停': 'STOP',
  '急停：立即停止所有运动': 'Emergency stop: halt all motion now',
  '切换到亮色': 'Switch to light',
  '切换到暗色': 'Switch to dark',
  '切换语言': 'Switch language',

  // the plate's empty state
  '尚未连接机器人': 'No robot connected',
  '确认设备与机器人在同一局域网，输入 IP 后点击「连接」。':
    'Put this device on the same network as the robot, enter its IP, then press Connect.',
  '正在连接…': 'Connecting…',
  '连接超时': 'Connection timed out',
  '超时': 'TIMEOUT',
  '画面未开启': 'Feed off',
  '拨动图注条上的「画面」开关即可查看实时画面。':
    'Flip the Feed switch on the caption bar to see the live picture.',
  '连接已中断': 'Connection lost',
  '机器人按了电源键，已结束这次连接': 'The robot’s power button was pressed — session ended',
  '机器人的程序已停止（电源键？），已结束这次连接':
    'The robot’s program stopped (power button?) — session ended',
  '机器人已退出': 'Robot signed off',
  '机器人自己结束了连接。按电源键唤醒后重新点「连接」。':
    'The robot ended the session itself. Wake it with its power button, then press Connect again.',
  '已退出': 'ENDED',
  '已中断': 'DROPPED',
  '无法连接': 'Cannot connect',
  '连接失败': 'FAILED',
  '画面通道断开': 'Feed channel closed',
  '视频流被机器人关掉了。重新点「连接」即可恢复；标注走的是状态包，不受影响。':
    'The robot closed the video socket. Press Connect again to restore it — annotation '
    + 'rides the status packet and is unaffected.',
  '画面已断': 'FEED DOWN',
  '画面已关闭': 'Feed off',
  '标注还在跑，画的是同一批数据。把「画面」开关拨开即可恢复实时画面。':
    'Annotation is still running on the same data. Flip Feed back on for the picture.',
  '把图注条上的「画面」开关拨开即可恢复。': 'Flip the Feed switch on the caption bar to restore it.',
  '标注已开启，画面未开启': 'Annotation on, feed off',
  '标注走的是状态包，不需要视频流。想同时看画面，请拨动左边的「画面」开关。':
    'Annotation rides the status packet and needs no video. For the picture too, flip the '
    + 'Feed switch to its left.',
  '仅标注': 'ANNOTATION ONLY',
  '实时': 'LIVE',

  // caption bar and figure
  '画面': 'Feed',
  '屏幕': 'Screen',
  '标注': 'Boxes',
  '摄像头画面开关': 'Camera feed switch',
  'AI 视觉标注开关': 'AI vision annotation switch',
  '240 × 240 · 可见区 r=120': '240 × 240 · visible r=120',
  '视觉信息': 'Vision',
  '目标 {0}': '{0} objects',
  '展开': 'Expand',
  '收拢': 'Collapse',
  '目标': 'Object',
  '中心 X, Y': 'Center X, Y',
  '原点 X, Y': 'Origin X, Y',
  '宽 × 高': 'W × H',
  '方位': 'Bearing',
  '旋转': 'Rotation',
  '置信': 'Score',
  '没有识别到目标。': 'Nothing detected.',

  // rail
  '拖动调整控制栏宽度': 'Drag to resize the rail',
  '拖动调整控制台高度': 'Drag to resize the console',
  '控制栏内容': 'Rail content',
  '控制': 'Controls',
  '代码': 'Code',
  '移动': 'Drive',
  '左转': 'Turn left',
  '前进': 'Forward',
  '右转': 'Turn right',
  '左平移': 'Strafe left',
  '右平移': 'Strafe right',
  '后退': 'Backward',
  '停止': 'Stop',
  '停': 'STOP',
  '移动速度': 'Drive speed',
  '转向速度': 'Turn speed',
  '视觉': 'Vision',
  '机器人': 'Robot',
  '蓝桶': 'Blue barrel',
  '橙桶': 'Orange barrel',
  '球': 'Ball',
  '灯光': 'Lights',
  '选择灯珠': 'Choose LED',
  '全部灯珠': 'All LEDs',
  '灯珠 1': 'LED 1',
  '灯珠 2': 'LED 2',
  '灯珠 3': 'LED 3',
  '灯珠 4': 'LED 4',
  '灯珠 5': 'LED 5',
  '灯珠 6': 'LED 6',
  '灯光颜色': 'LED colour',
  '点亮': 'On',
  '熄灭': 'Off',
  '踢球': 'Kick',
  '轻': 'Soft',
  '中': 'Med',
  '重': 'Hard',
  '活动日志': 'Activity log',

  // robot screen
  '画笔': 'Pen',
  '图片': 'Image',
  '表情': 'Emoji',
  '工具': 'Tool',
  '橡皮': 'Eraser',
  '笔色': 'Pen colour',
  '笔宽': 'Pen width',
  '选择图片': 'Choose image',
  '复位': 'Reset',
  '颜色数': 'Colours',
  '缩放': 'Zoom',
  '选一张图片。拖动图版可平移。': 'Pick an image. Drag the plate to pan.',
  '发送': 'Send',
  '取消': 'Cancel',
  '正面': 'Forward',
  '向左': 'Left',
  '向右': 'Right',
  '隐藏表情': 'Hide emoji',
  '背景色': 'Background',
  '清屏': 'Clear',
  '这张图片读不出来': 'That image could not be read',

  // Python panel
  '运行': 'Run',
  '全屏': 'Full screen',
  '退出全屏': 'Exit full screen',
  '复制代码': 'Copy code',
  '代码补全': 'Code completion',
  'Python 代码': 'Python code',
  '官方示例': 'Official examples',
  '载入官方示例': 'Load an official example',
  '示例…': 'Examples…',
  '移动与停止': 'Move and Stop',
  '斜向移动': 'Angled Moving',
  '彩色方形': 'Colorful Square',
  '里程计': 'Odometry',
  '持续移动': 'Move At',
  '表情反应': 'Emoji Reaction',
  '首次切到这里会下载 Python 运行时': 'Opening this tab downloads the Python runtime',
  '下载 Python 运行时（约 6 MB）…': 'Downloading the Python runtime (~6 MB)…',
  '就绪': 'ready',
  '运行时加载失败': 'Runtime failed to load',
  '需要 Chrome / Edge（WebAssembly JSPI），并且能访问 cdn.jsdelivr.net。':
    'Needs Chrome or Edge (WebAssembly JSPI) and access to cdn.jsdelivr.net.',
  'API 与官方 vex 库一致：': 'The API matches the official vex library: ',
  '已复制代码': 'Code copied',
  '复制失败 —— 请手动全选复制': 'Copy failed — select all and copy by hand',
  '停止…': 'Stopping…',
  'Python 程序出错，已急停': 'The Python program failed; the robot was stopped',
  '⊘ 已急停（drive 0 / turn 0）': '⊘ Stopped the robot (drive 0 / turn 0)',
  '✓ 完成 {0}ms': '✓ Done in {0}ms',
  '■ 已停止 {0}ms': '■ Stopped after {0}ms',
  '还没有状态包 —— 机器人未连接，或 ws_status 还没回过一包':
    'No status packet yet — the robot is not connected, or ws_status has not answered once',
  'LED 集合是空的': 'the LED collection is empty',

  // log lines and progress
  '请输入机器人 IP 地址': 'Enter the robot IP address',
  '连接 {0}': 'Connecting to {0}',
  '{0} 无响应 —— 机器人可能已休眠、断开局域网，或 IP 变了。按一下机器人电源键唤醒后重试。':
    '{0} did not answer — the robot may be asleep, off the network, or on a different IP. '
    + 'Tap its power button to wake it and try again.',
  '{0} 没有响应。确认机器人已唤醒且与本设备在同一局域网。':
    '{0} did not answer. Check the robot is awake and on the same network as this device.',
  '尝试 ws://{0}': 'Trying ws://{0}',
  '收到无法解析的命令回复，已丢弃': 'Discarded a command reply that could not be parsed',
  '命令 {0} 失败: {1}': 'Command {0} failed: {1}',
  '未知错误': 'unknown error',
  '已连接，初始化程序': 'Connected; initialising the program',
  '连接已关闭': 'connection closed',
  '连接中断 —— 机器人主动断开或离开了局域网':
    'Connection dropped — the robot hung up or left the network',
  '与 {0} 的连接断开了。点「连接」重试。': 'The link to {0} dropped. Press Connect to retry.',
  '无法连接 {0} —— 确认 IP 正确、机器人已唤醒、本设备与它在同一局域网':
    'Cannot reach {0} — check the IP, that the robot is awake, and that this device is on '
    + 'the same network',
  '。若浏览器弹出「访问本地网络设备」授权框，请点允许':
    '. If the browser asks about access to local network devices, allow it',
  '连不上 {0}。检查 IP 与局域网，或按电源键唤醒机器人。':
    'Cannot reach {0}. Check the IP and the network, or wake the robot with its power button.',
  '画面通道断开（ws_img）—— 机器人把视频 socket 关了。命令与标注不受影响，重新「连接」可恢复画面':
    'Feed channel closed (ws_img) — the robot shut the video socket. Commands and '
    + 'annotation are unaffected; press Connect again to restore the picture',
  '{0} 分 {1} 秒': '{0}m {1}s',
  '{0} 秒': '{0}s',
  '{0} / {1} 条 · {2}%': '{0} / {1} commands · {2}%',
  ' · 约剩 {0}': ' · about {0} left',
  '屏幕：发出 {0}/{1} 条，用时 {2}s': 'Screen: sent {0}/{1} commands in {2}s',
  '（已取消）': ' (cancelled)',
  '{0} 条命令': '{0} commands',
  ' · 约 {0} 秒': ' · about {0}s',
  ' · 首次发送后才会估时': ' · timing appears after the first send',
  '表情 · {0} · {1}': 'Emoji · {0} · {1}',

  // the mixed-content / LNA notice
  '<b>此页面通过明文 HTTP 从公网域名打开，Chrome 会拒绝它连接局域网设备。</b>':
    '<b>This page was opened over plain HTTP from a public domain, so Chrome will refuse '
    + 'to let it reach local network devices.</b>',
  // a key made of pieces has to be computed; it must match startup.js byte for byte
  ['<ol><li>改用 <code>https://</code> 打开本页，连接时在弹出的「访问本地网络设备」中点<b>允许</b></li>'
  + '<li>或把本页放在局域网内提供服务（如 <code>http://192.168.x.x:8099</code>）</li>'
  + '<li>或下载 index.html 本地双击打开</li></ol>']:
    '<ol><li>Open this page over <code>https://</code> and <b>allow</b> access to local '
    + 'network devices when the browser asks</li>'
    + '<li>Or serve this page from inside the network (e.g. '
    + '<code>http://192.168.x.x:8099</code>)</li>'
    + '<li>Or download index.html and open it locally</li></ol>',

  // whole elements, because the inline markup sits mid-sentence
  'steps-1': '把机器人开机，让它和这台设备连到<b>同一个 Wi-Fi</b>；'
    + '也可以直接连机器人自己的热点，此时 IP 是 <b>192.168.4.1</b>。',
  'steps-2': '在上方填入机器人的 <b>IP 地址</b>，按「连接」。',
  'steps-3': '浏览器若询问<b>是否允许访问本地网络设备</b>，请点允许。',
  'steps-4': '连上后拨动下方图注条里的<b>「画面」开关</b>，即可看到实时画面。',
  'figno': '按住方向键即走，松开即停。<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或 '
    + '<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 平移 · <kbd>Q</kbd><kbd>E</kbd> 转向 · '
    + '<kbd>空格</kbd> 急停。',
  'keys-drive': '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或 '
    + '<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 平移 · <kbd>Q</kbd><kbd>E</kbd> 转向 · '
    + '<kbd>空格</kbd> 急停',
  'keys-vision': '取消勾选会关掉机器人端对应检测，从源头少发数据；标注不依赖画面，关掉视频流也能看。',
  'keys-pen': '在图版上直接画，抬笔即发。未连接时只在本地画。',
  'keys-emoji': '表情盖在绘制内容之上。画笔、图片、清屏会先自动隐藏表情，否则命令发出去了屏幕也不动。',
};

// the English side of the whole-element entries, keyed the same way
const I18N_HTML_EN = {
  'steps-1': 'Switch the robot on and put it on <b>the same Wi-Fi</b> as this device; you '
    + 'can also join the robot’s own hotspot, in which case its IP is <b>192.168.4.1</b>.',
  'steps-2': 'Type the robot’s <b>IP address</b> above and press Connect.',
  'steps-3': 'If the browser asks <b>whether to allow access to local network devices</b>, allow it.',
  'steps-4': 'Once connected, flip the <b>Feed switch</b> on the caption bar below to see the picture.',
  'figno': 'Hold a direction to drive, release to stop. <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd>'
    + '<kbd>D</kbd> or <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> to strafe · '
    + '<kbd>Q</kbd><kbd>E</kbd> to turn · <kbd>Space</kbd> to stop.',
  'keys-drive': '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or '
    + '<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> to strafe · <kbd>Q</kbd><kbd>E</kbd> '
    + 'to turn · <kbd>Space</kbd> to stop',
  'keys-vision': 'Unticking a family switches that detector off on the robot, so the data '
    + 'stops at the source. Annotation does not need the video — it works with the feed off.',
  'keys-pen': 'Draw straight on the plate; the stroke is sent when you lift the pen. '
    + 'With no robot connected it stays local.',
  'keys-emoji': 'An emoji covers whatever is drawn underneath. Pen, image and clear all hide '
    + 'it first — otherwise the commands go out and the screen does not move.',
};

const EN2ZH = {};
for (const [zh, en] of Object.entries(I18N)) if (typeof en === 'string') EN2ZH[en] = zh;

let lang = 'zh';
try {
  lang = localStorage.getItem('aimLang')
    || ((navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en');
} catch { }

/* t('已连接') for plain copy, t('连接 {0}', host) for anything with a value in it.
   Unknown text passes through, so a missed string degrades to Chinese rather than blank. */
function t(zh, ...args) {
  let s = lang === 'en' ? (I18N[zh] ?? zh) : zh;
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i) => args[i]) : s;
}
window.aimT = t;                       // AIM_PY reaches its own messages through this

// re-render hooks, one per module that builds text in JavaScript
const onLang = [];

const I18N_ATTRS = ['aria-label', 'title', 'placeholder'];
const I18N_SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);
const I18N_SKIP_ID = new Set(['log', 'pyLog', 'pyHi', 'pyGut', 'pyAc']);

// keep the surrounding whitespace: the markup's indentation is not part of the sentence
const swap = (raw, conv) => {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
  const out = conv(m[2]);
  return out === m[2] ? raw : m[1] + out + m[3];
};

function applyLang() {
  const conv = lang === 'en' ? (s => I18N[s] ?? s) : (s => EN2ZH[s] ?? s);
  const html = lang === 'en' ? I18N_HTML_EN : I18N;

  for (const el of document.querySelectorAll('[data-i18n-html]'))
    el.innerHTML = html[el.dataset.i18nHtml] ?? el.innerHTML;

  const walk = node => {
    if (node.nodeType === 3) { node.nodeValue = swap(node.nodeValue, conv); return; }
    if (node.nodeType !== 1) return;
    // the log panes hold sentences already written, and the editor holds the user's own
    // code — leave both in whatever language they are already in
    // data-i18n-keep: copy that is bilingual by design and stays put in both languages
    // (the shoulder stop reads 急停 / STOP always), while the element's own attributes
    // above still get translated
    if (I18N_SKIP.has(node.tagName) || I18N_SKIP_ID.has(node.id) || node.dataset.i18nHtml
        || node.hasAttribute('data-i18n-keep')) return;
    for (const a of I18N_ATTRS)
      if (node.hasAttribute(a)) node.setAttribute(a, swap(node.getAttribute(a), conv));
    node.childNodes.forEach(walk);
  };
  walk(document.body);
}

function setLang(next) {
  lang = next;
  try { localStorage.setItem('aimLang', next); } catch { }
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  applyLang();
  $('langBtn').textContent = next === 'zh' ? 'EN' : '中';
  $('langBtn').title = $('langBtn').ariaLabel = t('切换语言');
  onLang.forEach(fn => fn());
}
