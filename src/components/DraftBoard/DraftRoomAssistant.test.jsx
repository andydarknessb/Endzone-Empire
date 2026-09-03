import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import {
  DraftRoomAssistantProvider,
  DraftRoomAssistantPanel,
  DraftRoomAssistantBannerLine,
  DraftRoomAssistantRegion,
  DraftRoomAssistantToggle,
  useDraftRoomAssistantControls,
} from './DraftRoomAssistant';
import { DRAFT_ASSISTANT_KEY } from '../../lib/draftAssistantPreference';
import { fillTemplate, TRIGGERS, POLK_HIGH_LEGEND_LINES } from '../../lib/draftAssistant';

// rng() => 0 always draws the FIRST remaining index of a trigger's pool
// (lineFor.js's drawIndex), so a single line is deterministic: pool[0].
const firstDraw = () => 0;

const STEAL_STAR = {
  id: 300, name: 'Steal Star', position: 'RB', nfl_team: 'KC', adp: 1, injury_status: null,
};
const QUEUED_GUY = {
  id: 200, name: 'Queued Guy', position: 'WR', nfl_team: 'BUF', adp: 12, injury_status: null,
};
const BROWSED_GUY = {
  id: 400, name: 'Browsed Guy', position: 'TE', nfl_team: 'SF', adp: 40, injury_status: 'Questionable',
};
const POOL = [STEAL_STAR, QUEUED_GUY, BROWSED_GUY];

const pickPayload = (over) => ({
  pickNumber: 20, teamId: 1, teamName: 'Team A', auto: false,
  player: { id: STEAL_STAR.id, name: STEAL_STAR.name, position: STEAL_STAR.position, nfl_team: STEAL_STAR.nfl_team },
  ...over,
});

// A tiny consumer so a test can fire the clock-urgent edge the way PickClock's
// onUrgent does, without a real countdown.
function UrgentButton() {
  const { notifyClockUrgent } = useDraftRoomAssistantControls();
  return <button type="button" onClick={notifyClockUrgent}>fire urgent</button>;
}

const DEFAULTS = {
  active: true,
  lastPick: null,
  isMyTurn: false,
  poolSelection: null,
  poolRows: POOL,
  queue: [],
  teamCount: 12,
  viewerTeamId: 1,
  myPicks: [],
  rosterSlots: [],
  draftRounds: 12,
  currentPickNumber: 13,
};

const ui = (props = {}) => (
  <DraftRoomAssistantProvider rng={firstDraw} {...DEFAULTS} {...props}>
    <DraftRoomAssistantToggle />
    <DraftRoomAssistantPanel />
    <DraftRoomAssistantBannerLine />
    <DraftRoomAssistantRegion />
    <UrgentButton />
  </DraftRoomAssistantProvider>
);

const commentaryList = () => screen.queryByRole('list', { name: 'Draft assistant commentary' });
const region = () => screen.getByRole('status');
const filled = (trigger, facts) => fillTemplate(POLK_HIGH_LEGEND_LINES[trigger][0], facts);

const on = () => window.localStorage.setItem(DRAFT_ASSISTANT_KEY, '1');

beforeEach(() => {
  window.localStorage.clear();
});

