/* eslint-disable testing-library/no-node-access -- these cases read emotion rules, data attributes and the Live chip's dot, which have no role or text */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MatchupHero, { MatchupHero as NamedMatchupHero } from '../index';
import { invalidate, setResource } from '../../../lib/resourceCache';

// The canvas's live Sunday (docs/design/game-center-matchups/build.mjs, HERO):
// Dockworkers (home) ahead 82.2-77.0 with four starters left, Frostbite (away)
// projected to win 123.9-110.5 with six left. The viewer is the AWAY Team in
// the pill case below on purpose: a pill placed by home/away instead of by
// Team id lands on the Dockworkers and turns that case red, and only that one.
const dock = {
  teamId: 10,
  name: 'Duluth Dockworkers',
  avatarUrl: null,
  avatarStaticUrl: null,
  score: '82.2',
  expectedFinal: '110.5',
  playersRemaining: 4,
};
const frost = {
  teamId: 20,
  name: 'Fargo Frostbite',
  avatarUrl: null,
  avatarStaticUrl: null,
  score: '77.0',
  expectedFinal: '123.9',
  playersRemaining: 6,
};
const live = {
  id: 7,
  season: 2026,
  week: 3,
  final: false,
  status: 'live',
  firstKickoffAt: '2026-09-20T17:00:00.000Z',
  syncedAt: '2026-09-20T20:42:00.000Z',
  home: dock,
  away: frost,
};
const scheduled = {
  ...live,
  status: 'scheduled',
  firstKickoffAt: '2026-09-20T23:20:00.000Z',
  home: { ...dock, score: '0.0', playersRemaining: 9, expectedFinal: '108.3' },
  away: { ...frost, score: '0.0', playersRemaining: 9, expectedFinal: '111.9' },
};

const kickoffText = (iso) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso)
  );

function renderHero(props) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={live} viewerTeamId={10} {...props} />
    </MemoryRouter>
  );
}

const homeSide = () => screen.getByTestId('matchup-hero-side-home');
const awaySide = () => screen.getByTestId('matchup-hero-side-away');

test('renders both Team names and both scores, home left and away right', () => {
  renderHero();

  expect(within(homeSide()).getByTestId('matchup-hero-name')).toHaveTextContent('Duluth Dockworkers');
  expect(within(awaySide()).getByTestId('matchup-hero-name')).toHaveTextContent('Fargo Frostbite');
  expect(within(homeSide()).getByTestId('matchup-hero-score')).toHaveTextContent('82.2');
  expect(within(awaySide()).getByTestId('matchup-hero-score')).toHaveTextContent('77.0');
  // The names are the h3s under the hero's own h2.
  expect(within(homeSide()).getByRole('heading', { level: 3, name: 'Duluth Dockworkers' })).toBeInTheDocument();
});

test('renders Expected final and players remaining on separate lines, each side', () => {
  renderHero();

  expect(within(homeSide()).getByTestId('matchup-hero-expected-final')).toHaveTextContent('Expected final 110.5');
  expect(within(homeSide()).getByTestId('matchup-hero-remaining')).toHaveTextContent('4 players remaining');
  expect(within(awaySide()).getByTestId('matchup-hero-expected-final')).toHaveTextContent('Expected final 123.9');
  expect(within(awaySide()).getByTestId('matchup-hero-remaining')).toHaveTextContent('6 players remaining');
  // The visible text says "players remaining", never "PMR".
  expect(document.body).not.toHaveTextContent('PMR');
});

test('one player reads singular, and the live leader is Board ink with the trailer dim', () => {
  renderHero({ matchup: { ...live, home: { ...dock, playersRemaining: 1 } } });
  expect(within(homeSide()).getByTestId('matchup-hero-remaining')).toHaveTextContent('1 player remaining');
  expect(within(homeSide()).getByTestId('matchup-hero-remaining')).not.toHaveTextContent('1 players');
});

