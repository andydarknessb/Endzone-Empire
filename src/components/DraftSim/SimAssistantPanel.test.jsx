import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import SimAssistantPanel from './SimAssistantPanel';
import { DRAFT_ASSISTANT_KEY } from '../../lib/draftAssistantPreference';
import { fillTemplate, TRIGGERS, POLK_HIGH_LEGEND_LINES } from '../../lib/draftAssistant';

const TEAMS = [
  { id: 1, slot: 1, name: 'You', isUser: true },
  { id: 2, slot: 2, name: 'Team 2', isUser: false },
  { id: 3, slot: 3, name: 'Team 3', isUser: false },
];

// ADP 20 taken at pick 1 (round 1 threshold 7.5): draftValueScore 19 clears
// the reach cutoff.
const REACH_PLAYER = {
  playerId: 100, name: 'Reach Guy', position: 'WR', nflTeam: 'KC', adp: 20, injuryStatus: null,
};
const PLAYER_A = {
  playerId: 101, name: 'Player Alpha', position: 'WR', nflTeam: 'BUF', adp: 15, injuryStatus: null,
};
const PLAYER_B = {
  playerId: 102, name: 'Player Bravo', position: 'RB', nflTeam: 'SF', adp: 16, injuryStatus: null,
};
const PLAYER_C = {
  playerId: 103, name: 'Player Charlie', position: 'WR', nflTeam: 'DAL', adp: 17, injuryStatus: null,
};

const PLAYERS = [REACH_PLAYER, PLAYER_A, PLAYER_B, PLAYER_C];

function makeSim(picks) {
  return {
    config: { leagueType: 'standard' },
    teams: TEAMS,
    players: PLAYERS,
    picks,
    rounds: 15,
    currentPick: picks.length + 1,
  };
}

// rng() => 0 always draws the FIRST remaining index of a trigger's pool
// (lineFor.js's drawIndex), so successive draws for one trigger are
// deterministic: pool[0], then pool[1], and so on.
const firstDraw = () => 0;

const commentaryList = () => screen.getByRole('list', { name: 'Draft assistant commentary' });

beforeEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