describe('DraftRoomAssistant (#787)', () => {
  it('renders no panel while the toggle is off, but keeps the toggle and the silent region', () => {
    render(ui());
    // The commentary panel declines to render entirely (ruling item 1 / AC5):
    // no heading, no list, no Misery Meter.
    expect(screen.queryByRole('heading', { name: 'Draft assistant' })).not.toBeInTheDocument();
    expect(commentaryList()).not.toBeInTheDocument();
    expect(screen.queryByText('Misery Meter')).not.toBeInTheDocument();
    // The toggle is still reachable, and the one polite region is mounted but
    // empty (a live region must be mounted to be observed).
    expect(screen.getByRole('button', { name: 'Draft assistant commentary' })).toBeInTheDocument();
    expect(region().textContent).toBe('');
  });

  it('turning the toggle on shows the panel and persists the choice per device', () => {
    render(ui());
    fireEvent.click(screen.getByRole('button', { name: 'Draft assistant commentary' }));
    expect(screen.getByRole('heading', { name: 'Draft assistant' })).toBeInTheDocument();
    expect(screen.getByText('Misery Meter')).toBeInTheDocument();
    expect(window.localStorage.getItem(DRAFT_ASSISTANT_KEY)).toBe('1');
  });

  it("announces the viewer's own pick with a line from its trigger's pool", () => {
    on();
    const { rerender } = render(ui());
    rerender(ui({ lastPick: pickPayload() })); // adp 1 at pick 20 -> steal
    const expected = filled(TRIGGERS.PICK_STEAL, { player: { name: 'Steal Star' }, pickNumber: 20 });
    expect(region().textContent).toBe(expected);
    expect(within(commentaryList()).getByText(expected)).toBeInTheDocument();
  });

  it('announces an autopick from the Autopick pool (auto flag wins over any other trigger)', () => {
    on();
    const { rerender } = render(ui());
    rerender(ui({ lastPick: pickPayload({ auto: true }) }));
    const expected = filled(TRIGGERS.PICK_AUTO, {});
    expect(region().textContent).toBe(expected);
  });

  it('speaks a snipe when another team drafts a player on the viewer\'s Queue', () => {
    on();
    const q = [{ id: QUEUED_GUY.id, name: QUEUED_GUY.name, position: 'WR' }];
    const { rerender } = render(ui({ queue: q }));
    rerender(ui({
      queue: q,
      lastPick: pickPayload({ teamId: 2, player: { id: QUEUED_GUY.id, name: QUEUED_GUY.name, position: 'WR', nfl_team: 'BUF' } }),
    }));
    expect(region().textContent).toBe(filled(TRIGGERS.QUEUE_PICKED_BY_OTHER, { player: { name: 'Queued Guy' } }));
  });

  it('says nothing when another team drafts an un-queued player (ruling item 6)', () => {
    on();
    const { rerender } = render(ui());
    rerender(ui({ lastPick: pickPayload({ teamId: 2, player: { id: 999, name: 'Nobody', position: 'WR', nfl_team: 'NYJ' } }) }));
    expect(region().textContent).toBe('');
    expect(commentaryList()).not.toBeInTheDocument();
  });

  it('speaks a turn-start line on the not-my-turn -> my-turn edge', () => {
    on();
    const { rerender } = render(ui({ isMyTurn: false }));
    rerender(ui({ isMyTurn: true }));
    expect(region().textContent).toBe(filled(TRIGGERS.TURN_START, {}));
  });

  it('speaks the clock-urgent line once per turn, and only on the viewer\'s own turn', () => {
    on();
    const { rerender } = render(ui({ isMyTurn: false }));

    // Not my turn: the urgent edge fires nothing.
    fireEvent.click(screen.getByRole('button', { name: 'fire urgent' }));
    expect(region().textContent).toBe('');

    // My turn: it fires once...
    rerender(ui({ isMyTurn: true }));
    // (clear the turn-start line the edge just spoke so we assert on the urgent one)
    const urgent = filled(TRIGGERS.CLOCK_URGENT, {});
    fireEvent.click(screen.getByRole('button', { name: 'fire urgent' }));
    expect(region().textContent).toBe(urgent);
    // ...and not again within the same turn.
    fireEvent.click(screen.getByRole('button', { name: 'fire urgent' }));
    expect(within(commentaryList()).getAllByText(urgent)).toHaveLength(1);
  });

  it('renders a browse line from the browsed pool in the panel but never speaks it, and honours the cooldown', () => {
    on();
    const { rerender } = render(ui());
    rerender(ui({ poolSelection: { id: BROWSED_GUY.id, seq: 1 } }));

    // A filled template from the BROWSED pool, not the departure (TAKEN) pool
    // (#815). Red-tell: pointing this at TRIGGERS.POOL_PLAYER_TAKEN turns it red.
    const expected = filled(TRIGGERS.POOL_PLAYER_BROWSED, { player: { name: 'Browsed Guy' } });
    expect(within(commentaryList()).getByText(expected)).toBeInTheDocument();
    // Never announced (ruling item 4: the region does not speak a browse line).
    expect(region().textContent).toBe('');

    // A second browse within the cooldown adds nothing.
    rerender(ui({ poolSelection: { id: STEAL_STAR.id, seq: 2 } }));
    expect(within(commentaryList()).getAllByRole('listitem')).toHaveLength(1);
  });

  it('fires no assistant line for a quick view opened from the Board or Queue (poolSelection never set)', () => {
    // A Board/Queue quick view goes through the UNWRAPPED handler and never
    // sets the provider's poolSelection nonce, so no browse line is drawn even
    // as picks, turns and clock edges churn around it (#815, ruling item 6).
    on();
    const { rerender } = render(ui());
    // Toggle is on and the draft is live, but poolSelection stays null: the
    // only thing a Board/Queue quick view could have moved is untouched here.
    rerender(ui({ poolSelection: null, isMyTurn: false }));
    expect(commentaryList()).not.toBeInTheDocument();
    expect(region().textContent).toBe('');
  });
});
