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
 *   { id, type, teamName, avatarUrl, avatarStaticUrl, sentence, players, segments, at }
 *
 * `type` is one of add | drop | waiver | trade | commissioner (the transaction
 * types `GET /api/league/:id/transactions` documents), stat_correction (an
 * NFL stat-correction row, carried for parity with the Activity page's
 * existing handling of them), or recap (a generated weekly recap being
 * published, #1134 - league-wide, like commissioner, so it carries no team
 * either). `teamName` is null on a commissioner or recap row (neither has a
 * Team's own move behind it). A type this module does not recognize (the
 * server declares the full list as `TRANSACTION_TYPES`,
 * `server/services/activity.service.js`) renders a generic sentence built
 * from the type itself rather than an empty one - see `genericSentenceFor`.
 *
 * `sentence` NEVER repeats the Team name: it is the action alone ("added
 * Justin Jefferson", "claimed Breece Hall ($12), dropped Zach Wilson"), so a
 * caller renders `teamName` and `sentence` together exactly as the Activity
 * page's timeline row always has, and `teamName` stays independently usable
 * (the Team filter reads it alone, with no sentence to parse).
 *
 * `players` is the structured form of every player name `sentence` flattens
 * into prose: `{ added: [{ name, playerId }], dropped: [{ name, playerId }] }`.
 * `added` is who the row's Team gained (the `add`ed player, a waiver claim's
 * target, a trade's received players); `dropped` is who it gave up (the
 * `drop`ped player, a waiver claim's dropped player, a trade's sent players).
 * The two stay separate specifically so a waiver row's claimed and dropped
 * player are never confused for each other. A row that names no player
 * (`commissioner`, `stat_correction`, or a trade logged before rich detail
 * existed) carries both as empty arrays, never a throw. This is how a caller
 * (`TransactionLog`) rebuilds `sentence` with clickable player names without
 * re-deriving its own per-type switch to find them.
 *
 * `segments` is `sentence` itself, pre-split into the pieces a caller needs
 * to render it with clickable player names: an ordered list of
 * `{ type: 'text', value }` and `{ type: 'player', name, playerId }` parts
 * whose `value`/`name`s concatenate back to exactly `sentence`. It exists
 * because matching player names back against the flat `sentence` string is
 * unsound — a suffixed name ("Josh Allen" vs. "Josh Allen Jr.") or a Team
 * name that happens to contain a player's surname ("Allen Army") makes text
 * matching pick the wrong span, and two same-named players resolve to
 * whichever one text search finds first (#1112). Each player is already a
 * distinct part in this list, so a caller like `TransactionLog` places a
 * `PlayerNameLink` at each `player` part and text at each `text` part,
 * in order, and never re-derives positions from prose.
 *
 * `at` is the row's `created_at`, carried verbatim (an ISO string) so a caller
 * formats it however that surface always has (relative time, a day header).
 *
 * This module is pure: it imports nothing at all.
 */

/**
 * `recap`'s sentence, shared verbatim between `sentenceFor` and `segmentsFor`
 * (it is plain text either way, so there is nothing for `segmentsFor` to
 * split): "Week N recap published" when the row's `detail.week` is a number,
 * "Recap published" when it is absent (an older or malformed row).
 */
function recapSentence(detail) {
  return typeof detail.week === 'number' ? `Week ${detail.week} recap published` : 'Recap published';
}

/**
 * The generic sentence for a type neither builder has a case for: a future
 * server addition (#1134 - `recap` was exactly this before it got its own
 * case above). Capitalized, with underscores turned to spaces the way
 * `recentActivityModel.js`'s `activityBadge` fallback already reads a raw
 * type, plus the word "activity" so the result reads as a sentence rather
 * than a bare label: `foo_bar` -> "Foo bar activity". A non-string or empty
 * type (a wholly missing/null row, `activityFromRow(null)`) stays the empty
 * string - that shape predates this ticket and is pinned by its own test.
 */
function genericSentenceFor(type) {
  if (typeof type !== 'string' || !type) return '';
  const spaced = type.replace(/_/g, ' ');
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)} activity`;
}

/**
 * The one-line action a transaction row describes, with no Team name in it
 * (see the module docblock). A row of an unrecognized type reads as a
 * generic sentence built from the type (`genericSentenceFor`) rather than
 * throwing or rendering blank (#1134); only a wholly missing type (a null
 * row) still reads as empty, unchanged from before this ticket.
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
    case 'recap':
      return recapSentence(detail);
    case 'stat_correction': {
      const changed = Array.isArray(detail.changes) ? detail.changes.length : 0;
      const week = detail.week;
      return `NFL stat correction updated ${changed} matchup score${changed === 1 ? '' : 's'}${
        week ? ` in week ${week}` : ''
      }`;
    }
    default:
      return genericSentenceFor(row.type);
  }
}

/**
 * The structured player references `sentence` flattens into prose for this
 * row: `{ added, dropped }`, each a list of `{ name, playerId }` (see the
 * module docblock for which side each transaction type's players land on).
 * Mirrors `sentenceFor`'s own per-type guards exactly, so a name only ever
 * appears here when it also appears in the sentence.
 */
function playersFor(row) {
  const detail = row.detail || {};
  switch (row.type) {
    case 'add':
      return { added: [{ name: row.player_name, playerId: detail.playerId }], dropped: [] };
    case 'drop':
      return { added: [], dropped: [{ name: row.player_name, playerId: detail.playerId }] };
    case 'waiver': {
      const added = [{ name: row.player_name, playerId: detail.playerId }];
      const dropped =
        detail.droppedPlayerId && row.dropped_player_name
          ? [{ name: row.dropped_player_name, playerId: detail.droppedPlayerId }]
          : [];
      return { added, dropped };
    }
    case 'trade': {
      const items = Array.isArray(detail.items) ? detail.items : [];
      // Mirrors sentenceFor's own fallback: no rich detail, no names to link.
      if (items.length === 0 || !detail.receivingTeamName) return { added: [], dropped: [] };
      const ref = (i) => ({ name: i.playerName, playerId: i.playerId });
      const sent = items.filter((i) => i.fromTeamId === detail.proposingTeamId);
      const received = items.filter((i) => i.toTeamId === detail.proposingTeamId);
      return { added: received.map(ref), dropped: sent.map(ref) };
    }
    default:
      return { added: [], dropped: [] };
  }
}

const text = (value) => ({ type: 'text', value });
const player = (name, playerId) => ({ type: 'player', name, playerId });

// A comma-joined run of player parts, exactly as `sentenceFor`'s own
// `names(list).join(', ')` renders the same list as text.
function playerListSegments(items) {
  const segs = [];
  items.forEach((item, i) => {
    if (i > 0) segs.push(text(', '));
    segs.push(player(item.playerName, item.playerId));
  });
  return segs;
}

/**
 * `sentence`, pre-split into ordered text/player parts (see the module
 * docblock). Mirrors `sentenceFor` part for part — same per-type guards, same
 * literal words — so the two can never disagree about what the sentence
 * says, only about whether a player's name is plain text or a linkable part.
 */
function segmentsFor(row) {
  const detail = row.detail || {};
  switch (row.type) {
    case 'add':
      return [text('added '), player(row.player_name, detail.playerId)];
    case 'drop':
      return [text('dropped '), player(row.player_name, detail.playerId)];
    case 'waiver': {
      const bidSuffix = typeof detail.bid === 'number' ? ` ($${detail.bid})` : '';
      const segs = [text('claimed '), player(row.player_name, detail.playerId)];
      if (bidSuffix) segs.push(text(bidSuffix));
      if (detail.droppedPlayerId && row.dropped_player_name) {
        segs.push(text(', dropped '), player(row.dropped_player_name, detail.droppedPlayerId));
      }
      return segs;
    }
    case 'trade': {
      const items = Array.isArray(detail.items) ? detail.items : [];
      if (items.length === 0 || !detail.receivingTeamName) return [text('completed a trade')];
      const sent = items.filter((i) => i.fromTeamId === detail.proposingTeamId);
      const received = items.filter((i) => i.toTeamId === detail.proposingTeamId);
      return [
        text('traded '),
        ...playerListSegments(sent),
        text(` to ${detail.receivingTeamName} for `),
        ...playerListSegments(received),
      ];
    }
    case 'commissioner':
      return [text('commissioner action')];
    case 'recap':
      return [text(recapSentence(detail))];
    case 'stat_correction': {
      const changed = Array.isArray(detail.changes) ? detail.changes.length : 0;
      const week = detail.week;
      return [
        text(
          `NFL stat correction updated ${changed} matchup score${changed === 1 ? '' : 's'}${
            week ? ` in week ${week}` : ''
          }`
        ),
      ];
    }
    default:
      return [text(genericSentenceFor(row.type))];
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
    players: playersFor(r),
    segments: segmentsFor(r),
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
