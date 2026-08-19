/* ── the two draggable rules ──────────────────────────────
   The rail's width and the console's height are the reader's, not constants: writing
   code wants a wide margin and a short console, plain driving wants neither. Each is a
   single CSS variable — dragged, arrow-keyed, and remembered. */
function splitter(id, cssVar, store, min, max, dflt, measure, steps) {
  const el = $(id);
  let v;
  const set = px => {
    v = Math.max(min, Math.min(max, Math.round(px)));
    document.documentElement.style.setProperty(cssVar, v + 'px');
    el.setAttribute('aria-valuenow', v);
    try { localStorage.setItem(store, v); } catch {}   // private mode throws on write
  };
  set(+localStorage.getItem(store) || dflt);

  // the drag listens on the window, not the handle: pointer capture is the tidier way
  // but it drops the drag the moment the pointer isn't a real one, and the pointer
  // routinely travels past the handle's own 7px anyway
  el.addEventListener('pointerdown', e => {
    e.preventDefault();                     // or the drag turns into a text selection
    body.classList.add('dragging');
    body.style.cursor = getComputedStyle(el).cursor;
    const move = ev => set(measure(ev));
    const end = () => {
      body.classList.remove('dragging'); body.style.cursor = '';
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  });
  el.addEventListener('keydown', e => {
    if (!(e.key in steps)) return;
    e.preventDefault();
    set(v + steps[e.key]);
  });
}

splitter('split', '--rail', 'aimRail', 240, 640, 300,
  e => $('cols').getBoundingClientRect().right - e.clientX,
  { ArrowLeft: 20, ArrowRight: -20 });

splitter('vsplit', '--pylog', 'aimPyLog', 60, 600, 150,
  e => $('pyPanel').getBoundingClientRect().bottom - e.clientY,
  { ArrowUp: 20, ArrowDown: -20 });

/* ── Python ───────────────────────────────────────────────
   Pyodide is ~6MB, so it loads the first time someone opens the 代码 face and never
   before. Python is written straight — robot.drive(...), no await — because JSPI lets
   pyodide.ffi.run_sync suspend the Python stack on a JS promise. That means no worker
   and no SharedArrayBuffer, hence no COOP/COEP headers, which GitHub Pages can't serve.
   Every call still goes through send(), the same one-question-one-answer socket the
   buttons use — Python is another caller, not another path. */
const PY_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.5/full/pyodide.mjs';
const PY_STOP = '__aim_stop__';
let py = null, pyLoading = false, pyAbort = false, pyRunning = false;

const pylog = (m, cls) => {
  const el = document.createElement('span');
  if (cls) el.className = cls;
  el.textContent = m + '\n';
  $('pyLog').append(el);
  $('pyLog').scrollTop = 1e9;
};

function pySync() {
  $('pyRun').disabled = !py || pyRunning || !body.classList.contains('live');
  $('pyStop').disabled = !pyRunning;
}

/* The bridge. Named without leading underscores on purpose: inside a Python class body
   `js.__aim_cmd` gets name-mangled to `js._Robot__aim_cmd` and fails at runtime. */
window.aimCmd = async json => {
  if (pyAbort) throw new Error(PY_STOP);
  const r = await send(JSON.parse(json));
  if (pyAbort) throw new Error(PY_STOP);      // 停止 was pressed while the robot answered
  return JSON.stringify(r);
};

// never time.sleep: on the main thread that freezes the event loop and 停止 stops responding
window.aimSleep = async sec => {
  const end = performance.now() + sec * 1000;
  while (performance.now() < end) {
    if (pyAbort) throw new Error(PY_STOP);
    await new Promise(r => setTimeout(r, Math.min(50, end - performance.now())));
  }
};

/* The Python API lives in js/robot.js as AIM_PY. It is re-run before every program so
   a crashed run leaves no half-mutated robot behind — Robot() is cheap, it only binds
   to the page's sockets. */
const PY_EXAMPLES = {
  'move_and_stop': `# Project:      Move and Stop
# Description:  This project moves the robot forward 300 mm and plays
#               the "complete" sound once it has completed movement

robot.move_for(300, 0)
robot.sound.play(COMPLETE)
`,
  'angled_moving': `# Project:      Angled Moving
# Description:  This project moves the robot at 45-degree angles at 100%
#               velocity to trace a diamond shape

robot.set_move_velocity(100)
robot.move_for(100, 45)
robot.move_for(100, 315)
robot.move_for(100, 225)
robot.move_for(100, 135)
`,
  'colorful_square': `# Project:      Colorful Square
# Description:  This project makes the robot move in a square path,
#               changing the LED color at each corner

robot.led.on(ALL_LEDS, BLUE)
robot.move_for(100, 0)
robot.led.on(ALL_LEDS, RED)
robot.move_for(100, 270)
robot.led.on(ALL_LEDS, GREEN)
robot.move_for(100, 180)
robot.led.on(ALL_LEDS, ORANGE)
robot.move_for(100, 90)
`,
  'odometry': `# Project:      Odometry
# Description:  Zero the pose, drive a leg, and read back where the robot thinks it is

robot.set_xy_position(0, 0)
robot.inertial.reset_heading()

robot.move_for(200, 0)
print("x", round(robot.get_x_position(), 1), "mm")
print("y", round(robot.get_y_position(), 1), "mm")

robot.turn_for(RIGHT, 90)
print("heading", robot.inertial.get_heading(), "deg")
print("rotation", robot.inertial.get_rotation(), "deg")
print("battery", robot.get_battery_capacity(), "%")
`,
  'move_at_until': `# Project:      Move At, Then Stop
# Description:  move_at runs forever, so something else has to end it.
#               Here a distance read from odometry does.

robot.set_xy_position(0, 0)
robot.move_at(0, 40)

while robot.get_y_position() < 250:
    wait(50, MSEC)

robot.stop_all_movement()
robot.screen.show_emoji(PROUD)
`,
  'emoji_reaction': `# Project:      Emoji Reaction
# Description:  Look around, then react on the robot's own screen

robot.screen.show_emoji(THINKING, LOOK_LEFT)
robot.turn_for(LEFT, 45)
robot.screen.show_emoji(THINKING, LOOK_RIGHT)
robot.turn_for(RIGHT, 90)
robot.screen.show_emoji(EXCITED)
wait(1)
robot.screen.hide_emoji()
`,
};


async function loadPy() {
  if (py || pyLoading) return;
  pyLoading = true;
  $('pyState').textContent = '下载 Python 运行时（约 6 MB）…';
  try {
    const { loadPyodide } = await import(PY_URL);
    const p = await loadPyodide({ stdout: m => pylog(m), stderr: m => pylog(m, 'err') });
    // JSPI is what lets Python call the robot without await. There is no second-best
    // here, only a different dialect users would have to learn — so say so instead.
    await p.runPythonAsync('from pyodide.ffi import run_sync\nimport js\nrun_sync(js.Promise.resolve(1))');
    p.runPython(AIM_PY, { filename: 'aim.py' });
    py = p;
    $('pyState').textContent = `Python ${py.version} 就绪`;
    pylog('API 与官方 vex 库一致：move_at / move_for / turn / turn_for / turn_to / ' +
          'stop_all_movement · get_x_position / get_y_position / set_xy_position · ' +
          'inertial · screen · kicker · led · sound · vision', 'dim');
  } catch (e) {
    $('pyState').textContent = '运行时加载失败';
    pylog(String(e?.message ?? e).split('\n').pop(), 'err');
    pylog('需要 Chrome / Edge（WebAssembly JSPI），并且能访问 cdn.jsdelivr.net。', 'dim');
  }
  pyLoading = false;
  pySync();
}

$('pyRun').onclick = async () => {
  if (!py) return;
  pyAbort = false; pyRunning = true;
  $('pyLog').textContent = '';
  pySync();
  const t0 = performance.now();
  try {
    // filename, so the library's own frames read "aim.py" and the traceback filter
    // below can tell them from the user's "<exec>" ones
    py.runPython(AIM_PY, { filename: 'aim.py' });   // a fresh robot each run, see above
    await py.runPythonAsync($('pyCode').value);
    pylog(`✓ 完成 ${Math.round(performance.now() - t0)}ms`, 'dim');
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.includes(PY_STOP)) pylog(`■ 已停止 ${Math.round(performance.now() - t0)}ms`, 'dim');
    else {
      // a traceback carries Pyodide's own frames too; only the user's code and the
      // exception itself are worth showing
      const lines = msg.split('\n').filter(Boolean);
      pylog([...lines.filter(l => l.includes('<exec>')), lines.at(-1)].join('\n'), 'err');
      log('Python 程序出错，已急停', true);
    }
  }
  // drive/turn are continuous commands: the program ending must mean the robot stopping,
  // whether it finished, crashed, or was stopped by hand
  await quiet(halt());
  pylog('⊘ 已急停（drive 0 / turn 0）', 'dim');
  pyRunning = false;
  pySync();
};

