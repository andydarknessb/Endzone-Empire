const test = require('node:test');
const assert = require('node:assert/strict');
const { inlineMainCss } = require('./inline-main-css');

// CRA emits the entry stylesheet minified, one tag, href before rel.
const MAIN = '<link href="/static/css/main.e9380036.css" rel="stylesheet">';
const CHUNK = '<link href="/static/css/8807.7b17a813.chunk.css" rel="stylesheet">';
const css = '@font-face{src:url(/static/media/a.woff2)}body{margin:0}';

test('replaces the main stylesheet link with an inline style tag', () => {
  const html = `<head><script defer src="/static/js/main.1.js"></script>${MAIN}</head><body></body>`;
  const out = inlineMainCss(html, css);
  assert.equal(out, `<head><script defer src="/static/js/main.1.js"></script><style>${css}</style></head><body></body>`);
});

test('matches the attributes in either order', () => {
  const out = inlineMainCss('<link rel="stylesheet" href="/static/css/main.abc123.css">', css);
  assert.equal(out, `<style>${css}</style>`);
});

test('leaves chunk stylesheet links and everything else untouched', () => {
  const html = `<head><link rel="icon" href="/favicon.ico">${CHUNK}${MAIN}</head>`;
  const out = inlineMainCss(html, css);
  assert.ok(out.includes(CHUNK));
  assert.ok(out.includes('<link rel="icon" href="/favicon.ico">'));
  assert.ok(!out.includes('main.e9380036.css'));
});

test('does not treat "$&" style sequences in the css as replacement patterns', () => {
  const out = inlineMainCss(MAIN, 'a{content:"$&$1"}');
  assert.equal(out, '<style>a{content:"$&$1"}</style>');
});

test('throws when there is no main stylesheet link', () => {
  assert.throws(() => inlineMainCss(`<head>${CHUNK}</head>`, css), /no main stylesheet link/i);
});

test('throws when there is more than one main stylesheet link', () => {
  assert.throws(() => inlineMainCss(`${MAIN}${MAIN}`, css), /2 main stylesheet links/i);
});

test('drops the trailing sourceMappingURL comment, which would resolve against the page URL', () => {
  const out = inlineMainCss(MAIN, 'a{b:c}\n/*# sourceMappingURL=main.e9380036.css.map*/');
  assert.equal(out, '<style>a{b:c}</style>');
});
