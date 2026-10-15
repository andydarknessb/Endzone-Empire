import React, { useEffect } from 'react';

// Stand-ins for ActionQueue and LeagueStatusGrid in the page-shell tests: they
// render their props (the pinned interfaces) so UserPage's own wiring is what a
// test sees. The components themselves are tested in their own files. A test
// sets `queueStub.body` to the to-do list body ActionQueue would hand to
// `onLoaded`.
export const queueStub = { body: null };

export function ActionQueueStub({
  onLoaded, leagues, refreshKey, onDraftExpire,
}) {
  useEffect(() => {
    onLoaded(queueStub.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
