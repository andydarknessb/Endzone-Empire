import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SimReport from './SimReport';
import { analyzeDraft } from '../../lib/draftSim/analysis';
import { createSimDraft, applyPick, teamOnClock } from '../../lib/draftSim/engine';
import { cpuPick } from '../../lib/draftSim/cpuBrain';
import { mulberry32 } from '../../lib/draftSim/rng';
import { buildPool } from '../../lib/draftSim/simFixtures';

const CONFIG = { totalTeams: 10, userSlot: 3, leagueType: 'standard', clockSeconds: 60 };

/** A real, finished draft so the report renders against real analysis output. */
function finishedReport() {
  let sim = createSimDraft(CONFIG, buildPool(), { now: 1_800_000_000_000, seed: 31337 });
  const rng = mulberry32(8);
  while (sim.status === 'active') {
    const id = cpuPick(sim, teamOnClock(sim).id, rng);
    if (id == null) break;
    sim = applyPick(sim, { playerId: id, now: 1_800_000_000_000 });
  }
  return analyzeDraft(sim);
}

const REPORT = finishedReport();

const HAND_BUILT = {
  grade: 'D',
  rank: 8,
  teamCount: 10,
  teams: [],
  allPicks: [],
  picks: [
    {
      pickNumber: 3, round: 1, teamId: 3, teamName: 'You', isUser: true, auto: false,
      playerId: 1, name: 'Ace Back', position: 'RB', nflTeam: 'KC', byeWeek: 6,
      projectedPoints: 280.4, adp: 24, marketAdp: 24, draftValueScore: 21,
      adpFallback: false, threshold: 7.5, label: 'reach',
    },
    {
      pickNumber: 18, round: 2, teamId: 3, teamName: 'You', isUser: true, auto: true,
      playerId: 2, name: 'Bolt Wide', position: 'WR', nflTeam: 'BUF', byeWeek: 9,
      projectedPoints: 240, adp: 4, marketAdp: 4, draftValueScore: -14,
      adpFallback: false, threshold: 9, label: 'steal',
    },
    {
      pickNumber: 23, round: 3, teamId: 3, teamName: 'You', isUser: true, auto: false,
      playerId: 3, name: 'Star Backer', position: 'LB', nflTeam: 'SF', byeWeek: null,
      projectedPoints: null, adp: null, marketAdp: 23, draftValueScore: 0,
      adpFallback: true, threshold: 10.5, label: 'no-market',
    },
  ],
  positionBalance: [
    { position: 'QB', count: 0, min: 1, max: 2, status: 'critical' },
    { position: 'RB', count: 4, min: 2, max: 6, status: 'ok' },
  ],
  issues: [
    {
      id: 'unfilled-QB', severity: 'critical', title: 'Cannot field a starting QB',
      detail: 'You rostered 0 but the lineup requires 1.', suggestion: 'Add a QB before week 1.',
    },
    {
      id: 'early-kicker', severity: 'warn', title: 'Kicker in round 5',
      detail: 'That is early.', suggestion: 'Wait on kickers.',
    },
  ],
  totals: {
    steals: 1, reaches: 1, noMarket: 1, draftValueScore: 7, starterPoints: 1420.5,
    benchQuality: { benchPoints: 610.2, leagueMean: 700, stddev: 60, z: -1.5, label: 'the thinnest in the league' },
  },
};

