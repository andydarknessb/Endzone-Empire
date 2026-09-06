import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MatchupHero, { MatchupHero as NamedMatchupHero } from '../index';

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

  // Each avatar is named for its Team (TeamAvatar itself is aria-hidden).
  expect(within(homeSide()).getByRole('img', { name: 'Duluth Dockworkers' })).toBeInTheDocument();
  expect(within(awaySide()).getByRole('img', { name: 'Fargo Frostbite' })).toBeInTheDocument();
});

test('renders Expected final and PMR as stat tiles on each side', () => {
  renderHero();

  expect(within(homeSide()).getByTestId('matchup-hero-expected-final')).toHaveTextContent('Expected final110.5');
  expect(within(homeSide()).getByTestId('matchup-hero-pmr')).toHaveTextContent(/4$/);
  expect(within(awaySide()).getByTestId('matchup-hero-expected-final')).toHaveTextContent('Expected final123.9');
  expect(within(awaySide()).getByTestId('matchup-hero-pmr')).toHaveTextContent(/6$/);
});

// Red-tell (#897): printing the tile's label as the bare "PMR" string turns
// this case red (no "Players remaining" text anywhere on the hero).
test('the PMR tile reads Players remaining to assistive tech and PMR to the eye', () => {
  renderHero();

  const tile = within(homeSide()).getByTestId('matchup-hero-pmr');
  expect(within(tile).getByText('Players remaining')).toBeInTheDocument();
  expect(within(tile).getByText('PMR')).toHaveAttribute('aria-hidden', 'true');
  // The value follows the expansion, so a screen reader hears "Players remaining 4".
  expect(tile).toHaveTextContent(/Players remaining4$/);
  // Expected final is not abbreviated: one visible label, nothing hidden.
  const ef = within(homeSide()).getByTestId('matchup-hero-expected-final');
  expect(ef).toHaveTextContent('Expected final110.5');
  expect(within(ef).getByText('Expected final')).not.toHaveAttribute('aria-hidden');
});

test('both sides read Expected final before PMR, the away side included', () => {
  renderHero();

  // The canvas's heroSide() mirrors only the avatar row on the away side; the
  // tiles keep the home side's order. Nothing reverses the row in CSS, so the
  // DOM order asserted here is the order the eye and a screen reader get.
  for (const side of [homeSide(), awaySide()]) {
    const ef = within(side).getByTestId('matchup-hero-expected-final');
    const pmr = within(side).getByTestId('matchup-hero-pmr');
    expect(ef.compareDocumentPosition(pmr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
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

test('a live matchup renders the SplitBar with both percentages and the sentence', () => {
  renderHero();

  // The bar is the one accessible name for the split; it carries both names
  // and both percentages.
  expect(
    screen.getByRole('img', { name: 'Win probability: Duluth Dockworkers 36%, Fargo Frostbite 64%' })
  ).toBeInTheDocument();
  expect(screen.getByTestId('split-bar-home').style.width).toBe('36%');
  expect(screen.getByTestId('split-bar-away').style.width).toBe('64%');

  // The per-side percentages beside it agree with the bar.
  expect(screen.getByTestId('matchup-hero-home-pct')).toHaveTextContent('36%');
  expect(screen.getByTestId('matchup-hero-away-pct')).toHaveTextContent('64%');

  // The one plain sentence, from the viewer's (home) side.
  expect(screen.getByTestId('matchup-hero-sentence')).toHaveTextContent(
    'Ahead now, projected to trail by 13.4 with 6 of theirs still to play'
  );
  expect(screen.queryByTestId('matchup-hero-kickoff')).not.toBeInTheDocument();
});

test('the sentence is written from the viewer side when the viewer is away', () => {
  renderHero({ viewerTeamId: 20 });
  expect(screen.getByTestId('matchup-hero-sentence')).toHaveTextContent(
    'Behind now, projected to lead by 13.4 with 4 of theirs still to play'
  );
});

test('a scheduled matchup renders the kickoff line and no bar', () => {
  renderHero({ matchup: scheduled });

  const kickoff = screen.getByTestId('matchup-hero-kickoff');
  expect(kickoff).toHaveTextContent(`Kickoff${kickoffText(scheduled.firstKickoffAt)}`);
  // The line reads firstKickoffAt, not the sync time.
  expect(kickoff).not.toHaveTextContent(kickoffText(scheduled.syncedAt));

  expect(screen.queryByTestId('split-bar')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /^Win probability:/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  expect(screen.queryByTestId('matchup-hero-sentence')).not.toBeInTheDocument();
  expect(screen.getByTestId('matchup-hero-status')).toHaveTextContent('Scheduled');
});

test('a scheduled matchup with no kickoff time reads TBD', () => {
  renderHero({ matchup: { ...scheduled, firstKickoffAt: null } });
  expect(screen.getByTestId('matchup-hero-kickoff')).toHaveTextContent('KickoffTBD');
  expect(screen.queryByTestId('split-bar')).not.toBeInTheDocument();
});

test('links Compare rosters to the matchup and Set lineup to the Lineup page', () => {
  renderHero();

  expect(screen.getByRole('link', { name: 'Compare rosters' })).toHaveAttribute(
    'href',
    '/league/5/matchups/7'
  );
  expect(screen.getByRole('link', { name: 'Set lineup' })).toHaveAttribute('href', '/league/5/lineup');
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

test('the status chip comes from the entity predicate and is absent on an unknown status', () => {
  const { rerender } = renderHero();
  // The artboard's red LIVE: the danger Badge with the dot.
  expect(screen.getByTestId('matchup-hero-status')).toHaveTextContent('LIVE');
  expect(screen.getByTestId('matchup-hero-status')).toHaveAttribute('data-variant', 'danger');

  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={{ ...live, status: 'played' }} viewerTeamId={10} />
    </MemoryRouter>
  );
  expect(screen.getByTestId('matchup-hero-status')).toHaveTextContent('Awaiting final');
  expect(screen.getByTestId('matchup-hero-status')).toHaveAttribute('data-variant', 'warning');

  rerender(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MatchupHero leagueId={5} matchup={{ ...live, status: null }} viewerTeamId={10} />
    </MemoryRouter>
  );
  // ADR 0030: an unknown status asserts neither state, so no chip, no bar and
  // no kickoff line; the scores and names still render.
  expect(screen.queryByTestId('matchup-hero-status')).not.toBeInTheDocument();
  expect(screen.queryByTestId('split-bar')).not.toBeInTheDocument();
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
  // The actions are there regardless.
  expect(screen.getByRole('link', { name: 'Compare rosters' })).toBeInTheDocument();
});

test('a final matchup degrades a missing Expected final to a named placeholder', () => {
  renderHero({
    matchup: {
      ...live,
      status: 'final',
      final: true,
      home: { ...dock, expectedFinal: null, playersRemaining: 0 },
      away: { ...frost, expectedFinal: null, playersRemaining: 0 },
    },
  });

  const tile = within(homeSide()).getByTestId('matchup-hero-expected-final');
  expect(within(tile).getByText('Not available')).toBeInTheDocument();
  expect(within(tile).getByText('-')).toHaveAttribute('aria-hidden', 'true');
  expect(within(homeSide()).getByTestId('matchup-hero-pmr')).toHaveTextContent(/0$/);
  expect(screen.getByTestId('matchup-hero-sentence')).toHaveTextContent('Won by 5.2');
  expect(screen.getByTestId('matchup-hero-status')).toHaveTextContent('Final');
  expect(screen.getByTestId('matchup-hero-status')).toHaveAttribute('data-variant', 'success');
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
