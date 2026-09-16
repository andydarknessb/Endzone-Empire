import { myTeam, freeAgent, waivers, rostered, draft, fromCard } from './decisionContext';

const noop = () => {};

describe('myTeam: the your-team context, managed vs read-only (#1512, ADR 0040)', () => {
  it('managed: true accepts the lineup-management handlers and carries them through', () => {
    const entries = [{ playerId: 1, slot: 'BENCH' }];
    const context = myTeam({
      managed: true,
      onSwap: noop,
      onRequestDrop: noop,
      canDropEntry: noop,
      entries,
      bestBall: true,
      leagueUnsettled: false,
    });
    expect(context).toEqual({
      kind: 'my_team',
      managed: true,
      onSwap: noop,
      onRequestDrop: noop,
      canDropEntry: noop,
      entries,
      bestBall: true,
      leagueUnsettled: false,
    });
  });

  it('managed: false (a read-only own-player open, e.g. PlayerManagement) needs no handlers', () => {
    const context = myTeam({ managed: false });
    expect(context).toEqual({
      kind: 'my_team',
      managed: false,
      onSwap: undefined,
      onRequestDrop: undefined,
      canDropEntry: undefined,
      entries: undefined,
      bestBall: false,
      leagueUnsettled: false,
    });
  });

  it('rejects a missing managed flag', () => {
    expect(() => myTeam({})).toThrow(/managed/);
  });

  it('rejects a non-boolean managed flag', () => {
    expect(() => myTeam({ managed: 'true' })).toThrow(/managed/);
  });

  it('managed: true rejects a missing onSwap', () => {
    expect(() =>
      myTeam({ managed: true, onRequestDrop: noop, canDropEntry: noop, entries: [] })
    ).toThrow(/onSwap/);
  });

  it('managed: true rejects entries that are not an array', () => {
    expect(() =>
      myTeam({ managed: true, onSwap: noop, onRequestDrop: noop, canDropEntry: noop, entries: null })
    ).toThrow(/entries/);
  });
});

describe('freeAgent: the free-agent action-bar context', () => {
  it('accepts an availability object and a roster array', () => {
    const availability = { rosterCount: 1, rosterCapacity: 16 };
    const roster = [];
    expect(freeAgent({ availability, roster })).toEqual({ kind: 'free_agent', availability, roster });
  });

  it('rejects a missing availability', () => {
    expect(() => freeAgent({ roster: [] })).toThrow(/availability/);
  });

  it('rejects a roster that is not an array', () => {
    expect(() => freeAgent({ availability: {}, roster: null })).toThrow(/roster/);
  });
});

describe('waivers: the waivers action-bar context', () => {
  it('accepts an availability object and a roster array', () => {
    const availability = { faabRemaining: 42 };
    const roster = [];
    expect(waivers({ availability, roster })).toEqual({ kind: 'waivers', availability, roster });
  });

  it('rejects a missing availability', () => {
    expect(() => waivers({ roster: [] })).toThrow(/availability/);
  });

  it('rejects a roster that is not an array', () => {
    expect(() => waivers({ availability: {}, roster: undefined })).toThrow(/roster/);
  });
});

describe('rostered: the rostered-by-another-team context', () => {
  it('accepts an availability object carrying the owning team name', () => {
    const availability = { teamName: 'The Waterboys' };
    expect(rostered({ availability })).toEqual({ kind: 'rostered', availability });
  });

  it('rejects a missing availability', () => {
    expect(() => rostered({})).toThrow(/availability/);
  });

  // f1 (formal review): the card treats teamName as optional ("Rostered by"
  // renders only when it is set) and PlayerManagement already opens this
  // context with no teamName - a missing one is an accepted shape.
  it('accepts an availability with no teamName', () => {
    const availability = {};
    expect(rostered({ availability })).toEqual({ kind: 'rostered', availability });
  });

  it('rejects a present, non-string teamName', () => {
    expect(() => rostered({ availability: { teamName: 42 } })).toThrow(/teamName/);
  });
});

describe('draft: the Draft room context (#1313, not an Availability state)', () => {
  it('accepts the room pool-row facts and its queue handler', () => {
    const onQueue = noop;
    const context = draft({ adp: 12.3, queued: true, onQueue });
    expect(context).toEqual({
      kind: 'draft',
      draftedBy: null,
      adp: 12.3,
      canDraft: false,
      draftUnavailableReason: null,
      queued: true,
      onDraft: undefined,
      onQueue,
    });
  });

  it('rejects a missing onQueue', () => {
    expect(() => draft({})).toThrow(/onQueue/);
  });

  it('canDraft: true rejects a missing onDraft', () => {
    expect(() => draft({ canDraft: true, onQueue: noop })).toThrow(/onDraft/);
  });
});

describe('fromCard: defers kind to the /card payload (#1311, ADR 0040 ruling c)', () => {
  it('carries no kind of its own', () => {
    expect(fromCard()).toEqual({ kind: null, fromCard: true });
  });
});