describe('SimAssistantPanel (#786)', () => {
  it('renders no assistant panel content while the toggle is off', () => {
    render(<SimAssistantPanel sim={makeSim([])} myTurn={false} secondsLeft={null} />);
    expect(screen.getByText('Draft assistant')).toBeInTheDocument(); // the heading
    expect(screen.getByRole('checkbox', { name: 'Draft assistant commentary' })).toBeInTheDocument(); // the toggle control itself
    expect(screen.queryByText('Misery Meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Draft assistant commentary' })).not.toBeInTheDocument();
    // The polite region is permanently mounted (accessibility review, #786) so
    // assistive tech has already discovered it before there is ever anything
    // to announce - present, but silent, while the toggle is off.
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('with the toggle on, a user reach pick renders a line from the reach pool and the live region announces it once', () => {
    window.localStorage.setItem(DRAFT_ASSISTANT_KEY, '1');
    const { rerender } = render(
      <SimAssistantPanel sim={makeSim([])} myTurn={false} secondsLeft={null} rng={firstDraw} />
    );
    expect(screen.getByText('Misery Meter')).toBeInTheDocument();

    const reachPick = { pickNumber: 1, teamId: 1, playerId: REACH_PLAYER.playerId, auto: false };
    rerender(
      <SimAssistantPanel sim={makeSim([reachPick])} myTurn={false} secondsLeft={null} rng={firstDraw} />
    );

    const expectedLine = fillTemplate(POLK_HIGH_LEGEND_LINES[TRIGGERS.PICK_REACH][0], {
      player: { name: REACH_PLAYER.name },
      pickNumber: 1,
    });

    expect(within(commentaryList()).getByText(expectedLine)).toBeInTheDocument();

    const region = screen.getByRole('status');
    // Contains it exactly once: PoliteRegion renders `text` as its only
    // child, so an exact match (not merely a substring match) is the
    // assertion that proves it is not duplicated or trailing a repeat marker.
    expect(region.textContent).toBe(expectedLine);
  });

  it('suppresses a second pool selection inside the cooldown, drives a genuine third one after it, and never speaks any of them', () => {
    window.localStorage.setItem(DRAFT_ASSISTANT_KEY, '1');
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    const { rerender } = render(
      <SimAssistantPanel sim={makeSim([])} myTurn={false} secondsLeft={null} rng={firstDraw} />
    );

    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');

    // First other-team selection: allowed, starts the cooldown. The rendered
    // line is a filled template from the TAKEN (departure) pool, not merely the
    // player's name (#815): rng=firstDraw draws POOL_PLAYER_TAKEN[0].
    const pickA = { pickNumber: 2, teamId: 2, playerId: PLAYER_A.playerId, auto: false };
    rerender(<SimAssistantPanel sim={makeSim([pickA])} myTurn={false} secondsLeft={null} rng={firstDraw} />);
    const takenLineA = fillTemplate(
      POLK_HIGH_LEGEND_LINES[TRIGGERS.POOL_PLAYER_TAKEN][0], { player: { name: PLAYER_A.name } }
    );
    expect(within(commentaryList()).getByText(takenLineA)).toBeInTheDocument();
    expect(within(commentaryList()).getAllByRole('listitem')).toHaveLength(1);
    expect(region.textContent).toBe('');

    // Second other-team selection, 1s later - well inside the 4s cooldown.
    // A DIFFERENT player's name proves this was a genuinely new selection the
    // panel actually saw and chose to suppress, not just a display cap: if it
    // had rendered anything, it would say "Bravo", not repeat "Alpha".
    now += 1000;
    const pickB = { pickNumber: 3, teamId: 3, playerId: PLAYER_B.playerId, auto: false };
    rerender(
      <SimAssistantPanel sim={makeSim([pickA, pickB])} myTurn={false} secondsLeft={null} rng={firstDraw} />
    );
    expect(screen.queryByText(new RegExp(PLAYER_B.name))).not.toBeInTheDocument();
    expect(within(commentaryList()).getAllByRole('listitem')).toHaveLength(1);
    expect(region.textContent).toBe('');

    // Past the cooldown: a third selection is genuinely allowed through,
    // proving the middle one was suppressed by the cooldown mechanism and not
    // by some fixed "only ever one line" cap.
    now += 4000;
    const pickC = { pickNumber: 4, teamId: 2, playerId: PLAYER_C.playerId, auto: false };
    rerender(
      <SimAssistantPanel
        sim={makeSim([pickA, pickB, pickC])}
        myTurn={false}
        secondsLeft={null}
        rng={firstDraw}
      />
    );
    // Second line drawn for this trigger: POOL_PLAYER_TAKEN[1], filled for C.
    const takenLineC = fillTemplate(
      POLK_HIGH_LEGEND_LINES[TRIGGERS.POOL_PLAYER_TAKEN][1], { player: { name: PLAYER_C.name } }
    );
    expect(within(commentaryList()).getByText(takenLineC)).toBeInTheDocument();
    expect(within(commentaryList()).getAllByRole('listitem')).toHaveLength(2);
    // Selection lines never reach the live region, cooldown-suppressed or not.
    expect(region.textContent).toBe('');
  });

  it('toggling the switch on reveals the panel and persists the preference', () => {
    render(<SimAssistantPanel sim={makeSim([])} myTurn={false} secondsLeft={null} />);
    expect(screen.queryByText('Misery Meter')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Draft assistant commentary' }));

    expect(screen.getByText('Misery Meter')).toBeInTheDocument();
    expect(window.localStorage.getItem(DRAFT_ASSISTANT_KEY)).toBe('1');
  });

  it('clears the live region on toggle-off and never re-shows the stale line merely from mounting it again', () => {
    // Accessibility review regression guard (#786): a region that mounts
    // already holding old text is the exact failure ReadinessAnnouncer.jsx's
    // docblock warns about - assistive tech generally does not announce
    // content a live region already holds when first observed, so a stale
    // line surviving a toggle off/on is silently misread as new (or missed).
    window.localStorage.setItem(DRAFT_ASSISTANT_KEY, '1');
    const { rerender } = render(
      <SimAssistantPanel sim={makeSim([])} myTurn={false} secondsLeft={null} rng={firstDraw} />
    );

    // Drive a real turn-start announcement (no pick needed for this trigger).
    rerender(
      <SimAssistantPanel sim={makeSim([])} myTurn secondsLeft={null} rng={firstDraw} />
    );
    const region = screen.getByRole('status');
    expect(region.textContent).not.toBe('');

    // Toggle off: the region stays mounted (still queryable by role) but its
    // text is cleared, not merely hidden.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Draft assistant commentary' }));
    expect(screen.getByRole('status').textContent).toBe('');

    // Toggle back on with nothing new having happened: still silent, not the
    // old turn-start line reappearing just because the panel is visible again.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Draft assistant commentary' }));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('never double-fires CLOCK_URGENT across a toggle off/on within one turn, but re-arms it once the turn actually changes while off', () => {
    // Formal review regression guard (#786): the off-branch's urgentFiredRef
    // reset is guarded on `!myTurn`, not unconditional. An unconditional reset
    // would let toggling off/on inside one still-urgent turn fire the line
    // twice (ruling 10 violation); no reset at all would leave a stale "already
    // fired" flag suppressing the whole of the NEXT turn's urgent line if that
    // turn boundary is crossed while off.
    window.localStorage.setItem(DRAFT_ASSISTANT_KEY, '1');
    const toggle = () => fireEvent.click(screen.getByRole('checkbox', { name: 'Draft assistant commentary' }));
    const urgentLineCount = () => within(commentaryList()).getAllByRole('listitem').length;

    const { rerender } = render(
      <SimAssistantPanel sim={makeSim([])} myTurn secondsLeft={10} rng={firstDraw} />
    );
    expect(urgentLineCount()).toBe(1); // the mount-time urgent line

    // Toggle off, then straight back on: nothing about the turn changed
    // (myTurn stayed true throughout) - must NOT re-fire.
    toggle();
    toggle();
    expect(urgentLineCount()).toBe(1);

    // Toggle off again, and cross a real turn boundary while off: the turn
    // ends, then a new one starts (also already <=10s, for simplicity).
    toggle();
    rerender(<SimAssistantPanel sim={makeSim([])} myTurn={false} secondsLeft={null} rng={firstDraw} />);
    rerender(<SimAssistantPanel sim={makeSim([])} myTurn secondsLeft={10} rng={firstDraw} />);

    // Toggle back on: the NEW turn's urgent line is genuinely allowed through.
    toggle();
    expect(urgentLineCount()).toBe(2);
  });
});
