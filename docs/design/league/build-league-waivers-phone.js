// Waivers on a phone (390), same moment as Waivers (Sun Oct 18 9:10 AM CDT), On waivers tab, player cards in Upgrade order.
const k = require('./league-kit-waivers');
const out = process.argv[2];
const { POOL, CURSOR, f1 } = k;

const shown = POOL.slice(0, 6); // list order: Upgrade, highest first; Kimani Vidal is the on-bye variant
const cards = shown.map(p => `<li>${k.playerCard(p, { cursor: p === CURSOR })}</li>`).join('');
const list = `<section aria-label="Players" style="display: flex; flex-direction: column; gap: 12px; min-width: 0"><ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px">${cards}</ul>${k.pager({ caption: `${k.TOTAL} players` })}</section>`;

const notes = k.notes([
  `Cursor: ${CURSOR.name}'s card (Upgrade +${f1(CURSOR.up)} Wk ${CURSOR.upWk}), the largest positive Upgrade among the cards on the page that is not already claimed (ties by that week's projection, then name); Rashid Shaheed is higher but is claim #1. The card wears the 4px Cursor frame (Danger if it cleared in under an hour). The one filled action is that card's Claim (44px, Accent); every other Claim, 'Claim #1' and 'Claim #2' included, is a ghost.`,
  `Cards (below 600px) keep the product's fields: name, injury code, position, team, opponent, Status with 'Clears in 2d 16h', Proj Wk, ROS, Upgrade ('+x Wk n'), the weekly bars, the expand toggle and the action, all 44px. Kimani Vidal is the on-bye variant: Proj Wk reads 'on bye', the opponent slot reads 'Bye 7' and his Upgrade reads in Week 8. Tertiary edges use the Frame colour token, so they read on the light Field. The summary frame is two by two; the 'Waivers view' radio group carries its count as a description ('2 pending claims'), not in the name. Search keeps its own line with Filters under it (the drawer is on WaiversStates).`,
  `The board draws the first 6 of the page's 10 cards, in Upgrade order. Each card carries the neutral initials PlayerAvatar and a 44px name button. The result chip holds the outcome word and the line beneath holds the detail (My claims tab, WaiversStates). Product changes, fixture, the Upgrade model and the Tyler Allgeier trade interaction (if the pending trade to Waiver Wolves executes, both claims lose their drop) are the desktop board's. Focus: the claim sheet opens with focus on its first control, returns to the card's Claim or 'Claim #n' on close, and the cursor's move after a claim is announced ('Next: {name}, +x Wk n'). Times are CDT.`,
]);

const body = `<main style="max-width: 390px; margin: 0 auto; padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 16px; min-height: 100vh; box-sizing: border-box">
${k.wvHead({ phone: true })}
${k.summary({ tiles: k.TILES_FAAB, phone: true })}
${k.viewControl({ selected: 'waivers' })}
${k.phoneControls()}
${list}
${notes}
</main>`;
k.write(out, 'WaiversPhone.dc.html', k.page({ title: 'Waivers, phone', w: 390, h: 2654, body, phone: true }));
console.log('ok');
