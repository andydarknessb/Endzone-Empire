// Trade Center on a phone, same moment as Trades (Sunday 9:10 AM CDT, Pending tab).
const k = require('./league-kit-trades');
const out = process.argv[2];

const cards = k.pendingCards({ phone: true });
const notes = k.notes([
  "Same page, same cards, one column. The cursor stays on the Gridiron Ghosts offer; there is no filled action (Propose Trade, Accept Trade, Decline, Counter, Cancel, Vote to Veto, Analyze Trade and the commissioner's two buttons are ghost, 44px). The product has no breakpoint logic: columns stack below sm, and so does the dialog (TradePropose draws the full-screen dialog).",
  "Card actions wrap and share the row (140px minimum each) with 'Analyze Trade' always last, so three actions and Analyze sit two over two without a side scroll. Each side of the title (avatar, name, You badge) is one nowrap unit, so a team never breaks from its own avatar and the wrap falls between the two teams, with the arrow staying at the end of the first. The commissioner's row appears only on the Pocket Aces and Fumble Rooskie card (the commissioner's own trades carry none), its label stacked over the two buttons. The tablist is the segmented control at full width, 'Propose Trade' (ghost) sits under the h1 and sub-line, and the head's back link is the league name. 'League review ends Sun 9:30 PM' (data gap, review_ends_at; accepted Sat 9:30 PM plus the 24-hour review) wraps under the age.",
]);
const body = `<main style="max-width: 390px; margin: 0 auto; padding: 14px 16px 32px; display: flex; flex-direction: column; gap: 16px; min-height: 100vh; box-sizing: border-box">
${k.trHead({ phone: true })}
${k.trTabs({ selected: 0, phone: true })}
<section id="tr-panel" role="tabpanel" aria-labelledby="tr-tab-0" style="display: flex; flex-direction: column; gap: 8px; min-width: 0">
${cards.join('\n')}
</section>
${notes}
</main>`;
k.write(out, 'TradesPhone.dc.html', k.page({ title: 'Trades, pending, phone', w: 390, h: 2485, body, phone: true }));
console.log('ok');
