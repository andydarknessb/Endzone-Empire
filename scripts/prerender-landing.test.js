const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { GATE_SCRIPT, cspHash, injectPrerender, assertComplete } = require('./prerender-landing');

const SHELL = '<html><head><style>body{margin:0}</style></head><body><div id="react-root"></div></body></html>';
const SNAPSHOTS = [
  { mode: 'light', markup: '<div data-prerender="light">Welcome</div>', css: '.css-a{color:#111}', rootStyle: '--accent: #1e5bb8;' },
  { mode: 'dark', markup: '<div data-prerender="dark">Welcome</div>', css: '.css-b{color:#eee}', rootStyle: '--accent: #6aa0ff;' },
];

// Load the injected page the way a browser would: the gate runs while <head> parses.
function visit(url, { storage = {}, prefersDark = false } = {}) {
  const dom = new JSDOM(injectPrerender(SHELL, SNAPSHOTS), {
    url,
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.entries(storage).forEach(([k, v]) => window.localStorage.setItem(k, v));
      window.matchMedia = (q) => ({ matches: prefersDark && q === '(prefers-color-scheme: dark)' });
    },
  });
  const doc = dom.window.document;
  return {
    classes: [...doc.documentElement.classList],
    theme: doc.documentElement.getAttribute('data-theme'),
    // A kept style still at media="not all" applies nothing; name it so a test sees it.
    styles: [...doc.querySelectorAll('style[data-ee-prerender]')].map((n) => n.getAttribute('data-ee-prerender') + (n.media === 'all' ? '' : '(off)')),
  };
}

test('an anonymous cold visit to / shows the prerender in the OS color scheme', () => {
  assert.deepEqual(visit('https://endzoneempire.gg/'), { classes: ['ee-pr-light'], theme: 'light', styles: ['light'] });
  assert.deepEqual(visit('https://endzoneempire.gg/#/home', { prefersDark: true }), { classes: ['ee-pr-dark'], theme: 'dark', styles: ['dark'] });
  assert.deepEqual(visit('https://endzoneempire.gg/#/').classes, ['ee-pr-light']);
});

test('a stored theme choice wins over the OS scheme, as in AppThemeProvider.initialMode', () => {
  const seen = visit('https://endzoneempire.gg/', { storage: { endzone_theme: 'dark' } });
  assert.deepEqual(seen, { classes: ['ee-pr-dark'], theme: 'dark', styles: ['dark'] });
});

test('a session hint hides it: App shows the spinner, then /user, never the landing (#2097)', () => {
  const seen = visit('https://endzoneempire.gg/#/home', { storage: { endzone_session_hint: '1' } });
  assert.deepEqual(seen, { classes: [], theme: null, styles: [] });
});

test('every other route the shell answers hides it and drops its styles', () => {
  for (const url of [
    'https://endzoneempire.gg/#/user',
    'https://endzoneempire.gg/#/registration',
    'https://endzoneempire.gg/#/home?x=1',
    'https://endzoneempire.gg/rankings',
    'https://endzoneempire.gg/draft-simulator#/home',
  ]) {
    assert.deepEqual(visit(url), { classes: [], theme: null, styles: [] }, url);
  }
});

test('blocked storage falls back to the OS scheme and no hint, like sessionHint.js', () => {
  const dom = new JSDOM(injectPrerender(SHELL, SNAPSHOTS), {
    url: 'https://endzoneempire.gg/',
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
      window.matchMedia = () => ({ matches: true });
    },
  });
  assert.deepEqual([...dom.window.document.documentElement.classList], ['ee-pr-dark']);
});

test('puts both copies in #react-root, hidden unless their mode class is on <html>', () => {
  const out = injectPrerender(SHELL, SNAPSHOTS);
  assert.ok(out.includes('<div id="react-root"><div data-prerender="light">Welcome</div><div data-prerender="dark">Welcome</div></div>'));
  assert.match(out, /html:not\(\.ee-pr-light\) \[data-prerender=light\]/);
  assert.ok(out.includes('<style data-ee-prerender="light" media="not all">html.ee-pr-light{--accent: #1e5bb8;}.css-a{color:#111}</style>'));
  // The gate comes after the styles it removes and before <body> parses.
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test fixture string compared as text, never rendered
  const gate = out.indexOf(`<script>${GATE_SCRIPT}</script>`);
  assert.ok(gate > out.indexOf('<style data-ee-prerender="dark"'));
  assert.ok(gate < out.indexOf('</head>'));
});

test('throws when #react-root is missing, duplicated or already filled', () => {
  assert.throws(() => injectPrerender('<head></head><body></body>', SNAPSHOTS), /react-root/);
  assert.throws(() => injectPrerender(SHELL.replace('</div>', 'x</div>'), SNAPSHOTS), /react-root/);
});

test('throws on captured CSS that would close the style element', () => {
  const bad = [{ ...SNAPSHOTS[0], css: 'a{}</style><script>' }, SNAPSHOTS[1]];
  assert.throws(() => injectPrerender(SHELL, bad), /<\//);
});

test("netlify.toml's CSP allows the gate script by hash and nothing inline otherwise", () => {
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  const csp = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml)[1];
  const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '));
  assert.equal(scriptSrc, `script-src 'self' ${cspHash(GATE_SCRIPT)}`);
});

test('without the gate (JS off, script blocked, HTML rewritten) no copied style applies and the markup stays hidden', () => {
  const dom = new JSDOM(injectPrerender(SHELL, SNAPSHOTS), { url: 'https://endzoneempire.gg/' });
  const doc = dom.window.document;
  assert.deepEqual([...doc.querySelectorAll('style[data-ee-prerender]')].map((n) => n.media), ['not all', 'not all']);
  assert.deepEqual([...doc.documentElement.classList], []);
});

test('the gate reads the same storage keys the app writes', () => {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- file is one of the two literals below
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  const hintKey = /SESSION_HINT_KEY = '([^']+)'/.exec(read('lib/sessionHint.js'))[1];
  const themeKey = /THEME_KEY = '([^']+)'/.exec(read('theme/AppThemeProvider.jsx'))[1];
  assert.ok(GATE_SCRIPT.includes(`localStorage.getItem("${hintKey}")==="1"`), hintKey);
  assert.ok(GATE_SCRIPT.includes(`localStorage.getItem("${themeKey}")`), themeKey);
});

test('a snapshot without tokens, without CSS or with an unstyled class fails the build', () => {
  const ok = { mode: 'light', markup: '<div class="MuiBox-root css-a css-0">x</div>', css: '.css-a{color:#111}', rootStyle: '--accent: #1e5bb8;' };
  assert.doesNotThrow(() => assertComplete(ok));
  assert.throws(() => assertComplete({ ...ok, rootStyle: '' }), /--accent/);
  assert.throws(() => assertComplete({ ...ok, css: '' }), /no emotion CSS/);
  assert.throws(() => assertComplete({ ...ok, markup: '<div class="css-a css-zz9">x</div>' }), /css-zz9/);
});

test('every path but / gets the plain shell, so public pages carry no hidden landing copy', () => {
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  const spa = toml.split('[[redirects]]').find((block) => /from\s*=\s*"\/\*"/.test(block));
  assert.match(spa, /to\s*=\s*"\/shell\.html"/);
  assert.match(toml, /for = "\/shell\.html"[\s\S]*?Cache-Control = "no-cache"/);
});
