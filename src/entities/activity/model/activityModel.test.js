import { activityFromRow, activitiesFromResponse, genericSentenceFor } from './activityModel';

// One wire row per type, exactly as GET /api/league/:id/transactions joins it
// (league.router.js: teams + players + dropped_player left-joined onto the
// transaction). Newest first, matching the server's ORDER BY.
const rows = [
  {
    id: 5,
    type: 'commissioner',
    team_name: null,
    team_avatar_url: null,
    team_avatar_static_url: null,
    player_name: null,
    dropped_player_name: null,
    detail: { action: 'grant_co_commissioner' },
    created_at: '2026-09-09T16:00:00.000Z',
  },
  {
    id: 4,
    type: 'trade',
    team_name: "Alice's Team",
    team_avatar_url: 'https://cdn.example/alice.png',
    team_avatar_static_url: 'https://cdn.example/alice-static.png',
    player_name: null,
    dropped_player_name: null,
    detail: {
      proposingTeamId: 10,
      receivingTeamId: 20,
      receivingTeamName: "Bob's Team",
      items: [
        { playerId: 1, playerName: 'Player A', fromTeamId: 10, toTeamId: 20 },
        { playerId: 2, playerName: 'Player B', fromTeamId: 20, toTeamId: 10 },
      ],
    },
    created_at: '2026-09-09T15:00:00.000Z',
  },
  {
    id: 3,
    type: 'waiver',
    team_name: "Carol's Team",
    team_avatar_url: null,
    team_avatar_static_url: null,
    player_name: 'Breece Hall',
    dropped_player_name: 'Zach Wilson',
    detail: { playerId: 7, droppedPlayerId: 9, bid: 12 },
    created_at: '2026-09-09T14:00:00.000Z',
  },
  {
    id: 2,
    type: 'drop',
    team_name: "Dave's Team",
    team_avatar_url: null,
    team_avatar_static_url: null,
    player_name: 'Zach Wilson',
    dropped_player_name: null,
    detail: { playerId: 9 },
    created_at: '2026-09-09T13:00:00.000Z',
  },
  {
    id: 1,
    type: 'add',
    team_name: "Dave's Team",
    team_avatar_url: null,
    team_avatar_static_url: null,
    player_name: 'Justin Jefferson',
    dropped_player_name: null,
    detail: { playerId: 1 },
    created_at: '2026-09-09T12:00:00.000Z',
  },
];

const byType = (type) => rows.find((r) => r.type === type);

describe('activityFromRow: the one sentence per transaction type', () => {
  test('add names the player and carries the Team', () => {
    const model = activityFromRow(byType('add'));
    expect(model.sentence).toBe('added Justin Jefferson');
    expect(model.teamName).toBe("Dave's Team");
  });

  test('drop names the player', () => {
    expect(activityFromRow(byType('drop')).sentence).toBe('dropped Zach Wilson');
  });

  test('waiver names the claimed player, the bid, and the dropped player', () => {
    const model = activityFromRow(byType('waiver'));
    expect(model.sentence).toBe("claimed Breece Hall ($12), dropped Zach Wilson");
    expect(model.teamName).toBe("Carol's Team");
  });

  // Red-tell: player_name and dropped_player_name are read by field name, not
  // by position, so swapping them in the fixture must turn ONLY this waiver
  // case red.
  test('red-tell: swapping player_name and dropped_player_name changes only the waiver sentence', () => {
    const swapped = activityFromRow({
      ...byType('waiver'),
      player_name: 'Zach Wilson',
      dropped_player_name: 'Breece Hall',
    });
    expect(swapped.sentence).toBe('claimed Zach Wilson ($12), dropped Breece Hall');
    expect(swapped.sentence).not.toBe(activityFromRow(byType('waiver')).sentence);
  });

  test('trade names the sent and received players and the receiving Team', () => {
    const model = activityFromRow(byType('trade'));
    expect(model.sentence).toBe("traded Player A to Bob's Team for Player B");
    expect(model.avatarUrl).toBe('https://cdn.example/alice.png');
    expect(model.avatarStaticUrl).toBe('https://cdn.example/alice-static.png');
  });

  test('an older trade row with no rich detail falls back to a generic sentence', () => {
    const model = activityFromRow({ ...byType('trade'), detail: {} });
    expect(model.sentence).toBe('completed a trade');
  });

  test('commissioner names no player, and a teamless row reads its Team as null', () => {
    const model = activityFromRow(byType('commissioner'));
    expect(model.sentence).toBe('commissioner action');
    expect(model.teamName).toBeNull();
  });

  test('recap with a week reads "Week N recap published", teamless', () => {
    const model = activityFromRow({
      type: 'recap',
      team_name: null,
      detail: { season: 2026, week: 4 },
    });
    expect(model.sentence).toBe('Week 4 recap published');
    expect(model.teamName).toBeNull();
  });

  test('recap with no week reads "Recap published"', () => {
    const model = activityFromRow({ type: 'recap', team_name: null, detail: { season: 2026 } });
    expect(model.sentence).toBe('Recap published');
  });

  // Red-tell: removing the `recap` case from either builder makes this fail
  // the same way `foo_bar` does below (#1134).
  test('an unrecognized type never renders blank: it reads a generic sentence built from the type', () => {
    const model = activityFromRow({ type: 'foo_bar', team_name: null, detail: {} });
    expect(model.sentence).toBe('Foo bar activity');
  });

  test('a null row yields an empty-shaped model rather than throwing', () => {
    expect(activityFromRow(null)).toEqual({
      id: null,
      type: null,
      teamName: null,
      avatarUrl: null,
      avatarStaticUrl: null,
      sentence: '',
      players: { added: [], dropped: [] },
      segments: [{ type: 'text', value: '' }],
      at: null,
    });
  });
});

