import { activityFromRow, activitiesFromResponse } from './activityModel';

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

  test('a null row yields an empty-shaped model rather than throwing', () => {
    expect(activityFromRow(null)).toEqual({
      id: null,
      type: null,
      teamName: null,
      avatarUrl: null,
      avatarStaticUrl: null,
      sentence: '',
      at: null,
    });
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
