import React, { useEffect } from 'react';

// Stand-ins for ActionQueue and LeagueStatusGrid in the page-shell tests: they
// render their props (the pinned interfaces) so UserPage's own wiring is what a
// test sees. The components themselves are tested in their own files. A test
// sets `queueStub.body` to the to-do list body ActionQueue would hand to
// `onLoaded`; the plays it would hand to `onPlaysChange` are `queueStub.plays`
// when a test sets them, else the real buildPlays over that body and the leagues.
export const queueStub = { body: null, plays: undefined };

export function ActionQueueStub({
  onLoaded, onPlaysChange, leagues, refreshKey, onDraftExpire,
}) {
  useEffect(() => {
    onLoaded(queueStub.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!queueStub.body) return;
    const now = Date.now();
    // Required here, not imported: this file is itself required by the ActionQueue mock factory.
    // eslint-disable-next-line global-require
    const { buildPlays } = jest.requireActual('./ActionQueue');
    onPlaysChange(queueStub.plays ?? buildPlays(queueStub.body, leagues, now), now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagues]);
  return (
    <section
      aria-label="Call your plays"
      data-testid="action-queue"
      data-refresh-key={refreshKey}
      data-leagues={leagues.length}
      data-has-expire={typeof onDraftExpire === 'function'}
    />
  );
}

export function LeagueStatusGridStub({
  leagues, loading, error, onRetry, live, updatedAt,
}) {
  if (leagues.length === 0 && !error && !loading) return null;
  return (
    <section aria-label="Leagues" data-testid="league-grid" data-live={String(live)} data-updated={updatedAt ? 'yes' : 'no'}>
      {loading && <span>loading</span>}
      {error && (
        <div role="alert">
          {error}
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      )}
      <ul>{leagues.map((league) => <li key={league.id}>{league.name}</li>)}</ul>
    </section>
  );
}
