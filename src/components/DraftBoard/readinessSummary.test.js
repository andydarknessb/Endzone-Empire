import { readinessSummaryFor, READINESS_LIST } from './readinessSummary';

// Issue #124 acceptance criteria 1-2. The thresholds are the whole point of
// this module, so they are exercised as a boundary sweep rather than at one
// convenient league size: "half" behaves differently for an odd league than an
// even one, and a rule stated as `readyCount > total / 2` is exactly the kind
// that reads correct and is wrong at 3 of 6 or 2 of 5.

const team = (teamId, ready, draftPosition = teamId) => ({
  teamId,
  teamName: `Team ${teamId}`,
  draft_position: draftPosition,
  draft_ready: ready,
});

/** A league of `total` teams with the first `readyCount` of them ready. */
const league = (readyCount, total) => Array.from(
  { length: total },
  (_unused, index) => team(index + 1, index < readyCount)
);

const names = (summary) => summary.listedTeams.map((entry) => entry.teamName);

describe('the count and the bar', () => {
  test('counts ready Teams against the league size', () => {
    const summary = readinessSummaryFor(league(3, 8));

    expect(summary.readyCount).toBe(3);
    expect(summary.total).toBe(8);
    expect(summary.percentReady).toBe(38); // 37.5 rounded
  });

  test('an empty league is 0 of 0 rather than a division by zero', () => {
    const summary = readinessSummaryFor([]);

    expect(summary).toMatchObject({ readyCount: 0, total: 0, percentReady: 0 });
    expect(summary.listKind).toBe(READINESS_LIST.NONE);
  });

  test('only a truthy draft_ready counts, and a missing flag is Not ready', () => {
    const summary = readinessSummaryFor([
      { teamId: 1, teamName: 'A', draft_ready: true },
      { teamId: 2, teamName: 'B', draft_ready: false },
      { teamId: 3, teamName: 'C' },
      { teamId: 4, teamName: 'D', draft_ready: null },
    ]);

    expect(summary.readyCount).toBe(1);
    expect(summary.total).toBe(4);
  });
});

describe('which group is the exception worth naming', () => {
  // CONTEXT.md (Readiness): "once most teams are ready that group, not the
  // ready one, is the exception worth naming". Below the halfway point the
  // ready Teams are the short list; above it the Not ready ones are.

  test.each([
    // readyCount, total, expected list kind
    [1, 8, READINESS_LIST.READY],
    [4, 8, READINESS_LIST.READY], // exactly half is still "at or below half"
    [5, 8, READINESS_LIST.NOT_READY],
    [7, 8, READINESS_LIST.NOT_READY],
    [8, 8, READINESS_LIST.NONE], // full readiness
    // Odd league sizes have no exact half, so the boundary lands between two
    // counts rather than on one.
    [2, 5, READINESS_LIST.READY],
    [3, 5, READINESS_LIST.NOT_READY],
    // The smallest leagues, where off-by-one in the threshold is invisible at
    // larger sizes.
    // Nobody ready is below half, but the ready group it would name is empty,
    // so no list stands - see the dedicated test below.
    [0, 1, READINESS_LIST.NONE],
    [1, 1, READINESS_LIST.NONE],
    [1, 2, READINESS_LIST.READY],
    [2, 2, READINESS_LIST.NONE],
    // A dynamic league size well past the common ten (CONTEXT.md allows up to
    // fourteen) behaves by the same rule, not by a hardcoded midpoint.
    [7, 14, READINESS_LIST.READY],
    [8, 14, READINESS_LIST.NOT_READY],
  ])('%i of %i ready lists the %s group', (readyCount, total, expected) => {
    expect(readinessSummaryFor(league(readyCount, total)).listKind).toBe(expected);
  });

  test('at or below half, the listed Teams are exactly the ready ones', () => {
    // An exact set, not "does not contain a Not ready name": an assertion that
    // some name is absent passes for an implementation that lists nobody.
    const summary = readinessSummaryFor(league(2, 6));

    expect(summary.listKind).toBe(READINESS_LIST.READY);
    expect(names(summary)).toEqual(['Team 1', 'Team 2']);
  });

  test('above half, the listed Teams are exactly the Not ready ones', () => {
    const summary = readinessSummaryFor(league(4, 6));

    expect(summary.listKind).toBe(READINESS_LIST.NOT_READY);
    expect(names(summary)).toEqual(['Team 5', 'Team 6']);
  });

  test('at full readiness there is no list at all', () => {
    const summary = readinessSummaryFor(league(6, 6));

    expect(summary.listKind).toBe(READINESS_LIST.NONE);
    expect(summary.listedTeams).toEqual([]);
    expect(summary.listLabel).toBeNull();
  });

  test('with nobody ready the ready list is empty, so no list is offered', () => {
    // The rule says "at or below half, ready Teams are listed", and zero is
    // below half. A disclosure promising a list and opening on nothing is
    // worse than the count alone, which already says 0 of 6.
    const summary = readinessSummaryFor(league(0, 6));

    expect(summary.listKind).toBe(READINESS_LIST.NONE);
    expect(summary.listedTeams).toEqual([]);
  });
});