// Renders segments back to a string the same way a caller would (text
// verbatim, a player part as its name) — used to assert segments and
// sentence never disagree about what the sentence says.
const renderSegments = (segments) =>
  segments.map((s) => (s.type === 'player' ? s.name : s.value)).join('');

describe('activityFromRow: segments, sentence pre-split for clickable names', () => {
  test.each(['add', 'drop', 'waiver', 'trade', 'commissioner'])(
    '%s: segments render back to exactly the sentence',
    (type) => {
      const model = activityFromRow(byType(type));
      expect(renderSegments(model.segments)).toBe(model.sentence);
    }
  );

  test('an older trade row with no rich detail: segments render back to the fallback sentence', () => {
    const model = activityFromRow({ ...byType('trade'), detail: {} });
    expect(renderSegments(model.segments)).toBe(model.sentence);
    expect(model.segments).toEqual([{ type: 'text', value: 'completed a trade' }]);
  });

  test('stat_correction: a text-only segment, matching the sentence', () => {
    const model = activityFromRow({
      type: 'stat_correction',
      team_name: null,
      detail: { week: 4, changes: [{ matchupId: 9 }, { matchupId: 11 }] },
    });
    expect(renderSegments(model.segments)).toBe(model.sentence);
    expect(model.segments).toEqual([{ type: 'text', value: model.sentence }]);
  });

  test('recap: a text-only segment, matching the sentence', () => {
    const model = activityFromRow({ type: 'recap', team_name: null, detail: { week: 4 } });
    expect(renderSegments(model.segments)).toBe(model.sentence);
    expect(model.segments).toEqual([{ type: 'text', value: 'Week 4 recap published' }]);
  });

  // Both recapSentence branches must be covered through segmentsFor, not
  // just sentenceFor: the two builders share the helper, but a regression in
  // segmentsFor's own no-week handling would otherwise go undetected here.
  test('recap with no week: a text-only segment reading "Recap published"', () => {
    const model = activityFromRow({ type: 'recap', team_name: null, detail: {} });
    expect(renderSegments(model.segments)).toBe(model.sentence);
    expect(model.segments).toEqual([{ type: 'text', value: 'Recap published' }]);
  });

  test('an unrecognized type: a text-only segment matching the generic sentence', () => {
    const model = activityFromRow({ type: 'foo_bar', team_name: null, detail: {} });
    expect(model.segments).toEqual([{ type: 'text', value: 'Foo bar activity' }]);
  });

  test('add: one player part, carrying its playerId', () => {
    const model = activityFromRow(byType('add'));
    expect(model.segments).toEqual([
      { type: 'text', value: 'added ' },
      { type: 'player', name: 'Justin Jefferson', playerId: 1 },
    ]);
  });

  // Regression (#1112): matching player names back against the flat sentence
  // is unsound whenever one name is a prefix of another. A waiver claiming
  // "Josh Allen" while dropping "Josh Allen Jr." must still link each name
  // to its OWN playerId, not have the dropped link resolve to the added
  // player because "Josh Allen" is found first.
  test('waiver: a dropped player whose name prefixes the added player\'s name still links to its own id', () => {
    const model = activityFromRow({
      type: 'waiver',
      team_name: "Alice's Team",
      player_name: 'Josh Allen',
      dropped_player_name: 'Josh Allen Jr.',
      detail: { playerId: 1, droppedPlayerId: 2, bid: 5 },
    });
    expect(model.sentence).toBe('claimed Josh Allen ($5), dropped Josh Allen Jr.');
    const playerParts = model.segments.filter((s) => s.type === 'player');
    expect(playerParts).toEqual([
      { type: 'player', name: 'Josh Allen', playerId: 1 },
      { type: 'player', name: 'Josh Allen Jr.', playerId: 2 },
    ]);
    expect(renderSegments(model.segments)).toBe(model.sentence);
  });

  // Regression (#1112): a Team name embedded in a trade sentence can contain
  // a player's surname ("Allen Army" contains "Allen"). The team name must
  // stay plain text, never mistaken for a player part.
  test('trade: a Team name containing a player surname stays plain text, not a player part', () => {
    const model = activityFromRow({
      type: 'trade',
      team_name: "Alice's Team",
      detail: {
        proposingTeamId: 10,
        receivingTeamName: 'Allen Army',
        items: [
          { playerId: 5, playerName: 'Allen', fromTeamId: 10, toTeamId: 20 },
          { playerId: 6, playerName: 'Smith', fromTeamId: 20, toTeamId: 10 },
        ],
      },
    });
    expect(model.sentence).toBe('traded Allen to Allen Army for Smith');
    expect(model.segments).toEqual([
      { type: 'text', value: 'traded ' },
      { type: 'player', name: 'Allen', playerId: 5 },
      { type: 'text', value: ' to Allen Army for ' },
      { type: 'player', name: 'Smith', playerId: 6 },
    ]);
  });

  // Regression (#1112): the same player name on both sides of a trade (two
  // different players who happen to share a name) must resolve to two
  // distinct playerIds, not both to whichever occurrence text search finds
  // first.
  test('trade: the same player name sent and received keeps its own distinct id on each side', () => {
    const model = activityFromRow({
      type: 'trade',
      team_name: 'Team A',
      detail: {
        proposingTeamId: 10,
        receivingTeamName: 'Team X',
        items: [
          { playerId: 100, playerName: 'Foo Bar', fromTeamId: 10, toTeamId: 20 },
          { playerId: 200, playerName: 'Foo Bar', fromTeamId: 20, toTeamId: 10 },
        ],
      },
    });
    expect(model.sentence).toBe('traded Foo Bar to Team X for Foo Bar');
    const playerParts = model.segments.filter((s) => s.type === 'player');
    expect(playerParts).toEqual([
      { type: 'player', name: 'Foo Bar', playerId: 100 },
      { type: 'player', name: 'Foo Bar', playerId: 200 },
    ]);
  });
});