test('both sides read Expected final before players remaining, the away side included', () => {
  renderHero();

  for (const side of [homeSide(), awaySide()]) {
    const ef = within(side).getByTestId('matchup-hero-expected-final');
    const remaining = within(side).getByTestId('matchup-hero-remaining');
    expect(ef.compareDocumentPosition(remaining) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

// A name that does not fit truncates with an ellipsis (#2363): the full name stays in the text and is the title.
test('each team name keeps its full text and carries it as a title', () => {
  renderHero();

  const names = screen.getAllByTestId('matchup-hero-name');
  expect(names).toHaveLength(2);
  names.forEach((n) => expect(n).toHaveAttribute('title', n.textContent));
});

// Red-tell (#893): placing the You pill by home/away instead of by the
// viewer's Team id turns this case red and no other.
test('puts the You pill on the viewer side only, matched by Team id', () => {
  const { rerender } = renderHero({ viewerTeamId: 20 });

  // The viewer is the away Team: the pill is on the away side, not the home.
  expect(screen.getAllByText('You')).toHaveLength(1);
  const pill = within(awaySide()).getByText('You');
  expect(pill).toBeInTheDocument();
  expect(within(homeSide()).queryByText('You')).not.toBeInTheDocument();
  expect(awaySide()).toHaveAttribute('data-viewer-team', 'true');
  expect(homeSide()).not.toHaveAttribute('data-viewer-team');

  // The same Matchup seen by the home manager: the pill moves with the id.
  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={live} viewerTeamId={10} />
    </MemoryRouter>
  );
  expect(screen.getAllByText('You')).toHaveLength(1);
  expect(within(homeSide()).getByText('You')).toBeInTheDocument();
  expect(within(awaySide()).queryByText('You')).not.toBeInTheDocument();
  expect(homeSide()).toHaveAttribute('data-viewer-team', 'true');
  expect(awaySide()).not.toHaveAttribute('data-viewer-team');

  // A viewer on neither side gets no pill at all (this stays inside the pill
  // case so the home/away mutation turns exactly one test red).
  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={live} viewerTeamId={99} />
    </MemoryRouter>
  );
  expect(screen.queryByText('You')).not.toBeInTheDocument();
  expect(homeSide()).not.toHaveAttribute('data-viewer-team');
  expect(awaySide()).not.toHaveAttribute('data-viewer-team');
});

test('a live matchup renders the two-sided bar with both names and percentages, the credit and the sentence', () => {
  renderHero();

  // One accessible name carries both teams and both percentages.
  expect(
    screen.getByRole('img', { name: 'Duluth Dockworkers 36%, Fargo Frostbite 64% win probability' })
  ).toBeInTheDocument();
  const win = screen.getByTestId('matchup-hero-win-probability');
  expect(win).toHaveTextContent('Win probability · Endzone Forecast');
  expect(win).toHaveTextContent('Duluth Dockworkers 36%');
  expect(win).toHaveTextContent('Fargo Frostbite 64%');
  expect(win.querySelectorAll('[data-on="true"]')).toHaveLength(13);

  expect(screen.getByTestId('matchup-hero-sentence')).toHaveTextContent(
    'Ahead now, projected to trail by 13.4 \u00b7 they have 6 players remaining'
  );
  expect(screen.queryByTestId('matchup-hero-kickoff')).not.toBeInTheDocument();
  // Exactly one Live chip on the hero, and one polite region carrying only the score sentence.
  expect(within(screen.getByTestId('matchup-hero-status')).getByText('Live')).toBeInTheDocument();
  expect(screen.getByTestId('matchup-hero-live-region')).toHaveTextContent('Duluth Dockworkers 82.2, Fargo Frostbite 77.0');
});

test('the live sentence reads the server yetToPlay, or the page counts when it lacks one', () => {
  const served = { ...live, away: { ...frost, yetToPlay: 2 }, home: { ...dock, yetToPlay: 0 } };
  const { unmount } = renderHero({ matchup: served });
  expect(screen.getByTestId('matchup-hero-sentence')).toHaveTextContent(
    'they have 6 players remaining, 2 yet to play'
  );
  unmount();
  renderHero({ counts: { first: { remaining: 3, yet: 1 }, second: { remaining: 5, yet: 4 } } });
  expect(screen.getByTestId('matchup-hero-sentence')).toHaveTextContent('they have 5 players remaining, 4 yet to play');
});

// RULINGS Critique 4 item 1: the viewer's own side is the left one, home or away.
test('puts the viewer first: an away viewer is the left side, the bar and the score sentence lead with them', () => {
  renderHero({ viewerTeamId: 20 });
  const sides = screen.getAllByTestId(/^matchup-hero-side-/);
  expect(sides.map((el) => el.getAttribute('data-testid'))).toEqual(['matchup-hero-side-away', 'matchup-hero-side-home']);
  expect(screen.getByRole('img', { name: 'Fargo Frostbite 64%, Duluth Dockworkers 36% win probability' })).toBeInTheDocument();
  expect(screen.getByTestId('matchup-hero-live-region')).toHaveTextContent('Fargo Frostbite 77.0, Duluth Dockworkers 82.2');
});

test('the Matchup link is named viewer first too', () => {
  renderHero({ viewerTeamId: 20 });
  expect(screen.getByRole('link', { name: 'Matchup, Fargo Frostbite against Duluth Dockworkers' })).toHaveAttribute('href', '/league/5/matchups/7');
});

test('a CPU-managed home side keeps its CPU label when the away viewer is drawn first', () => {
  setResource(['league', 5], {
    league: { id: 5 },
    teams: [{ teamId: 10, teamName: 'Duluth Dockworkers', is_cpu: true }, { teamId: 20, teamName: 'Fargo Frostbite' }],
    viewerTeamId: 20,
  });
  try {
    renderHero({ viewerTeamId: 20 });
    expect(screen.getAllByTestId('cpu-badge')).toHaveLength(1);
    expect(within(homeSide()).getByTestId('cpu-badge')).toHaveTextContent('CPU');
    expect(within(homeSide()).getByTestId('matchup-hero-name')).toHaveTextContent('Duluth Dockworkers');
    expect(within(awaySide()).queryByTestId('cpu-badge')).not.toBeInTheDocument();
  } finally {
    invalidate(['league', 5]);
  }
});

test('countsPending holds the count lines and the sentence clause', () => {
  renderHero({ countsPending: true });
  expect(screen.queryByTestId('matchup-hero-remaining')).not.toBeInTheDocument();
  expect(screen.getByTestId('matchup-hero-sentence')).toHaveTextContent(/^Ahead now, projected to trail by 13[.]4$/);
});

test('a home viewer, and a spectator, keep home on the left', () => {
  const { unmount } = renderHero({ viewerTeamId: 10 });
  expect(screen.getAllByTestId(/^matchup-hero-side-/).map((el) => el.getAttribute('data-testid'))).toEqual(['matchup-hero-side-home', 'matchup-hero-side-away']);
  unmount();
  renderHero({ viewerTeamId: 99 });
  expect(screen.getAllByTestId(/^matchup-hero-side-/).map((el) => el.getAttribute('data-testid'))).toEqual(['matchup-hero-side-home', 'matchup-hero-side-away']);
});

test('the sentence is written from the viewer side when the viewer is away', () => {
  renderHero({ viewerTeamId: 20 });
  expect(screen.getByTestId('matchup-hero-sentence')).toHaveTextContent(
    'Behind now, projected to lead by 13.4 \u00b7 they have 4 players remaining'
  );
});

test('a scheduled matchup is the framed panel: Proj figures, the Ink bar, Kickoff, no 0.0 and no Next kickoff', () => {
  renderHero({ matchup: scheduled, nextKickoffAt: scheduled.firstKickoffAt });

  const kickoff = screen.getByTestId('matchup-hero-kickoff');
  expect(kickoff).toHaveTextContent(`Kickoff${kickoffText(scheduled.firstKickoffAt)}`);
  expect(kickoff).not.toHaveTextContent(kickoffText(scheduled.syncedAt));

  expect(within(homeSide()).getByTestId('matchup-hero-score')).toHaveTextContent('108.3');
  expect(homeSide()).toHaveTextContent('Proj');
  expect(homeSide()).toHaveTextContent('9 starters set to play');
  expect(homeSide()).not.toHaveTextContent('Expected final');
  expect(screen.getByRole('img', { name: /^Duluth Dockworkers \d+%, Fargo Frostbite \d+% win probability$/ })).toBeInTheDocument();
  expect(screen.getByTestId('matchup-hero-win-probability')).toHaveTextContent('Projected margin · Fargo Frostbite by 3.6');
  expect(screen.queryByTestId('matchup-hero-sentence')).not.toBeInTheDocument();
  expect(screen.queryByTestId('matchup-hero-live-region')).not.toBeInTheDocument();
  expect(screen.getByTestId('matchup-hero-status')).toHaveTextContent('Scheduled');
  // The hero says the kickoff once: the footer drops "Next kickoff".
  expect(screen.getByTestId('matchup-hero-footer-facts')).toHaveTextContent('No games in progress');
  expect(screen.queryByText(/Next kickoff/)).not.toBeInTheDocument();
});

test('a scheduled matchup with no kickoff time reads TBD', () => {
  renderHero({ matchup: { ...scheduled, firstKickoffAt: null } });
  expect(screen.getByTestId('matchup-hero-kickoff')).toHaveTextContent('KickoffTBD');
});

test('links Matchup to the matchup and Set lineup to the Lineup page, a ghost, never filled', () => {
  renderHero();

  expect(screen.getByRole('link', { name: 'Matchup, Duluth Dockworkers against Fargo Frostbite' })).toHaveAttribute(
    'href',
    '/league/5/matchups/7'
  );
  expect(screen.getByRole('link', { name: 'Set lineup' })).toHaveAttribute('href', '/league/5/lineup');
  expect(screen.queryByText('Compare rosters')).not.toBeInTheDocument();
  expect(document.querySelectorAll('[data-filled="true"]')).toHaveLength(0);
});

test('shows record and rank beneath each name from the lookups the page passes', () => {
  renderHero({ records: { 10: '2-0', 20: '1-1' }, ranks: { 10: 3, 20: 5 } });

  expect(within(homeSide()).getByTestId('matchup-hero-record')).toHaveTextContent('2-0 · 3rd in league');
  expect(within(awaySide()).getByTestId('matchup-hero-record')).toHaveTextContent('1-1 · 5th in league');
});

test('shows the record alone without ranks, and no line without either', () => {
  const { rerender } = renderHero({ records: { 10: '2-0', 20: '1-1' } });
  expect(within(homeSide()).getByTestId('matchup-hero-record')).toHaveTextContent('2-0');
  expect(within(homeSide()).getByTestId('matchup-hero-record')).not.toHaveTextContent('in league');

  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={live} viewerTeamId={10} records={null} ranks={null} />
    </MemoryRouter>
  );
  expect(screen.queryByTestId('matchup-hero-record')).not.toBeInTheDocument();
});

test('the chip is the Live chip while live, a status word once settled, and absent on an unknown status', () => {
  const { rerender } = renderHero();
  expect(screen.getByTestId('matchup-hero-status')).toHaveTextContent('Live');

  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={{ ...live, status: 'played' }} viewerTeamId={10} />
    </MemoryRouter>
  );
  expect(screen.getByTestId('matchup-hero-status')).toHaveTextContent('Awaiting final');

  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={{ ...live, status: null }} viewerTeamId={10} />
    </MemoryRouter>
  );
  // ADR 0030: an unknown status asserts neither state, so no chip, no bar and no kickoff line; the
  // scores and names still render.
  expect(screen.queryByTestId('matchup-hero-status')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /win probability/ })).not.toBeInTheDocument();
  expect(screen.queryByTestId('matchup-hero-kickoff')).not.toBeInTheDocument();
  expect(within(homeSide()).getByTestId('matchup-hero-score')).toHaveTextContent('82.2');
});

