import React from 'react';
import { render, screen, within } from '@testing-library/react';
import RosterNeedsStrip from './RosterNeedsStrip';

/**
 * Issue #124 acceptance criterion 5: Starting needs come from the league's
 * CONFIGURED starting slots, bench is summarised separately, and IR is
 * excluded from starting needs altogether.
 *
 * Sits beside RosterNeedsStrip.test.jsx, which covers the strip's behaviour at
 * one shape (counts, chip collapsing, the short-on-starters warning). What is
 * asked here is the other axis: does the SAME strip say the right thing for
 * every shape a commissioner can configure. `roster_slots` is free-text jsonb
 * validated for shape and not for names, counts or order (see
 * server/routes/league.router.js and src/lib/rosterAssignment.js), so "every
 * shape" really does include IDP keys, superflex, a bench of zero and slots a
 * commissioner set to a count of none.
 *
 * The failure mode this guards is quiet. A starting need derived from a fixed
 * template, or one that counted the IR spot, does not throw and does not look
 * broken; it tells a manager in a superflex league to draft a kicker they have
 * no slot for, and it reads exactly like a correct requirement.
 */

const slot = (key, count, eligiblePositions) => ({
  key, label: key, count, eligiblePositions,
});

const pick = (pickNumber, position) => ({
  pickNumber, playerId: pickNumber, name: `Player ${pickNumber}`, position, nflTeam: 'HOU',
});

/**
 * The Need chips, in the order the strip renders them. A non-clickable MUI
 * Chip carries no role, so the strip gives each one a stable test id.
 */
const needLabels = () => within(screen.getByLabelText('Roster needs'))
  .getAllByTestId('roster-need-chip')
  .map((chip) => chip.textContent);

const renderShape = (props) => render(
  <RosterNeedsStrip picks={[]} benchCount={0} irCount={0} irDraftable={false} maxChips={99} {...props} />
);

describe('the starting slots are the league\'s own', () => {
  test('a superflex league needs a superflex, and never the DEF it has no slot for', () => {
    renderShape({
      rosterSlots: [
        slot('QB', 1, ['QB']),
        slot('RB', 2, ['RB']),
        slot('WR', 3, ['WR']),
        slot('SFLX', 1, ['QB', 'RB', 'WR', 'TE']),
      ],
      benchCount: 5,
    });

    expect(screen.getByText('0 of 7 starters filled')).toBeInTheDocument();
    // The exact set, in configured order. "there is no DEF chip" would hold
    // for a strip that rendered no chips at all.
    expect(needLabels()).toEqual(['QB', 'RB ×2', 'WR ×3', 'SFLX']);
  });

  test('an IDP league needs its defensive slots by the keys the commissioner chose', () => {
    renderShape({
      rosterSlots: [
        slot('QB', 1, ['QB']),
        slot('RB', 2, ['RB']),
        slot('WR', 2, ['WR']),
        slot('IDP FLEX', 2, ['DL', 'LB', 'DB']),
        slot('LB', 1, ['LB']),
      ],
      benchCount: 4,
    });

    expect(screen.getByText('0 of 8 starters filled')).toBeInTheDocument();
    expect(needLabels()).toEqual(['QB', 'RB ×2', 'WR ×2', 'IDP FLEX ×2', 'LB']);
  });

  test('a two-slot league is two starters, not a template\'s worth', () => {
    // The smallest configurable shape. A fixed nine-slot template would read
    // "0 of 9" here and look entirely plausible.
    renderShape({ rosterSlots: [slot('QB', 1, ['QB']), slot('FLEX', 1, ['RB', 'WR', 'TE'])] });

    expect(screen.getByText('0 of 2 starters filled')).toBeInTheDocument();
    expect(needLabels()).toEqual(['QB', 'FLEX']);
  });

  test('a slot configured to a count of none is no starting need', () => {
    renderShape({
      rosterSlots: [slot('QB', 1, ['QB']), slot('K', 0, ['K']), slot('DEF', 1, ['DEF'])],
    });

    expect(screen.getByText('0 of 2 starters filled')).toBeInTheDocument();
    expect(needLabels()).toEqual(['QB', 'DEF']);
  });
});

