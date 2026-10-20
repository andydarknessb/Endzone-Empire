import React from 'react';

// Stand-in for LeagueStatusGrid in the page-shell tests: it renders its props (the pinned
// interface) so UserPage's own wiring is what a test sees. The grid is tested in its own file.
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