describe('activityFromRow: players, the structured references sentence flattens', () => {
  test('add: the added player, no dropped side', () => {
    const model = activityFromRow(byType('add'));
    expect(model.players).toEqual({
      added: [{ name: 'Justin Jefferson', playerId: 1 }],
      dropped: [],
    });
  });

  test('drop: the dropped player, no added side', () => {
    const model = activityFromRow(byType('drop'));
    expect(model.players).toEqual({
      added: [],
      dropped: [{ name: 'Zach Wilson', playerId: 9 }],
    });
  });

  test('waiver: the claimed player and the dropped player stay on distinct sides', () => {
    const model = activityFromRow(byType('waiver'));
    expect(model.players).toEqual({
      added: [{ name: 'Breece Hall', playerId: 7 }],
      dropped: [{ name: 'Zach Wilson', playerId: 9 }],
    });
  });

  // Red-tell: swapping which player was added vs. dropped in the fixture
  // must turn only this assertion red.
  test('red-tell: swapping the added and dropped player in a waiver row swaps only their sides', () => {
    const swapped = activityFromRow({
      ...byType('waiver'),
      player_name: 'Zach Wilson',
      dropped_player_name: 'Breece Hall',
      detail: { playerId: 9, droppedPlayerId: 7, bid: 12 },
    });
    expect(swapped.players).toEqual({
      added: [{ name: 'Zach Wilson', playerId: 9 }],
      dropped: [{ name: 'Breece Hall', playerId: 7 }],
    });
    expect(swapped.players).not.toEqual(activityFromRow(byType('waiver')).players);
  });

  test('trade: received players land on added, sent players land on dropped', () => {
    const model = activityFromRow(byType('trade'));
    expect(model.players).toEqual({
      added: [{ name: 'Player B', playerId: 2 }],
      dropped: [{ name: 'Player A', playerId: 1 }],
    });
  });

  test('a trade row with no rich detail carries no player references', () => {
    const model = activityFromRow({ ...byType('trade'), detail: {} });
    expect(model.players).toEqual({ added: [], dropped: [] });
  });

  test('commissioner: no player named, so both sides are empty', () => {
    expect(activityFromRow(byType('commissioner')).players).toEqual({ added: [], dropped: [] });
  });
});

