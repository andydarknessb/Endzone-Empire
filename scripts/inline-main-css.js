// Inlines the entry stylesheet into build/index.html after `react-scripts build`.
//
// The entry CSS (build/static/css/main.<hash>.css, about 1.3 KiB) is a
// render-blocking request in the document head; Lighthouse measured it at
// 80-190 ms before first paint. Its url() references are absolute
// (/static/media/...), so the same bytes work inside a <style> element, and the
// CSP already allows inline styles. The .css file stays on disk, and lazy chunk
// stylesheets are loaded by the runtime, so they are never touched.
//
// Fails the build when the link is missing or ambiguous: a CRA upgrade that
// changes the emitted tag must stop the deploy, not quietly ship the blocking
// request again.
const fs = require('fs');
const path = require('path');

const MAIN_CSS_HREF = /href=["']?(\/static\/css\/main\.[\w-]+\.css)["']?/;

// Every <link rel=stylesheet> tag for the entry CSS, whatever the attribute order.
function mainCssLinks(html) {
  return (html.match(/<link\b[^>]*>/g) || [])
    .filter((tag) => /rel=["']?stylesheet\b/.test(tag))
    .map((tag) => ({ tag, href: (tag.match(MAIN_CSS_HREF) || [])[1] }))
    .filter((link) => link.href);
}

function inlineMainCss(html, css) {
  const links = mainCssLinks(html);
  if (links.length !== 1) {
    throw new Error(
      links.length === 0
        ? 'inline-main-css: no main stylesheet link (/static/css/main.<hash>.css) in index.html'
        : `inline-main-css: expected one main stylesheet link, found ${links.length} main stylesheet links in index.html`
    );
  }
  // Inline, the map reference would resolve against the page URL and 404.
  const inline = css.replace(/\s*\/\*# sourceMappingURL=[^*]*\*\/\s*$/, '');
  // A function replacement keeps "$&" and friends in the CSS literal.
  return html.replace(links[0].tag, () => `<style>${inline}</style>`);
}

function run(buildDir) {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- buildDir is the build output dir from the CLI arg or default, not request input
  const indexPath = path.join(buildDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const links = mainCssLinks(html);
  // inlineMainCss throws the zero/many-match error; the read below needs exactly one.
  if (links.length !== 1) inlineMainCss(html, '');
  const { href } = links[0];
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- href is matched by MAIN_CSS_HREF, so it is /static/css/main.<word chars or dashes>.css: no ".." or extra separators
  const css = fs.readFileSync(path.join(buildDir, href), 'utf8');
  fs.writeFileSync(indexPath, inlineMainCss(html, css));
  console.log(`Inlined ${href} (${Buffer.byteLength(css)} bytes) into index.html`);
}

module.exports = { inlineMainCss, mainCssLinks };

if (require.main === module) {
  try {
    run(process.argv[2] || path.join(__dirname, '..', 'build'));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
