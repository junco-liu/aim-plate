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
  $('pyState').textContent = t('下载 Python 运行时（约 6 MB）…');
  try {
    const { loadPyodide } = await import(PY_URL);
    const p = await loadPyodide({ stdout: m => pylog(m), stderr: m => pylog(m, 'err') });
    // JSPI is what lets Python call the robot without await. There is no second-best
    // here, only a different dialect users would have to learn — so say so instead.
    await p.runPythonAsync('from pyodide.ffi import run_sync\nimport js\nrun_sync(js.Promise.resolve(1))');
    p.runPython(AIM_PY, { filename: 'aim.py' });
    py = p;
    $('pyState').textContent = `Python ${py.version} ` + t('就绪');
    acLoadNames();
    pylog(t('API 与官方 vex 库一致：') +
          'move_at / move_for / turn / turn_for / turn_to / stop_all_movement · ' +
          'get_x_position / get_y_position / set_xy_position · ' +
          'inertial · screen · kicker · led · sound · vision', 'dim');
  } catch (e) {
    $('pyState').textContent = t('运行时加载失败');
    pylog(String(e?.message ?? e).split('\n').pop(), 'err');
    pylog(t('需要 Chrome / Edge（WebAssembly JSPI），并且能访问 cdn.jsdelivr.net。'), 'dim');
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
    pylog(t('✓ 完成 {0}ms', Math.round(performance.now() - t0)), 'dim');
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.includes(PY_STOP)) pylog(t('■ 已停止 {0}ms', Math.round(performance.now() - t0)), 'dim');
    else {
      // a traceback carries Pyodide's own frames too; only the user's code and the
      // exception itself are worth showing
      const lines = msg.split('\n').filter(Boolean);
      pylog([...lines.filter(l => l.includes('<exec>')), lines.at(-1)].join('\n'), 'err');
      log(t('Python 程序出错，已急停'), true);
    }
  }
  // drive/turn are continuous commands: the program ending must mean the robot stopping,
  // whether it finished, crashed, or was stopped by hand
  await quiet(halt());
  pylog(t('⊘ 已急停（drive 0 / turn 0）'), 'dim');
  pyRunning = false;
  pySync();
};

// don't wait for Python to unwind — it may be mid-round-trip. Halt now; the run's own
// finish halts again. That redundancy is deliberate, same as the rail's stop bar.
$('pyStop').onclick = () => { pyAbort = true; quiet(halt()); pylog(t('停止…'), 'dim'); };

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

/* ── indentation ──────────────────────────────────────────
   Tab indents, Shift+Tab outdents, both over every line the selection touches. Writing
   through execCommand keeps the browser's own undo stack — setRangeText would wipe it,
   and losing ctrl+Z in a code editor is worse than the deprecation warning. */
const INDENT = '    ';

const replaceRange = (t, from, to, text, caret) => {
  t.setSelectionRange(from, to);
  if (!document.execCommand('insertText', false, text)) t.setRangeText(text, from, to, 'end');
  if (caret) t.setSelectionRange(caret[0], caret[1]);
  paintCode();
};

// the whole lines the selection touches, so indenting a block does not eat its first line
const touchedLines = t => {
  const from = t.value.lastIndexOf('\n', t.selectionStart - 1) + 1;
  const to = t.value.indexOf('\n', t.selectionEnd);
  return [from, to === -1 ? t.value.length : to];
};

function reindent(t, outward) {
  const [from, to] = touchedLines(t);
  const before = t.value.slice(from, to);
  let head = 0, total = 0;
  const after = before.split('\n').map((line, i) => {
    if (outward) {
      const cut = (line.match(/^ {1,4}/) || [''])[0].length;
      if (!i) head = -cut;
      total -= cut;
      return line.slice(cut);
    }
    if (!line) return line;                  // never turn a blank line into whitespace
    if (!i) head = INDENT.length;
    total += INDENT.length;
    return INDENT + line;
  }).join('\n');
  if (after === before) return;
  const start = t.selectionStart, end = t.selectionEnd;
  replaceRange(t, from, to, after,
               [Math.max(from, start + head), Math.max(from, end + total)]);
}

/* ── bracket and quote pairing ────────────────────────────
   Open one and the closer comes with it; type the closer that is already there and the
   caret steps over it instead of doubling it; backspace inside an empty pair takes both.
   With text selected, an opener wraps it. */
const PAIRS = { '(': ')', '[': ']', '{': '}' };
const QUOTES = "'\"";
const CLOSERS = ')]}';

