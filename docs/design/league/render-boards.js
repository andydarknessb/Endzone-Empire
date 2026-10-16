// Static render of .dc.html boards (tokens resolved) + Playwright screenshots, dark and light.
const fs = require('fs');
const path = require('path');
const { chromium } = require('E:/endzone-empire/node_modules/playwright');
const [, , projArg, outArg, only] = process.argv;
const projDir = path.resolve(projArg), outDir = path.resolve(outArg);
fs.mkdirSync(outDir, { recursive: true });
const canvas = JSON.parse(fs.readFileSync(path.join(projDir, 'canvas.json'), 'utf8'));

function tokens(src, light) {
  const cls = src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  const fn = new Function('DCLogic', cls + '\nreturn Component;');
  const C = fn(class {});
  const c = new C(); c.props = { light };
  return c.renderVals().t;
}

(async () => {
  const browser = await chromium.launch();
  for (const [file, b] of Object.entries(canvas.boards)) {
    if (only && !only.split(',').includes(file.replace('.dc.html', ''))) continue;
    if (!fs.existsSync(path.join(projDir, file))) continue;
    const src = fs.readFileSync(path.join(projDir, file), 'utf8');
    const helmet = (src.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ''])[1];
    const body = src.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1].replace(/<helmet>[\s\S]*?<\/helmet>/, '');
    for (const light of [false, true]) {
      const t = tokens(src, light);
      const html = `<!doctype html><html><head><meta charset="utf-8">${helmet}</head><body>${body}</body></html>`
        .replace(/\{\{t\.(\w+)\}\}/g, (_, k) => { if (!(k in t)) throw new Error(`${file}: missing token ${k}`); return t[k]; });
      const name = file.replace('.dc.html', '') + (light ? '-light' : '-dark');
      fs.writeFileSync(path.join(outDir, name + '.html'), html);
      const page = await browser.newPage({ viewport: { width: b.w, height: b.h }, reducedMotion: 'reduce' });
      await page.goto('file:///' + path.join(outDir, name + '.html').replace(/\\/g, '/'));
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }));
      await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: true });
      // Local canvas tooling: the board name comes from canvas.json in this folder.
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
      console.log(name, `board ${b.w}x${b.h}`, `content ${overflow.sw}x${overflow.sh}`, overflow.sw > b.w ? 'H-OVERFLOW' : '', overflow.sh > b.h ? 'TALLER-THAN-BOARD' : '');
      await page.close();
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
