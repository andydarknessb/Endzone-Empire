// Prerenders the anonymous landing page (/#/home) into build/index.html (#2261).
//
// Mobile LCP was all render delay: the hero tagline could not paint until
// main.js had downloaded and run. This runs the built bundle once per color
// mode in jsdom, with the network stubbed to never answer, and keeps what React
// rendered: the same first-render markup and emotion CSS the browser will
// produce, so the swap is pixel-identical and adds no layout shift. createRoot
// clears #react-root in the same commit that paints the live tree.
//
// index.html answers every route, so a small gate in <head> shows the copy only
// where App would render the landing page itself: pathname "/", hash "", "#/"
// or "#/home", no session hint, in the mode AppThemeProvider.initialMode picks.
// The copied styles ship as media="not all" and the gate turns one on; anywhere
// else (or if the gate never runs) nothing copied applies and the markup stays
// hidden. Only `/` serves this file: netlify.toml sends every other path to
// shell.html, the same page without the copy.
// The CSP allows the gate by its sha256 hash; AppThemeProvider removes the
// copied styles and classes once its own are in place.
//
// Fails the build when the bundle does not reach the hero in either mode: a
// deploy without the prerender is slower, one with a wrong one is broken.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GATE_SCRIPT =
  '(function(){var d=document.documentElement,h=location.hash,s=false,m=null;' +
  'try{s=localStorage.getItem("endzone_session_hint")==="1";m=localStorage.getItem("endzone_theme")}catch(e){}' +
  'if(m!=="light"&&m!=="dark")m=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";' +
  'var show=!s&&location.pathname==="/"&&(h===""||h==="#/"||h==="#/home");' +
  'document.querySelectorAll("style[data-ee-prerender]").forEach(function(n){if(show&&n.getAttribute("data-ee-prerender")===m)n.media="all";else n.remove()});' +
  'if(show){d.classList.add("ee-pr-"+m);d.setAttribute("data-theme",m)}})()';

const MODES = ['light', 'dark'];

const HIDE_CSS = MODES.map((m) => `html:not(.ee-pr-${m}) [data-prerender=${m}]`).join(',') + '{display:none!important}';

function cspHash(script) {
  return `'sha256-${crypto.createHash('sha256').update(script, 'utf8').digest('base64')}'`;
}

function injectPrerender(html, snapshots) {
  const roots = html.match(/<div id="react-root">[^<]*<\/div>/g) || [];
  if (roots.length !== 1 || roots[0] !== '<div id="react-root"></div>') {
    throw new Error(`prerender-landing: expected one empty <div id="react-root"></div>, found ${roots.length}`);
  }
  for (const { css, rootStyle } of snapshots) {
    if (`${css}${rootStyle}`.includes('</')) throw new Error('prerender-landing: captured CSS contains "</"');
  }
  const styles = snapshots
    // Off until the gate turns one on: if it never runs, nothing copied applies.
    .map(({ mode, css, rootStyle }) => `<style data-ee-prerender="${mode}" media="not all">html.ee-pr-${mode}{${rootStyle}}${css}</style>`)
    .join('');
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- GATE_SCRIPT is the constant above, pinned in the CSP by its hash
  const head = `<style>${HIDE_CSS}</style>${styles}<script>${GATE_SCRIPT}</script></head>`;
  const markup = snapshots.map((s) => s.markup).join('');
  // Function replacements keep "$&" and friends in the captured text literal.
  return html.replace('</head>', () => head).replace(roots[0], () => `<div id="react-root">${markup}</div>`);
}