describe('the listed Teams', () => {
  test('read in Draft order, not in whatever order the socket sent them', () => {
    // Two of six ready, so the ready group is the listed one. The input is
    // deliberately shuffled: a list built in socket order would still hold the
    // right two Teams and differ only in how it reads down the page.
    const summary = readinessSummaryFor([
      team(9, false, 5),
      team(4, true, 3),
      team(7, false, 2),
      team(2, true, 1),
      team(5, false, 4),
      team(8, false, 6),
    ]);

    expect(summary.listKind).toBe(READINESS_LIST.READY);
    expect(names(summary)).toEqual(['Team 2', 'Team 4']);
  });

  test('the Not ready list reads in Draft order too', () => {
    const summary = readinessSummaryFor([
      team(9, false, 5),
      team(4, true, 3),
      team(7, false, 2),
      team(2, true, 1),
      team(5, true, 4),
      team(8, true, 6),
    ]);

    expect(summary.listKind).toBe(READINESS_LIST.NOT_READY);
    expect(names(summary)).toEqual(['Team 7', 'Team 9']);
  });

  test('a pending lobby with no Draft order yet still lists in a stable order', () => {
    // draft_position is null until a commissioner sets the order, which is the
    // normal state of the lobby this panel lives in. teamsInDraftOrder breaks
    // that tie by Team ID, so the list does not reshuffle between frames.
    const summary = readinessSummaryFor([
      team(9, true, null),
      team(4, false, null),
      team(7, true, null),
      team(2, false, null),
    ]);

    expect(summary.listKind).toBe(READINESS_LIST.READY);
    expect(names(summary)).toEqual(['Team 7', 'Team 9']);
  });

  test('carries each listed Team as its own entry, so a duplicate name is still two Teams', () => {
    // Duplicate Team names remain valid identity (CONTEXT.md: Team). Keying a
    // rendered list on the name would collapse these two into one.
    const summary = readinessSummaryFor([
      { teamId: 1, teamName: 'Ridge Runners', draft_position: 1, draft_ready: true },
      { teamId: 2, teamName: 'Ridge Runners', draft_position: 2, draft_ready: true },
      { teamId: 3, teamName: 'Harbor Hawks', draft_position: 3, draft_ready: false },
      { teamId: 4, teamName: 'Coastal Kings', draft_position: 4, draft_ready: false },
    ]);

    expect(summary.listKind).toBe(READINESS_LIST.READY);
    expect(summary.listedTeams.map((entry) => entry.teamId)).toEqual([1, 2]);
  });
});

describe('the label the list is opened by', () => {
  test('names the ready group and how many are in it', () => {
    expect(readinessSummaryFor(league(2, 6)).listLabel).toBe('Ready managers (2)');
  });

  test('names the Not ready group with the glossary term, never "holdouts"', () => {
    // CONTEXT.md reserves holdout for the Evaluation context; the Readiness
    // entry names this group Not ready.
    expect(readinessSummaryFor(league(4, 6)).listLabel).toBe('Not ready managers (2)');
  });
});