// don't wait for Python to unwind — it may be mid-round-trip. Halt now; the run's own
// finish halts again. That redundancy is deliberate, same as the rail's stop bar.
$('pyStop').onclick = () => { pyAbort = true; quiet(halt()); pylog('停止…', 'dim'); };

/* ── the editor ───────────────────────────────────────────
   A transparent textarea laid over a painted <pre>: every native editing behaviour
   (undo, IME, selection, autoscroll) still belongs to the textarea, and the <pre> only
   colours. Order in the alternation is the precedence — a keyword inside a string has
   to lose to the string. */
const PY_TOK = new RegExp([
  /(#[^\n]*)/,                                                        // comment
  /('''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")/,   // string
  /\b(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/,
  /\b(robot|print|range|len|int|float|str|bool|list|dict|tuple|abs|min|max|sum|round|enumerate|zip|sorted|reversed)\b/,
  /\b(\d[\d_]*(?:\.\d+)?)\b/,                                         // number
].map(r => r.source).join('|'), 'g');

const escHtml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function paintCode() {
  const src = $('pyCode').value;
  let out = '', last = 0;
  src.replace(PY_TOK, (m, c, s, k, b, n, i) => {
    out += escHtml(src.slice(last, i)) +
           `<i class="${c ? 'c' : s ? 's' : k ? 'k' : b ? 'b' : 'n'}">${escHtml(m)}</i>`;
    last = i + m.length;
    return m;
  });
  // the trailing newline keeps the painted block as tall as the textarea's own last line
  $('pyHi').innerHTML = out + escHtml(src.slice(last)) + '\n';
  const lines = src.split('\n').length;
  if (+$('pyGut').dataset.n !== lines) {
    $('pyGut').dataset.n = lines;
    $('pyGut').textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  }
  syncCode();
}

// only the textarea has a scrollbar; it drags the painted layer and the gutter along
function syncCode() {
  $('pyHi').scrollTop = $('pyGut').scrollTop = $('pyCode').scrollTop;
  $('pyHi').scrollLeft = $('pyCode').scrollLeft;
}

$('pyCode').addEventListener('input', paintCode);
$('pyCode').addEventListener('scroll', syncCode);

// Tab has to indent or Python is unwritable. Shift+Tab still leaves the field, so the
// editor stays escapable by keyboard. execCommand is the deprecated one that keeps undo
// working — setRangeText would wipe the history.
$('pyCode').addEventListener('keydown', e => {
  if (e.key !== 'Tab' || e.shiftKey) return;
  e.preventDefault();
  if (!document.execCommand('insertText', false, '    ')) {
    e.target.setRangeText('    ', e.target.selectionStart, e.target.selectionEnd, 'end');
  }
  paintCode();
});
paintCode();

$('pyCopy').onclick = async () => {
  // the async clipboard wants a permission some embedders refuse outright; selecting the
  // field and copying it needs nothing beyond the click that already happened
  if (await navigator.clipboard?.writeText($('pyCode').value).then(() => 1, () => 0))
    return pylog('已复制代码', 'dim');
  const t = $('pyCode'), a = t.selectionStart, b = t.selectionEnd;
  t.select();
  const done = document.execCommand('copy');
  t.setSelectionRange(a, b);                       // put the caret back where it was
  pylog(done ? '已复制代码' : '复制失败 —— 请手动全选复制', done ? 'dim' : 'err');
};

const setFull = on => {
  $('pyPanel').classList.toggle('full', on);
  $('pyFull').setAttribute('aria-pressed', on);
  $('pyFull').title = on ? '退出全屏' : '全屏';
  $('pyFullIcon').setAttribute('href', on ? '#i-shrink' : '#i-expand');
};
$('pyFull').onclick = () => setFull(!$('pyPanel').classList.contains('full'));
addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('pyPanel').classList.contains('full')) setFull(false);
});

function setRailTab(on) {
  body.classList.toggle('rail-py', on);
  $('rtPy').classList.toggle('on', on);  $('rtCtl').classList.toggle('on', !on);
  $('rtPy').setAttribute('aria-selected', on); $('rtCtl').setAttribute('aria-selected', !on);
  if (on) loadPy();
}
$('pyEg').onchange = e => {
  const src = PY_EXAMPLES[e.target.value];
  if (!src) return;
  $('pyCode').value = src;
  paintCode();
  e.target.value = '';        // the picker is an action, not a state
};

$('rtCtl').onclick = () => setRailTab(false);
$('rtPy').onclick  = () => setRailTab(true);