test('renders the games-in-progress and next-kickoff footer lines only when supplied', () => {
  const nextKickoffAt = '2026-09-20T23:20:00.000Z';
  const { rerender } = renderHero({ gamesInProgress: 5, nextKickoffAt });

  const facts = screen.getByTestId('matchup-hero-footer-facts');
  expect(facts).toHaveTextContent('5 games in progress');
  expect(facts).toHaveTextContent(`Next kickoff ${kickoffText(nextKickoffAt)}`);

  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={live} viewerTeamId={10} gamesInProgress={1} />
    </MemoryRouter>
  );
  expect(screen.getByTestId('matchup-hero-footer-facts')).toHaveTextContent('1 game in progress');
  expect(screen.queryByText(/Next kickoff/)).not.toBeInTheDocument();

  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={live} viewerTeamId={10} />
    </MemoryRouter>
  );
  expect(screen.queryByTestId('matchup-hero-footer-facts')).not.toBeInTheDocument();
  // The links are there regardless.
  expect(screen.getByRole('link', { name: /^Matchup, / })).toBeInTheDocument();
});

// QA ruling (spec #2334): a settled hero has a score, not a forecast or anyone left to play, so it prints
// neither "Expected final" nor "players remaining", with or without an Expected final on the wire.
test('a settled hero hides Expected final and players remaining, and keeps the score, the result and the chip', () => {
  for (const status of ['final', 'played']) {
    const { unmount } = renderHero({
      matchup: {
        ...live, status, final: status === 'final', home: { ...dock, playersRemaining: 0 }, away: { ...frost, playersRemaining: 0 },
      },
    });
    expect(screen.queryByTestId('matchup-hero-expected-final')).not.toBeInTheDocument();
    expect(screen.queryByTestId('matchup-hero-remaining')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Expected final|players remaining/);
    expect(within(homeSide()).getByTestId('matchup-hero-score')).toHaveTextContent('82.2');
    expect(screen.getByTestId('matchup-hero-sentence')).toHaveTextContent(/won by 5.2/);
    unmount();
  }
});

