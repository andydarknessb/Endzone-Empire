import React from 'react';
import { render, screen, within } from '@testing-library/react';
import ScoringRulesView from './ScoringRulesView';
import RosterRulesView from './RosterRulesView';
import WaiverTradeRulesView from './WaiverTradeRulesView';
import PlayoffRulesView from './PlayoffRulesView';

const DEFAULTS = {
  passing: { yards: 0.04, touchdowns: 4 },
  receiving: { reception: 0 },
  kicking: { fieldGoal: [{ min: 0, max: 39, points: 3 }, { min: 40, max: null, points: 5 }] },
  teamDefense: {
    yardageBonus: [{ min: 0, max: 99, points: 5, pointsPerYardOverMin: 0.1 }],
  },
  idp: { soloTackle: 1 },
};

describe('ScoringRulesView', () => {
  it('hides the IDP category unless defensive players are enabled', () => {
    const { rerender } = render(
      <ScoringRulesView league={{ scoring_preset: 'ppr', dp_enabled: false }} defaults={DEFAULTS} />
    );
    expect(screen.queryByRole('region', { name: 'Individual Defense (IDP)' })).not.toBeInTheDocument();

    rerender(<ScoringRulesView league={{ scoring_preset: 'ppr', dp_enabled: true }} defaults={DEFAULTS} />);
    // Scoped to the section heading — the category also appears as a jump chip.
    expect(screen.getByRole('region', { name: 'Individual Defense (IDP)' })).toBeInTheDocument();
    expect(screen.getByText('Solo Tackle')).toBeInTheDocument();
  });

  it('translates per-yard rates and open-ended tiers', () => {
    render(<ScoringRulesView league={{ scoring_preset: 'standard' }} defaults={DEFAULTS} />);
    expect(screen.getByText('= 1 pt per 25 yds')).toBeInTheDocument();
    expect(screen.getByText('40+')).toBeInTheDocument();
    expect(screen.getByText('0–39')).toBeInTheDocument();
  });

  it('names the format from the reception rate, not the stored preset', () => {
    // A brand new league has no preset at all; the server defaults to half PPR.
    const { rerender } = render(
      <ScoringRulesView league={{}} defaults={{ ...DEFAULTS, receiving: { reception: 0.5 } }} />
    );
    expect(screen.getByText('Half PPR')).toBeInTheDocument();
    expect(screen.queryByText('Custom')).not.toBeInTheDocument();

    rerender(<ScoringRulesView league={{}} defaults={{ ...DEFAULTS, receiving: { reception: 0 } }} />);
    expect(screen.getByText('Standard')).toBeInTheDocument();

    // An override is reported by the rate it produces, plus a Customized flag.
    rerender(
      <ScoringRulesView
        league={{ scoring_preset: 'custom', scoring_rules: { receiving: { reception: 1 } } }}
        defaults={DEFAULTS}
      />
    );
    expect(screen.getByText('Full PPR')).toBeInTheDocument();
    expect(screen.getByText('Customized')).toBeInTheDocument();
  });

  it('spells out an unconventional reception rate', () => {
    render(<ScoringRulesView league={{}} defaults={{ ...DEFAULTS, receiving: { reception: 1.5 } }} />);
    expect(screen.getByText('1.5 pts / reception')).toBeInTheDocument();
  });

  it('offers jump links for each scoring category', () => {
    render(<ScoringRulesView league={{ dp_enabled: true }} defaults={DEFAULTS} />);
    const nav = screen.getByRole('navigation', { name: 'Jump to a scoring category' });
    expect(within(nav).getByRole('button', { name: 'Passing' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Individual Defense (IDP)' })).toBeInTheDocument();
  });

  it('explains why IDP scoring is missing rather than hiding it silently', () => {
    render(<ScoringRulesView league={{ dp_enabled: false }} defaults={DEFAULTS} />);
    expect(screen.getByText(/IDP\) aren't enabled in this league/)).toBeInTheDocument();
  });

  it('shows the per-yard-over-min column only for tiers that use it', () => {
    render(<ScoringRulesView league={{ scoring_preset: 'standard' }} defaults={DEFAULTS} />);
    expect(screen.getByText('Per yard over min')).toBeInTheDocument();
  });

  it('flags a league whose rules were overridden', () => {
    render(
      <ScoringRulesView
        league={{ scoring_preset: 'custom', scoring_rules: { passing: { touchdowns: 6 } } }}
        defaults={DEFAULTS}
      />
    );
    // The reception rate is untouched, so the format name still reads Standard.
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Customized')).toBeInTheDocument();
  });
});

describe('RosterRulesView', () => {
  const league = {
    roster_slots: [
      { key: 'QB', count: 1, eligiblePositions: ['QB'] },
      { key: 'RB', count: 2, eligiblePositions: ['RB'] },
    ],
    bench_slots: 6,
    ir_slots: 2,
    position_caps: { QB: 3 },
  };

  it('totals starters, bench and IR', () => {
    render(<RosterRulesView league={league} />);
    expect(screen.getByText('3 starters')).toBeInTheDocument();
    expect(screen.getByText('11 total roster spots')).toBeInTheDocument();
    expect(screen.getByText('QB: max 3')).toBeInTheDocument();
  });

  it('says so when there are no position limits', () => {
    render(<RosterRulesView league={{ ...league, position_caps: {} }} />);
    expect(screen.getByText(/No position limits/)).toBeInTheDocument();
  });
});

describe('WaiverTradeRulesView', () => {
  it('describes rolling priority with continuous waivers', () => {
    render(<WaiverTradeRulesView league={{ waiver_type: 'priority', waiver_period_hours: 0, trade_review_hours: 0 }} />);
    expect(screen.getByText('Rolling Priority')).toBeInTheDocument();
    expect(screen.getByText('Continuous')).toBeInTheDocument();
    expect(screen.getByText('Instant')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('describes league-vote review and the FAAB budget', () => {
    render(<WaiverTradeRulesView league={{
      waiver_type: 'faab', faab_budget: 200, waiver_period_hours: 24,
      trade_review_hours: 24, trade_veto_votes: 4, transactions_locked: true,
    }} />);
    expect(screen.getByText('$200')).toBeInTheDocument();
    expect(screen.getByText('League vote (4)')).toBeInTheDocument();
    expect(screen.getByText(/Transactions are currently locked/)).toBeInTheDocument();
  });
});

describe('PlayoffRulesView', () => {
  it('reports the playoff start week and keeper count', () => {
    render(<PlayoffRulesView league={{
      regular_season_weeks: 13, playoff_teams: 8, playoff_consolation: false,
      keepers_enabled: true, keeper_count: 2,
    }} />);
    expect(screen.getByText(/Playoffs begin in week 14/)).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('words the Current phase row by League phase, not the raw season status', () => {
    const { rerender } = render(<PlayoffRulesView league={{ draft_status: 'pending', season_status: 'regular' }} />);
    expect(screen.getByText('Current phase')).toBeInTheDocument();
    expect(screen.getByText('Pre-draft')).toBeInTheDocument();
    rerender(<PlayoffRulesView league={{ draft_status: 'complete', season_status: 'playoffs' }} />);
    expect(screen.getByText('Playoffs')).toBeInTheDocument();
    rerender(<PlayoffRulesView league={{ draft_status: 'complete', season_status: 'complete' }} />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });
});
