/* ── theme ────────────────────────────────────────────────
   The stock the manual is printed on. data-theme is already stamped on <html> by the
   inline script in <head> — this only handles the toggle and keeps following the system
   for as long as the reader has not made a choice of their own. */
const themeIsDark = () => document.documentElement.dataset.theme === 'dark';

function setTheme(theme, remember = true) {
  document.documentElement.dataset.theme = theme;
  if (remember) { try { localStorage.setItem('aimTheme', theme); } catch {} }
  // the button shows what it will switch TO, which is the opposite of what you see
  $('themeIcon').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  $('themeBtn').setAttribute('aria-label', t(theme === 'dark' ? '切换到亮色' : '切换到暗色'));
  $('themeBtn').title = $('themeBtn').getAttribute('aria-label');
}
setTheme(themeIsDark() ? 'dark' : 'light', false);

$('themeBtn').onclick = () => setTheme(themeIsDark() ? 'light' : 'dark');

// a stored choice outranks the system; without one, follow it as it changes
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  let chosen = null;
  try { chosen = localStorage.getItem('aimTheme'); } catch {}
  if (!chosen) setTheme(e.matches ? 'dark' : 'light', false);
});

/* ── language ─────────────────────────────────────────────
   The button carries the language it switches to, so it reads the same in either. */
$('langBtn').onclick = () => setLang(lang === 'zh' ? 'en' : 'zh');

// the theme button's own label is copy too, so it re-renders with everything else
onLang.push(() => setTheme(themeIsDark() ? 'dark' : 'light', false));

/* Last thing in the file, and prefs.js is loaded after every module that registers an
   onLang hook — so this first pass reaches all of them. */
setLang(lang);