function autoPair(e, t) {
  const k = e.key, start = t.selectionStart, end = t.selectionEnd;
  const next = t.value[end] ?? '', prev = t.value[start - 1] ?? '';

  if (e.key === 'Backspace' && start === end && start > 0) {
    const left = t.value[start - 1], right = t.value[start] ?? '';
    if (PAIRS[left] === right || (QUOTES.includes(left) && left === right)) {
      e.preventDefault();
      replaceRange(t, start - 1, start + 1, '');
      return true;
    }
    return false;
  }
  if (k.length !== 1) return false;
  const opener = PAIRS[k] || (QUOTES.includes(k) ? k : null);

  if (start !== end && opener) {             // wrap the selection
    e.preventDefault();
    replaceRange(t, start, end, k + t.value.slice(start, end) + opener, [start + 1, end + 1]);
    return true;
  }
  if ((CLOSERS.includes(k) || QUOTES.includes(k)) && next === k && start === end) {
    e.preventDefault();                      // step over the closer we already inserted
    t.setSelectionRange(end + 1, end + 1);
    return true;
  }
  if (!opener || start !== end) return false;
  // Don't close against existing text: inserting ( before x should not give ()x).
  // For quotes, also stay out of the way of an apostrophe typed after a word.
  if (QUOTES.includes(k) ? /[\w'"]/.test(prev) : /[\w'"([{]/.test(next)) return false;
  e.preventDefault();
  replaceRange(t, start, end, k + opener, [start + 1, start + 1]);
  return true;
}

$('pyCode').addEventListener('keydown', e => {
  const t = e.target;
  if (acKey(e)) return;                      // the completion popup gets first refusal
  if (autoPair(e, t)) return;

  // Tab is taken now, so Escape is the way out of the field — a keyboard trap otherwise
  if (e.key === 'Escape') { t.blur(); return; }
  if (e.key !== 'Tab') return;
  e.preventDefault();
  if (e.shiftKey) reindent(t, true);
  else if (t.selectionStart !== t.selectionEnd) reindent(t, false);
  else replaceRange(t, t.selectionStart, t.selectionEnd, INDENT);
});
paintCode();

/* ── completion ───────────────────────────────────────────
   The candidate lists come from dir() inside Python once the runtime is up, so they can
   never drift from js/robot.js — there is no second copy of the API to keep in step. */
const AC_PATHS = ['robot', 'robot.inertial', 'robot.screen', 'robot.kicker', 'robot.sound',
                  'robot.led', 'robot.vision', 'AiVision', 'VisionObject', 'Color', 'Timer'];
let acMap = {}, acItems = [], acIndex = 0, acFrom = 0, acMeasure;

function acLoadNames() {
  // The bare-name pool is the robot API plus the language itself: keyword.kwlist and
  // dir(builtins) rather than a hand-kept list, so for/while/def/print/range come from
  // the interpreter that will actually run the code.
  acMap = JSON.parse(py.runPython(
    'import json as _acj, keyword as _ack, builtins as _acb\n' +
    "_acout = {'': sorted(set(\n" +
    "    [n for n in globals() if not n.startswith('_')]\n" +
    '    + _ack.kwlist\n' +
    "    + [n for n in dir(_acb) if not n.startswith('_')]))}\n" +
    'for _acp in ' + JSON.stringify(AC_PATHS) + ':\n' +
    '    try:\n' +
    "        _acout[_acp] = sorted(n for n in dir(eval(_acp)) if not n.startswith('_'))\n" +
    '    except Exception:\n' +
    '        pass\n' +
    '_acj.dumps(_acout)\n'));
}

const acHide = () => { $('pyAc').hidden = true; acItems = []; };

// what the caret is completing: a dotted path we know, or a bare name of two-plus chars
function acContext() {
  const t = $('pyCode'), upto = t.value.slice(0, t.selectionStart);
  // a range selection is not a typing context — block indent would otherwise pop a list
  if (t.selectionStart !== t.selectionEnd) return null;
  let m = /([A-Za-z_][\w.]*)\.(\w*)$/.exec(upto);
  if (m) return { base: m[1], partial: m[2], from: t.selectionStart - m[2].length };
  m = /([A-Za-z_]\w*)$/.exec(upto);
  if (m && m[1].length >= 2)
    return { base: '', partial: m[1], from: t.selectionStart - m[1].length };
  return null;
}

/* The caret in pixels, relative to the panel. The face is monospace, but a comment can
   hold wide glyphs, so measure the real prefix instead of multiplying a character width.
   The popup hangs off .pypanel rather than the editor because .cw clips its overflow. */
function acCaretXY() {
  const t = $('pyCode'), cs = getComputedStyle(t);
  acMeasure ??= document.createElement('canvas').getContext('2d');
  acMeasure.font = cs.fontSize + ' ' + cs.fontFamily;
  const upto = t.value.slice(0, t.selectionStart);
  const row = upto.split('\n').length - 1;
  const col = upto.slice(upto.lastIndexOf('\n') + 1);
  const box = t.getBoundingClientRect(), panel = $('pyPanel').getBoundingClientRect();
  const lineHeight = parseFloat(cs.lineHeight);
  return [box.left - panel.left + parseFloat(cs.paddingLeft)
            + acMeasure.measureText(col).width - t.scrollLeft,
          box.top - panel.top + parseFloat(cs.paddingTop)
            + (row + 1) * lineHeight - t.scrollTop,
          lineHeight];
}

function acShow() {
  const ctx = acContext();
  const pool = ctx && acMap[ctx.base];
  if (!pool) return acHide();
  // no short cap: 'robot.' alone has 32 members, and cutting to the alphabetical first
  // few hides move_at and turn entirely. The list scrolls instead.
  const hits = pool.filter(n => n.startsWith(ctx.partial)).slice(0, 50);
  if (!hits.length || (hits.length === 1 && hits[0] === ctx.partial)) return acHide();
  acItems = hits; acIndex = 0; acFrom = ctx.from;
  $('pyAc').innerHTML = hits.map((n, i) =>
    '<li' + (i ? '' : ' class="on"') + '>' + escHtml(n) + '</li>').join('');
  const [x, y, lineHeight] = acCaretXY();
  const pop = $('pyAc');
  pop.style.left = Math.round(x) + 'px';
  pop.style.top = Math.round(y) + 'px';
  pop.hidden = false;
  /* Measure once laid out, then pin it inside the panel. Below the caret is the default;
     near the bottom it flips above the line. Both axes end in a hard clamp, because the
     caret offset is computed from the text and a stale scrollTop can put it anywhere. */
  const box = pop.getBoundingClientRect();
  const panel = $('pyPanel').getBoundingClientRect();
  const fit = (v, size, limit) => Math.max(0, Math.min(v, limit - size));
  pop.style.left = Math.round(fit(x, box.width, panel.width)) + 'px';
  pop.style.top = Math.round(fit(y + box.height > panel.height ? y - box.height - lineHeight : y,
                                 box.height, panel.height)) + 'px';
}

const acMark = () => [...$('pyAc').children].forEach((li, i) => {
  li.classList.toggle('on', i === acIndex);
  if (i === acIndex) li.scrollIntoView({ block: 'nearest' });
});

function acAccept() {
  const t = $('pyCode');
  replaceRange(t, acFrom, t.selectionStart, acItems[acIndex]);
  acHide();
}

// true when the popup consumed the key, so the indent handler stays out of the way
function acKey(e) {
  if ($('pyAc').hidden || !acItems.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    acIndex = (acIndex + (e.key === 'ArrowDown' ? 1 : acItems.length - 1)) % acItems.length;
    acMark();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acAccept(); return true; }
  if (e.key === 'Escape') { e.preventDefault(); acHide(); return true; }
  return false;
}

// mousedown, not click: a click lands after the textarea has already lost focus
$('pyAc').addEventListener('mousedown', e => {
  const li = e.target.closest('li');
  if (!li) return;
  e.preventDefault();
  acIndex = [...$('pyAc').children].indexOf(li);
  acAccept();
});
$('pyCode').addEventListener('input', acShow);
$('pyCode').addEventListener('blur', acHide);
$('pyCode').addEventListener('scroll', acHide);
$('pyCode').addEventListener('click', acHide);

$('pyCopy').onclick = async () => {
  // the async clipboard wants a permission some embedders refuse outright; selecting the
  // field and copying it needs nothing beyond the click that already happened
  if (await navigator.clipboard?.writeText($('pyCode').value).then(() => 1, () => 0))
    return pylog(t('已复制代码'), 'dim');
  const t = $('pyCode'), a = t.selectionStart, b = t.selectionEnd;
  t.select();
  const done = document.execCommand('copy');
  t.setSelectionRange(a, b);                       // put the caret back where it was
  pylog(t(done ? '已复制代码' : '复制失败 —— 请手动全选复制'), done ? 'dim' : 'err');
};

const setFull = on => {
  $('pyPanel').classList.toggle('full', on);
  $('pyFull').setAttribute('aria-pressed', on);
  $('pyFull').title = t(on ? '退出全屏' : '全屏');
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