// Runs the built bundle in jsdom at /#/home for one color mode.
async function snapshot(buildDir, html, mode) {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const src = (html.match(/<script defer="defer" src="(\/static\/js\/main\.[\w-]+\.js)">/) || [])[1];
  if (!src) throw new Error('prerender-landing: no main.<hash>.js script tag in index.html');
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- src is matched by the regex above: /static/js/main.<word chars or dashes>.js, no ".." or extra separators
  const code = fs.readFileSync(path.join(buildDir, src), 'utf8');

  const dom = new JSDOM(html, {
    url: 'https://endzoneempire.gg/#/home',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  const rules = new Map(); // sheet -> rules as emotion wrote them, in insertion order
  // jsdom's sheets come from its CSSOM library, not window.CSSStyleSheet.
  const probe = window.document.head.appendChild(window.document.createElement('style'));
  const sheetProto = Object.getPrototypeOf(probe.sheet);
  probe.remove();
  const { insertRule } = sheetProto;
  sheetProto.insertRule = function record(rule, index) {
    if (!rules.has(this)) rules.set(this, []);
    rules.get(this).push(rule);
    try {
      return insertRule.call(this, rule, index);
    } catch (_err) {
      return 0; // jsdom's CSS parser is older than emotion's output; the recorded text is what ships
    }
  };
  window.localStorage.setItem('endzone_theme', mode);
  window.matchMedia = (query) => ({
    matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  });
  window.scrollTo = () => {};
  // Nothing answers: the snapshot is the tree React paints before any request lands.
  window.fetch = () => new Promise(() => {});
  window.XMLHttpRequest.prototype.send = function never() {};
  window.eval(code);

  const doc = window.document;
  const root = doc.getElementById('react-root');
  const deadline = Date.now() + 15000;
  while (!root.querySelector('[data-testid="landing-hero"]')) {
    if (Date.now() > deadline) throw new Error(`prerender-landing: the ${mode} bundle never rendered the landing hero`);
    await new Promise((r) => setTimeout(r, 50));
  }
  // AppThemeProvider writes the tokens onto <html> in a mount effect.
  while (!doc.documentElement.style.getPropertyValue('--accent')) {
    if (Date.now() > deadline) break; // assertComplete names what is missing
    await new Promise((r) => setTimeout(r, 50));
  }

  for (const el of root.children) el.setAttribute('data-prerender', mode);
  const css = [...doc.querySelectorAll('style[data-emotion]')]
    .map((el) => (rules.get(el.sheet) || []).join('') + el.textContent)
    .join('');
  const result = { mode, markup: root.innerHTML, css, rootStyle: doc.documentElement.getAttribute('style') || '' };
  window.close();
  return result;
}

// A copy missing its tokens or any emotion rule would paint wrong (the hero's
// gradient text is transparent without --accent) and restyle on the swap.
function assertComplete({ mode, markup, css, rootStyle }) {
  if (!rootStyle.includes('--accent:')) throw new Error(`prerender-landing: ${mode} copy has no theme tokens (--accent) on <html>`);
  if (!css) throw new Error(`prerender-landing: ${mode} copy captured no emotion CSS`);
  const classes = new Set(markup.match(/\bcss-[a-z0-9]+\b/g) || []);
  classes.delete('css-0'); // emotion's name for an empty style
  const unstyled = [...classes].filter((cls) => !css.includes(`.${cls}`));
  if (unstyled.length) throw new Error(`prerender-landing: ${mode} copy has classes with no captured rule: ${unstyled.join(' ')}`);
}

function assertCspAllowsGate(toml) {
  const hash = cspHash(GATE_SCRIPT);
  if (!toml.includes(`script-src 'self' ${hash}`)) {
    throw new Error(`prerender-landing: netlify.toml's CSP must read script-src 'self' ${hash}`);
  }
}

async function run(buildDir) {
  assertCspAllowsGate(fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8'));
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- buildDir is the build output dir from the CLI arg or default, not request input
  const indexPath = path.join(buildDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const snapshots = [];
  for (const mode of MODES) snapshots.push(await snapshot(buildDir, html, mode));
  snapshots.forEach(assertComplete);
  const out = injectPrerender(html, snapshots);
  // Every other path (the public pages) gets the plain shell via netlify.toml's
  // catch-all; only `/` (and so every hash route) carries the copy.
  fs.writeFileSync(path.join(buildDir, 'shell.html'), html);
  fs.writeFileSync(indexPath, out);
  console.log(`Prerendered the landing page into index.html (${Buffer.byteLength(html)} -> ${Buffer.byteLength(out)} bytes)`);
}

module.exports = { GATE_SCRIPT, cspHash, injectPrerender, assertComplete };

if (require.main === module) {
  run(process.argv[2] || path.join(__dirname, '..', 'build')).then(
    () => process.exit(0), // jsdom timers (webpack chunk timeouts) would otherwise hold the process
    (err) => {
      console.error(err.message);
      process.exit(1);
    }
  );
}