describe('bench is summarised separately from starters', () => {
  test.each([0, 1, 6, 13])('a bench of %i is its own line and never a starting need', (benchCount) => {
    renderShape({
      rosterSlots: [slot('QB', 1, ['QB']), slot('RB', 1, ['RB'])],
      benchCount,
    });

    expect(screen.getByText('0 of 2 starters filled')).toBeInTheDocument();
    expect(screen.getByText(`0 of ${benchCount} bench filled`)).toBeInTheDocument();
    expect(needLabels()).toEqual(['QB', 'RB']);
  });

  test('a player with no starting slot to fill lands on the bench, not in the starters count', () => {
    renderShape({
      rosterSlots: [slot('QB', 1, ['QB'])],
      benchCount: 3,
      picks: [pick(1, 'QB'), pick(2, 'QB'), pick(3, 'QB')],
    });

    expect(screen.getByText('1 of 1 starters filled')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 bench filled')).toBeInTheDocument();
  });
});

describe('IR is excluded from Starting needs', () => {
  test.each([0, 1, 3])('an IR of %i changes neither the starters count nor the chips', (irCount) => {
    const rosterSlots = [slot('QB', 1, ['QB']), slot('RB', 2, ['RB']), slot('TE', 1, ['TE'])];
    renderShape({ rosterSlots, benchCount: 5, irCount });

    expect(screen.getByText('0 of 4 starters filled')).toBeInTheDocument();
    expect(screen.getByText('0 of 5 bench filled')).toBeInTheDocument();
    expect(needLabels()).toEqual(['QB', 'RB ×2', 'TE']);
  });

  test('the strip says nothing about IR at all - it is not a spot a draft fills', () => {
    renderShape({
      rosterSlots: [slot('QB', 1, ['QB'])],
      benchCount: 2,
      irCount: 2,
    });

    // The whole readable text of the strip, so this cannot pass by the strip
    // rendering nothing. Verified to fail against a strip that adds an IR line.
    expect(screen.getByLabelText('Roster needs').textContent)
      .toBe('0 of 1 starters filledNeedQB0 of 2 bench filled');
  });

  test('the short-on-starters warning counts open starting spots, not IR spots', () => {
    // Two picks left and two open starting slots is "exactly enough". If the
    // two IR spots were treated as starting needs it would read as a shortfall
    // and tell a manager their lineup cannot be completed when it can.
    renderShape({
      rosterSlots: [slot('QB', 1, ['QB']), slot('RB', 1, ['RB'])],
      benchCount: 0,
      irCount: 2,
      remainingPicks: 2,
    });

    // The warning variant, and only it. A follow-up
    // `expect(queryByText(/Only 2 picks left/)).not.toBeInTheDocument()` was
    // here and has been removed: the two severity strings are mutually
    // exclusive by construction, so once this assertion passes the other one
    // cannot go red for any mutation, which makes it a guarantee of nothing.
    // This line already discriminates - counting the two IR spots as open
    // starting spots gives 2 picks against 4 spots, which renders the error
    // variant instead and fails here.
    expect(screen.getByText('Every remaining pick has to fill a starting spot.')).toBeInTheDocument();
  });
});

describe('needs shrink as the configured slots fill', () => {
  test('a filled slot leaves the set of needs it was in', () => {
    const rosterSlots = [slot('QB', 1, ['QB']), slot('RB', 2, ['RB']), slot('FLEX', 1, ['RB', 'WR', 'TE'])];
    const { rerender } = render(
      <RosterNeedsStrip rosterSlots={rosterSlots} benchCount={2} irCount={1} irDraftable={false} picks={[]} maxChips={99} />
    );
    expect(needLabels()).toEqual(['QB', 'RB ×2', 'FLEX']);

    rerender(
      <RosterNeedsStrip
        rosterSlots={rosterSlots}
        benchCount={2}
        irCount={1}
        irDraftable={false}
        picks={[pick(1, 'RB'), pick(2, 'QB')]}
        maxChips={99}
      />
    );

    expect(needLabels()).toEqual(['RB', 'FLEX']);
    expect(screen.getByText('2 of 4 starters filled')).toBeInTheDocument();
  });
});