describe('activitiesFromResponse: the whole feed, limited client-side', () => {
  test('maps every row, newest first (the server order), with each of the five types represented', () => {
    const models = activitiesFromResponse(rows);
    expect(models).toHaveLength(5);
    expect(models.map((m) => m.type)).toEqual(['commissioner', 'trade', 'waiver', 'drop', 'add']);
    expect(models.map((m) => m.at)).toEqual([
      '2026-09-09T16:00:00.000Z',
      '2026-09-09T15:00:00.000Z',
      '2026-09-09T14:00:00.000Z',
      '2026-09-09T13:00:00.000Z',
      '2026-09-09T12:00:00.000Z',
    ]);
  });

  test('limit slices client-side to the newest N rows', () => {
    const models = activitiesFromResponse(rows, { limit: 3 });
    expect(models.map((m) => m.id)).toEqual([5, 4, 3]);
  });

  test('a non-array body is an empty feed', () => {
    expect(activitiesFromResponse(null)).toEqual([]);
    expect(activitiesFromResponse(undefined, { limit: 3 })).toEqual([]);
  });
});

// Partner of `TRANSACTION_TYPES` in `server/services/activity.service.js`
// (#1134). The server and client share no code today (ADR 0008's "Introduce
// a shared constants module" option, rejected for the same reason: separate
// bundles, no build-layout change as a side effect of a bug fix), so this is
// a hard-coded copy, kept in sync by hand. It does NOT itself catch a new
// server-side type - this suite only iterates its own list, so an eighth
// server type with nothing touched here stays green. The tripwire is
// `server/test/activity.service.test.js`'s exact-shape assertion on
// `TRANSACTION_TYPES`, which turns the server suite red first; this list
// (and the rendering cases below) is the required follow-through once that
// happens, proving the new type renders a real sentence rather than shipping
// as a blank row the way `recap` did.
const SERVER_TRANSACTION_TYPES = [
  'add',
  'commissioner',
  'drop',
  'recap',
  'stat_correction',
  'trade',
  'waiver',
];

describe('activityFromRow: every server transaction type renders a real sentence (#1134 contract)', () => {
  test.each(SERVER_TRANSACTION_TYPES)('%s renders a non-empty, non-generic sentence', (type) => {
    const model = activityFromRow({
      type,
      team_name: 'Some Team',
      player_name: 'Some Player',
      dropped_player_name: 'Some Other Player',
      detail: { season: 2026, week: 4, changes: [], items: [] },
    });
    expect(model.sentence).not.toBe('');
    // Discriminate on behavior, not wording: a known type's sentence must
    // differ from what the generic fallback would produce for that same
    // type, not merely avoid a particular suffix (a real sentence that
    // happens to end in "activity" would otherwise fail this with no
    // defect present).
    expect(model.sentence).not.toBe(genericSentenceFor(type));
  });
});