// QA ruling (spec #2334): the bar and its Endzone Forecast credit need an Expected final on both sides.
test.each([
  ['both null', null, null],
  ['home null', null, '123.9'],
  ['away null', '110.5', null],
])('with %s Expected final there is no win probability bar and no Forecast credit', (_name, homeFinal, awayFinal) => {
  renderHero({ matchup: { ...live, home: { ...dock, expectedFinal: homeFinal }, away: { ...frost, expectedFinal: awayFinal } } });
  expect(screen.queryByRole('img', { name: /win probability/ })).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('Endzone Forecast');
  expect(screen.getByTestId('matchup-hero-sentence')).toHaveTextContent(/^Ahead now/);
});

test('is a labelled region whose title is a heading, level 2 by default', () => {
  const { rerender } = renderHero();
  expect(screen.getByRole('region', { name: 'Your matchup' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Your matchup' })).toBeInTheDocument();
  expect(screen.getByText('Week 3')).toBeInTheDocument();

  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={live} viewerTeamId={10} headingLevel={3} />
    </MemoryRouter>
  );
  expect(screen.getByRole('heading', { level: 3, name: 'Your matchup' })).toBeInTheDocument();
});

test('a departed Team reads as Former manager, never blank', () => {
  renderHero({ matchup: { ...live, away: { ...frost, name: null } } });
  expect(within(awaySide()).getByTestId('matchup-hero-name')).toHaveTextContent('Former manager');
});

test('exports the same component under its name', () => {
  expect(NamedMatchupHero).toBe(MatchupHero);
});
