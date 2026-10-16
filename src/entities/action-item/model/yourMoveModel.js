const HOUR_MS = 60 * 60 * 1000;

const timeMs = (value) => {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(at) ? null : at;
};

/**
 * The dashboard's "Your move" view (ADR 0067, wave 1b ruling 3) over the action
 * items `GET /api/user/action-items` returns. Pure.
 *
 * Only this league's items count. Items that share one non-null `deadlineAt`
 * form ONE card with a foot per item (the Shared Lock Rule: one lock, one card,
 * each action its own foot); an item with no deadline is a card of its own.
 * Cards run earliest deadline first, null deadlines last, server order kept
 * among equals. `lead` is the first card, `rest` the others, `badge` the card
 * count. `urgent` is true when any item locks from `now` up to 60 minutes later.
 *
 * @param {Array} items the wire items (id, type, leagueId, title, detail, severity, deadlineAt, cta)
 * @param {{ leagueId: number|string, now: number|Date }} ctx
 * @returns {{ cards: Array, lead: object|null, rest: Array, badge: number, empty: boolean, urgent: boolean }}
 *   a card is `{ key, deadlineAt, items, feet: [{ id, label, to }] }`
 */
export function yourMoveModel(items, { leagueId, now }) {
  const nowMs = new Date(now).getTime();
  const mine = (Array.isArray(items) ? items : []).filter((i) => String(i.leagueId) === String(leagueId));

  const cards = [];
  const byTime = new Map();
  mine.forEach((item, index) => {
    const at = timeMs(item.deadlineAt);
    let card = at == null ? null : byTime.get(at);
    if (!card) {
      card = { key: at == null ? `item:${item.id ?? index}` : `at:${at}`, deadlineAt: at == null ? null : item.deadlineAt, at, items: [] };
      cards.push(card);
      if (at != null) byTime.set(at, card);
    }
    card.items.push(item);
  });

  // Array.prototype.sort is stable, so equal and null deadlines keep server order.
  cards.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || 0);
  const out = cards.map(({ at, ...card }) => ({
    ...card,
    feet: card.items.map((i) => ({ id: i.id, label: i.cta?.label ?? null, to: i.cta?.to ?? null })),
  }));

  const urgent = mine.some((i) => {
    const at = timeMs(i.deadlineAt);
    return at != null && at >= nowMs && at - nowMs <= HOUR_MS;
  });

  return { cards: out, lead: out[0] ?? null, rest: out.slice(1), badge: out.length, empty: out.length === 0, urgent };
}
