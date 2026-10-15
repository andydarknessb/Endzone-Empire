// Checks the cursor follows hover and focus, leaves the lead, and the press and score flash rules apply.
const assert = require('assert');
const path = require('path');
const { chromium } = require('E:/endzone-empire/node_modules/playwright');
const R = path.join(__dirname, 'render');
const url = n => 'file:///' + path.join(R, n + '.html').replace(/\\/g, '/');
(async () => {
  const browser = await chromium.launch();
  for (const [board, w, h, motion] of [['DraftNightPhone-dark', 390, 900, 'no-preference'], ['FirstRun-light', 1440, 900, 'reduce']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: motion });
    await page.goto(url(board));
    const borders = () => page.$$eval('.slot', els => els.map(e => getComputedStyle(e).borderTopColor));
    const before = await borders();
    assert.notStrictEqual(before[0], 'rgba(0, 0, 0, 0)', board + ': lead holds the cursor');
    assert.strictEqual(before[1], 'rgba(0, 0, 0, 0)', board + ': second card starts clear');
    const slots = await page.$$('.slot');
    await slots[1].hover();
    await page.waitForTimeout(50);
    const hovered = await borders();
    assert.strictEqual(hovered[0], 'rgba(0, 0, 0, 0)', board + ': lead clears on hover elsewhere');
    assert.notStrictEqual(hovered[1], 'rgba(0, 0, 0, 0)', board + ': cursor on hovered card');
    await page.screenshot({ path: path.join(R, board + '-hover.png') });
    await page.mouse.move(0, 0);
    await page.focus('.slot:nth-of-type(1) a, .slot a'); // first link in the lead
    await page.keyboard.press('Tab');
    let focused = await borders();
    for (let i = 0; i < 4 && focused[1] === 'rgba(0, 0, 0, 0)'; i++) { await page.keyboard.press('Tab'); focused = await borders(); }
    assert.notStrictEqual(focused[1], 'rgba(0, 0, 0, 0)', board + ': cursor follows keyboard focus');
    assert.strictEqual(focused[0], 'rgba(0, 0, 0, 0)', board + ': one cursor under focus');
    const box = await slots[1].boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    const pressed = await slots[1].evaluate(e => [getComputedStyle(e).borderTopColor, getComputedStyle(e.firstElementChild).transform]);
    await page.mouse.up();
    assert.strictEqual(pressed[0], 'rgb(255, 255, 255)', board + ': press frame is white');
    assert.strictEqual(pressed[1], motion === 'reduce' ? 'none' : 'matrix(1, 0, 0, 1, 2, 2)', board + ': press drop matches motion pref');
    console.log(board, 'ok', motion);
    await page.close();
  }
  for (const motion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: motion });
    await page.goto(url('GameDay-dark'));
    const anim = await page.$eval('.scored', e => getComputedStyle(e).animationName + ' ' + getComputedStyle(e).animationIterationCount);
    assert.strictEqual(anim, motion === 'reduce' ? 'scoredHold 1' : 'scored 3', 'score flash ' + motion);
    console.log('GameDay score', anim);
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
