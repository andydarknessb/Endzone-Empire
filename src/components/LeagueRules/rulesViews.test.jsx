import React from 'react';
import { render, screen, within } from '@testing-library/react';
import ScoringRulesView from './ScoringRulesView';
import RosterRulesView from './RosterRulesView';
import WaiverTradeRulesView from './WaiverTradeRulesView';
import PlayoffRulesView from './PlayoffRulesView';
import PickemRulesView from './PickemRulesView';
import { clearPickemSettingsCache, setPickemSettings } from '../../hooks/usePickemSettings';

// Each view's section titles are the level below "League Rules" (h4, in
// LeagueRules.jsx) since none of these views nest a card or tab heading of
// their own between the page title and the section titles (#703).
const SECTION_HEADING_LEVEL = 5;

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

  it('gives each category title an explicit heading level, one below the page title, and keeps the subtitle1 type scale', () => {
    render(<ScoringRulesView league={{ scoring_preset: 'standard', dp_enabled: true }} defaults={DEFAULTS} />);
    const passingHeading = screen.getByRole('heading', { level: SECTION_HEADING_LEVEL, name: 'Passing' });
    expect(passingHeading).toBeInTheDocument();
    expect(passingHeading).toHaveClass('MuiTypography-subtitle1');
    expect(screen.getByRole('heading', { level: SECTION_HEADING_LEVEL, name: 'Individual Defense (IDP)' })).toBeInTheDocument();
    // No stray level-6 heading is left behind now that these are no longer h6.
    expect(screen.queryAllByRole('heading', { level: 6 })).toHaveLength(0);
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

  it('separates the drafted roster spots from the IR slots', () => {
    render(<RosterRulesView league={league} />);
    expect(screen.getByText('3 starters')).toBeInTheDocument();
    expect(screen.getByText('9 roster spots + up to 2 IR')).toBeInTheDocument();
    expect(screen.queryByText(/total roster spots/)).not.toBeInTheDocument();
    expect(screen.getByText('QB: max 3')).toBeInTheDocument();
  });

  it('a league with no IR slot reads exactly as it did before', () => {
    render(<RosterRulesView league={{ ...league, ir_slots: 0 }} />);
    expect(screen.getByText('9 total roster spots')).toBeInTheDocument();
  });

  it('says so when there are no position limits', () => {
    render(<RosterRulesView league={{ ...league, position_caps: {} }} />);
    expect(screen.getByText(/No position limits/)).toBeInTheDocument();
  });

  it('gives its section title an explicit heading level, one below the page title', () => {
    render(<RosterRulesView league={league} />);
    expect(screen.getByRole('heading', { level: SECTION_HEADING_LEVEL, name: 'Draft position limits' })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 6 })).toHaveLength(0);
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

  it('gives its two section titles an explicit heading level, one below the page title', () => {
    render(<WaiverTradeRulesView league={{ waiver_type: 'priority', waiver_period_hours: 24, trade_review_hours: 24, trade_veto_votes: 0 }} />);
    expect(screen.getByRole('heading', { level: SECTION_HEADING_LEVEL, name: 'Waivers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: SECTION_HEADING_LEVEL, name: 'Trades' })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 6 })).toHaveLength(0);
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

  it('gives its two section titles an explicit heading level, one below the page title', () => {
    render(<PlayoffRulesView league={{
      regular_season_weeks: 13, playoff_teams: 8, playoff_consolation: false,
      keepers_enabled: true, keeper_count: 2,
    }} />);
    expect(screen.getByRole('heading', { level: SECTION_HEADING_LEVEL, name: 'Season shape' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: SECTION_HEADING_LEVEL, name: 'Keepers' })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 6 })).toHaveLength(0);
  });
});

describe('PickemRulesView', () => {
  beforeEach(() => {
    clearPickemSettingsCache();
    // The rules view reads the same cached settings the Pick'em page does, so
    // seeding the cache is enough — no request of its own (see LeagueRules.test.jsx).
    setPickemSettings(1, { enabled: true, mode: 'straight', isCommissioner: false });
  });

  it('gives its three section titles an explicit heading level, one below the page title', () => {
    render(<PickemRulesView league={{ id: 1 }} />);
    expect(screen.getByRole('heading', { level: SECTION_HEADING_LEVEL, name: 'Scoring' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: SECTION_HEADING_LEVEL, name: 'Picks' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: SECTION_HEADING_LEVEL, name: 'Season' })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 6 })).toHaveLength(0);
  });
});
