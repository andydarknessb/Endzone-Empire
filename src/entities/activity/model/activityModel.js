/**
 * The league Activity read model, pure (ADR 0029: the entities layer). It is
 * the one spelling of a transaction row's one-line description: the Activity
 * page (`src/components/TransactionLog/TransactionLog.jsx`) used to derive it
 * inline per type, and a second reader of the same rows would have had to
 * duplicate the switch to agree with it (#1100). The derivation lives here
 * once; TransactionLog reads `sentence` off this model rather than
 * re-deriving it, so the two cannot drift.
 *
 * The shape:
 *
 *   { id, type, teamName, avatarUrl, avatarStaticUrl, sentence, at }
 *
 * `type` is one of add | drop | waiver | trade | commissioner (the transaction
 * types `GET /api/league/:id/transactions` documents) or stat_correction (an
 * NFL stat-correction row, carried for parity with the Activity page's
 * existing handling of them). `teamName` is null on a commissioner action
 * with no team (an account-level admin action, not a Team's own move).
 *
 * `sentence` NEVER repeats the Team name: it is the action alone ("added
 * Justin Jefferson", "claimed Breece Hall ($12), dropped Zach Wilson"), so a
 * caller renders `teamName` and `sentence` together exactly as the Activity
 * page's timeline row always has, and `teamName` stays independently usable
 * (the Team filter reads it alone, with no sentence to parse).
 *
 * `at` is the row's `created_at`, carried verbatim (an ISO string) so a caller
 * formats it however that surface always has (relative time, a day header).
 *
 * This module is pure: it imports nothing at all.
 */

/**
 * The one-line action a transaction row describes, with no Team name in it
 * (see the module docblock). A row of an unrecognized type reads as an empty
 * sentence rather than throwing, the same fallback TransactionLog's switch
 * always had.
 */
function sentenceFor(row) {
  const detail = row.detail || {};
  switch (row.type) {
    case 'add':
      return `added ${row.player_name}`;
    case 'drop':
      return `dropped ${row.player_name}`;
    case 'waiver': {
      const bidSuffix = typeof detail.bid === 'number' ? ` ($${detail.bid})` : '';
      const droppedSuffix =
        detail.droppedPlayerId && row.dropped_player_name
          ? `, dropped ${row.dropped_player_name}`
          : '';
      return `claimed ${row.player_name}${bidSuffix}${droppedSuffix}`;
    }
    case 'trade': {
      const items = Array.isArray(detail.items) ? detail.items : [];
      // Older trade rows were logged before names/team ids were baked into
      // detail; the generic sentence covers them rather than printing blanks.
      if (items.length === 0 || !detail.receivingTeamName) return 'completed a trade';
      const names = (list) => list.map((i) => i.playerName).join(', ');
      const sent = items.filter((i) => i.fromTeamId === detail.proposingTeamId);
      const received = items.filter((i) => i.toTeamId === detail.proposingTeamId);
      return `traded ${names(sent)} to ${detail.receivingTeamName} for ${names(received)}`;
    }
    case 'commissioner':
      return 'commissioner action';
    case 'stat_correction': {
      const changed = Array.isArray(detail.changes) ? detail.changes.length : 0;
      const week = detail.week;
      return `NFL stat correction updated ${changed} matchup score${changed === 1 ? '' : 's'}${
        week ? ` in week ${week}` : ''
      }`;
    }
    default:
      return '';
  }
}

/**
 * One transaction row (`GET /api/league/:id/transactions`) as the client
 * knows it. A null row yields an empty-shaped model rather than throwing.
 */
export function activityFromRow(row) {
  const r = row || {};
  return {
    id: r.id ?? null,
    type: r.type ?? null,
    teamName: r.team_name ?? null,
    avatarUrl: r.team_avatar_url ?? null,
    avatarStaticUrl: r.team_avatar_static_url ?? null,
    sentence: sentenceFor(r),
    at: r.created_at ?? null,
  };
}

/**
 * The whole read: every row mapped, in the server's own newest-first order,
 * sliced to `limit` client-side (the endpoint's own cap is 100; a caller
 * asking for fewer trims it further). A non-array body is an empty feed,
 * never a throw.
 */
export function activitiesFromResponse(rows, { limit } = {}) {
  const mapped = (Array.isArray(rows) ? rows : []).map(activityFromRow);
  return typeof limit === 'number' ? mapped.slice(0, limit) : mapped;
}