describe('SimReport', () => {
  it('renders nothing without a report', () => {
    const { container } = render(<SimReport report={null} config={CONFIG} onRestart={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('leads with the letter grade and the finish against the field', () => {
    render(<SimReport report={HAND_BUILT} config={CONFIG} onRestart={jest.fn()} />);
    expect(screen.getByRole('heading', { name: 'Draft grade D' })).toBeInTheDocument();
    expect(screen.getByText(/8 of 10/)).toBeInTheDocument();
    expect(screen.getByText(/10-team Standard mock/)).toBeInTheDocument();
  });

  it('summarizes steals, reaches, market delta and bench strength', () => {
    render(<SimReport report={HAND_BUILT} config={CONFIG} onRestart={jest.fn()} />);
    expect(screen.getByText('Steals')).toBeInTheDocument();
    expect(screen.getByText('Reaches')).toBeInTheDocument();
    expect(screen.getByText('+7')).toBeInTheDocument();
    expect(screen.getByText('the thinnest in the league')).toBeInTheDocument();
  });

  it('chips a steal green, a reach red, and leaves a market-less pick unlabelled', () => {
    render(<SimReport report={HAND_BUILT} config={CONFIG} onRestart={jest.fn()} />);
    expect(screen.getByText('Steal')).toBeInTheDocument();
    expect(screen.getByText('Reach')).toBeInTheDocument();
    expect(screen.getByText('No market')).toBeInTheDocument();
    // A pick with no market ADP shows a dash rather than a fake 0 delta.
    const row = screen.getByText('Star Backer').closest('tr');
    expect(row.textContent).toContain('—');
  });

  it('flags auto-drafted picks so a timeout is never silent', () => {
    render(<SimReport report={HAND_BUILT} config={CONFIG} onRestart={jest.fn()} />);
    expect(screen.getByText(/auto-drafted/)).toBeInTheDocument();
  });

  it('renders every issue with its suggestion, criticals as errors', () => {
    render(<SimReport report={HAND_BUILT} config={CONFIG} onRestart={jest.fn()} />);
    expect(screen.getByText('Cannot field a starting QB')).toBeInTheDocument();
    expect(screen.getByText('Add a QB before week 1.')).toBeInTheDocument();
    expect(screen.getByText('Kicker in round 5')).toBeInTheDocument();
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2);
  });

  it('explains a capped grade instead of contradicting the criticals below it', () => {
    const capped = { ...HAND_BUILT, grade: 'C', valueGrade: 'A', gradeCapped: true, criticalCount: 2 };
    render(<SimReport report={capped} config={CONFIG} onRestart={jest.fn()} />);
    expect(screen.getByRole('heading', { name: 'Draft grade C' })).toBeInTheDocument();
    expect(screen.getByText(/Graded down from A on market value/)).toBeInTheDocument();
    expect(screen.getByText(/2 critical roster gaps/)).toBeInTheDocument();
  });

  it('shows no cap note when the grade stands on its own', () => {
    render(<SimReport report={HAND_BUILT} config={CONFIG} onRestart={jest.fn()} />);
    expect(screen.queryByText(/Graded down from/)).not.toBeInTheDocument();
  });

  it('celebrates a clean build when there is nothing to flag', () => {
    render(
      <SimReport report={{ ...HAND_BUILT, issues: [] }} config={CONFIG} onRestart={jest.fn()} />
    );
    expect(screen.getByText('Clean build')).toBeInTheDocument();
  });

  it('draws position balance as labelled bars, with no chart library', () => {
    render(<SimReport report={HAND_BUILT} config={CONFIG} onRestart={jest.fn()} />);
    expect(screen.getByLabelText('QB: 0 rostered, 1 required')).toBeInTheDocument();
    expect(screen.getByLabelText('RB: 4 rostered, 2 required')).toBeInTheDocument();
  });

  it('offers another draft', () => {
    const onRestart = jest.fn();
    render(<SimReport report={HAND_BUILT} config={CONFIG} onRestart={onRestart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run another mock draft' }));
    expect(onRestart).toHaveBeenCalled();
  });

  it('shows the conversion banner only on the public tree', () => {
    const { unmount } = render(<SimReport report={HAND_BUILT} config={CONFIG} onRestart={jest.fn()} />);
    expect(screen.queryByRole('link', { name: 'Get started free' })).not.toBeInTheDocument();
    unmount();

    render(<SimReport report={HAND_BUILT} config={CONFIG} onRestart={jest.fn()} showCta />);
    expect(screen.getByRole('link', { name: 'Get started free' })).toHaveAttribute('href', '/#/registration');
  });

  it('renders a real analyzed draft end to end', () => {
    render(<SimReport report={REPORT} config={CONFIG} onRestart={jest.fn()} />);
    expect(screen.getByRole('heading', { name: /^Draft grade [ABCDF]$/ })).toBeInTheDocument();
    // Fifteen rounds of picks in the table.
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(16);
    expect(screen.getByText('Position balance')).toBeInTheDocument();
  });
});
