// Waivers, desktop 1440, Thursday Night Regulars, Week 7, Sunday Oct 18 9:10 AM CDT. Viewer: Darkness Falls. FAAB league, roster full, 2 pending claims sharing one drop.
const k = require('./league-kit-waivers');
const out = process.argv[2];
const { FRAME, frameHead, h2, POOL, CURSOR, f1 } = k;

const detail = k.rowDetail(CURSOR, ['Wilson logged a full practice on Friday.', 'Arizona lists Wilson as its No. 2 receiver on the Week 7 depth chart.']);
const list = `<section aria-labelledby="pl-h" style="${FRAME}; min-width: 0">${frameHead(h2('pl-h', 'Players'))}${k.controls()}${k.wvTable({ rows: POOL, cursor: CURSOR, expanded: CURSOR.name, detail })}${k.pager()}</section>`;
const aside = `<aside aria-label="Waivers side panel" style="display: flex; flex-direction: column; gap: 16px; min-width: 0">${k.claimsFrame()}${k.byeFrame()}</aside>`;
const S = POOL.find(p => p.claim === 1);

const notes = k.notes([
  `Cursor: ${CURSOR.name}'s row (WR, ARI, Upgrade +${f1(CURSOR.up)} Wk ${CURSOR.upWk}) in a 4px Cursor frame. The selector is pure and uses only the rows on the page as the viewer has them (sort, filter, page; no new read): the unclaimed row with the largest positive Upgrade whatever week it reads in, ties by that week's projection, then name. Rows with a pending claim are skipped, which is why Rashid Shaheed (+${f1(S.up)} Wk ${S.upWk}, claim #1) does not take it. The frame turns Danger when the cursor row clears in under an hour. Best ball (no Upgrade) or no positive Upgrade: no cursor and no filled action (specimen on WaiversStates).`,
  `Filled action: that row's Claim (44px, Accent). Every other Claim is a ghost, and a pending row reads 'Claim #1' or 'Claim #2' as a ghost with 'You already have a pending claim on this player.' as its description. Product change: today every unclaimed row's Claim is contained (up to 25 filled buttons). Table buttons are 44px, the expand toggle and every player-name button included; the PlayerAvatar is drawn as a neutral initials square (aria-hidden) (tests/e2e/waivers.spec.ts asserts it at 1280). Submit claim in the sheet stays filled (modal; see WaiversStates).`,
  `Upgrade model: the product's (ADR 0055 point 1, ADR 0062; playerCard.service.js:313-326): the gain to Darkness Falls' optimal lineup, starters and bench, read in the player's first playable week after his Clear time. Claims clear Wed 2:00 AM, after Monday night, so every pill reads '+x Wk 8', or Wk 9 when his team is on bye in Week 8 (ARI: Michael Wilson, LV: Gardner Minshew, whose gain is 0, so no pill). Week 8 is thin for Darkness Falls (Gibbs, Nacua, McBride and Bigsby are on bye), so the sheet names a swap for each ('Wk 8 swap'). Puka Nacua is projected healthy after Week 7 (a fixture assumption).`,
  `Product changes drawn (each a spec item): summary strip as one tertiary frame of figures with 'Full' a word chip; the Upgrade pill an outlined Ink badge; result chips outlined (the chip holds the outcome word, 'Won · $12', 'Lost' or 'Didn't go through', and the line beneath holds the detail, 'to Waiver Wolves · won at $17 · your bid $9'); injury as codes (Q, D, O, IR) with the status as screen-reader text; the shared-drop warning once for the group (the product repeats it per claim); pending rows print the bid ('Bid $14', already in the claims read); the Clear time line reads 'resolve at Wed 2:00 AM CDT' (the product prints toLocaleString); the Bye clusters line reads 'Waivers clear Wed 2:00 AM.' under a blanket clear (byeClusterCopy.js:24-36); tile figures spell units ('2 DAYS 16 H'); the 'My claims' radio carries its count as a description, not in its name.`,
  `Fixture: FAAB, 48-hour waiver period, claims clear together Wed 2:00 AM (the product's blanket branch: 'Waivers clear Wed 2:00 AM'), so every row says 'Clears in 2d 16h' and nothing here is under an hour (Danger specimen on WaiversStates). roster_limit 15, ir_slots 1: 15 of 15 counts the IR player, so every claim needs a drop. $100 budget: $12 and $7 won, $19 held by the two bids, $62 left. Gardner Minshew is the Bench Mob drop from the feed. Times are CDT.`,
  `Focus (claim and edit sheets): focus starts on the first control (the drop list when full, else the bid field), Escape and Cancel return focus to the row's Claim or 'Claim #n' button, a saved claim announces 'Waiver claim submitted' in one polite region, and when a claim lands the cursor moves to the next unclaimed row, announced as 'Next: {name}, +x Wk n'. Known interaction: Tyler Allgeier, the shared drop of both pending claims, also goes out in the pending trade to Waiver Wolves (Trades board); if that trade executes, both claims lose their drop. Data gaps: Main's feed lists only the Minshew drop while the pool holds thirteen other recent drops; page size (10) and the pager are the server's; ownership and weekly bars are fixture figures.`,
]);

const body = `<main style="max-width: 1376px; margin: 0 auto; padding: 24px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${k.wvHead()}
${k.summary({ tiles: k.TILES_FAAB })}
<div style="display: grid; grid-template-columns: minmax(0, 1fr) 384px; gap: 24px; align-items: start">
${list}
${aside}
</div>
${notes}
</main>`;
k.write(out, 'Waivers.dc.html', k.page({ title: 'Waivers', w: 1440, h: 2043, body }));
console.log('ok');
