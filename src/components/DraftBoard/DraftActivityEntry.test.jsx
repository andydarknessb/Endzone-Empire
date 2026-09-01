import React from 'react';
import { render, screen } from '@testing-library/react';
import DraftActivityEntry from './DraftActivityEntry';

/**
 * The shared Draft-activity renderer (#435, #437, #439, #540). These cover the
 * two #540 renderer criteria:
 *
 *  - a Commissioner correction renders as an explicit administrative act with
 *    the reversed Pick snapshot, WITH and WITHOUT a reason, and never attributes
 *    the act to the reversed Team (AC6, AC2/AC3 client half);
 *  - an unknown or internal kind renders NOTHING - it can never become a
 *    generic "<Team> updated the draft" line (AC6, the durable half).
 */

const correctionEntry = (over = {}) => ({
  type: 'draft_activity',
  kind: 'correction',
  id: 30,
  seq: 18,
  teamId: 11,
  teamName: 'Gridiron Ghosts',
  player: { id: 500, name: 'Wrong Guy', position: 'RB', nflTeam: 'KC' },
  round: 2,
  pickNumber: 13,
  reason: 'entered against the wrong team; correcting before we resume',
  isLegacy: false,
  created_at: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('DraftActivityEntry correction (#540)', () => {
  it('renders a correction as an explicit commissioner act with the reversed Pick snapshot and the reason', () => {
    render(<DraftActivityEntry entry={correctionEntry()} />);

    // Identified as a commissioner correction (AC2), not a Team action.
    expect(screen.getByText(/commissioner correction/i)).toBeInTheDocument();
    // The reversed Team is shown as the OWNER of the reversed pick, not the actor.
    expect(screen.getByText(/gridiron ghosts/i)).toBeInTheDocument();
    // The reversed Pick snapshot: player, position, NFL team, round, Pick number.
    expect(screen.getByText(/wrong guy/i)).toBeInTheDocument();
    expect(screen.getByText(/RB/)).toBeInTheDocument();
    expect(screen.getByText(/KC/)).toBeInTheDocument();
    expect(screen.getByText(/Round 2/)).toBeInTheDocument();
    expect(screen.getByText(/Pick 13/)).toBeInTheDocument();
    // The commissioner's recorded reason is shown to a member (AC1 client half).
    expect(screen.getByText(/entered against the wrong team/i)).toBeInTheDocument();

    // The administrative act is NOT attributed to the reversed Team: this must
    // never read as the generic lifecycle fallthrough "<Team> updated the draft".
    expect(screen.queryByText(/updated the draft/i)).not.toBeInTheDocument();
  });

  it('renders a correction WITHOUT a reason (null reason) - snapshot shown, no Reason line, no crash', () => {
    render(<DraftActivityEntry entry={correctionEntry({ reason: null })} />);
    expect(screen.getByText(/commissioner correction/i)).toBeInTheDocument();
    expect(screen.getByText(/wrong guy/i)).toBeInTheDocument();
    expect(screen.getByText(/Pick 13/)).toBeInTheDocument();
    // No reason recorded: no "Reason:" label at all.
    expect(screen.queryByText(/^Reason:/i)).not.toBeInTheDocument();
  });

  it('renders a PRESENTER-shaped correction (no reason KEY at all) reason-free, same as a member without one', () => {
    // listPresenterDraftActivity strips the reason key entirely; the same
    // component must render the correction with no reason line and no crash.
    const presenterShaped = correctionEntry();
    delete presenterShaped.reason;
    render(<DraftActivityEntry entry={presenterShaped} />);
    expect(screen.getByText(/commissioner correction/i)).toBeInTheDocument();
    expect(screen.getByText(/wrong guy/i)).toBeInTheDocument();
    expect(screen.queryByText(/entered against the wrong team/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Reason:/i)).not.toBeInTheDocument();
  });
});

describe('DraftActivityEntry refuses to guess unknown or internal kinds (#540 AC6)', () => {
  // A kind the renderer does not know how to draw - a kind not yet invented - must
  // render NOTHING, never a generic Team action. This is the durable requirement:
  // the fallthrough that impersonated a Team action is how the correction bug
  // happened, and it recurs the next time a kind is added unless the renderer
  // refuses to guess. Falsifiable: route the unknown kind back through
  // LifecycleActivityLine (the old "<Team> updated the draft" fallthrough) and
  // both assertions below go red.
  it('renders nothing for an unknown kind, and never "<Team> updated the draft"', () => {
    const { container } = render(
      <DraftActivityEntry entry={{ kind: 'a_kind_from_the_future', teamName: 'Gridiron Ghosts', created_at: '2026-09-01T00:00:00.000Z' }} />
    );
    // No container, no line at all.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('draft-activity')).not.toBeInTheDocument();
    // Specifically not the generic Team action, and no Team named as an actor.
    expect(screen.queryByText(/updated the draft/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/gridiron ghosts/i)).not.toBeInTheDocument();
  });

  it('renders nothing for the internal cutover boundary kind', () => {
    // Cutover is excluded from both user feeds upstream; if it ever reached the
    // renderer it must still not draw as an event.
    const { container } = render(
      <DraftActivityEntry entry={{ kind: 'cutover', teamName: null, created_at: '2026-09-01T00:00:00.000Z' }} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('draft-activity')).not.toBeInTheDocument();
  });
});

describe('DraftActivityEntry still renders the known kinds (regression)', () => {
  it('renders a Pick with its snapshot', () => {
    render(
      <DraftActivityEntry entry={{
        type: 'draft_activity', kind: 'pick', teamName: 'Sunday Scaries',
        player: { name: 'Pat Mahomes', position: 'QB', nflTeam: 'KC' },
        round: 1, pickNumber: 1, isAutopick: false, created_at: '2026-09-01T00:00:00.000Z',
      }} />
    );
    expect(screen.getByText(/pat mahomes/i)).toBeInTheDocument();
    expect(screen.getByTestId('draft-activity')).toBeInTheDocument();
  });

  it('renders a lifecycle transition attributed to its acting Team', () => {
    render(
      <DraftActivityEntry entry={{
        type: 'draft_activity', kind: 'pause', teamName: 'Sunday Scaries',
        created_at: '2026-09-01T00:00:00.000Z',
      }} />
    );
    expect(screen.getByText(/paused the draft/i)).toBeInTheDocument();
  });

  it('renders the nothing-draftable stall (#602, #620) as a stuck-state line naming the Team without agency', () => {
    // A STALLED entry did not act - the draft stalled ON the Team because there
    // was no draftable player - so #620 pulled it out of the shared
    // "<Team> <verb> the draft" actor template: that read as blame for a state
    // the Team did not choose. Falsifiable (AC1, demonstrated in the PR body):
    // reverting DraftActivityEntry's routing to how #618 left it - restoring
    // `stalled: 'stalled'` in LIFECYCLE_VERB AND dropping the dedicated
    // `entry.kind === 'stalled'` branch so `stalled` falls through to
    // LIFECYCLE_RENDER_KINDS/LifecycleActivityLine again - turns "is stuck on"
    // and the stalled-the-draft absence both red. Restoring the map entry
    // alone is NOT enough to flip this test: the dedicated branch is checked
    // first and would still win, which is exactly why routing (not just the
    // verb map) had to change.
    render(
      <DraftActivityEntry entry={{
        type: 'draft_activity', kind: 'stalled', teamName: 'MinneApple',
        created_at: '2026-09-01T00:00:00.000Z',
      }} />
    );
    expect(screen.getByText(/the draft is stuck on/i)).toBeInTheDocument();
    expect(screen.getByText('MinneApple')).toBeInTheDocument();
    expect(screen.getByText(/no draftable player/i)).toBeInTheDocument();
    expect(screen.queryByText(/stalled the draft/i)).not.toBeInTheDocument();
    expect(screen.getByText(/a commissioner must resolve and resume/i)).toBeInTheDocument();
    expect(screen.getByTestId('draft-activity')).toBeInTheDocument();
  });

  it('renders the nothing-draftable stall with a null Team as a plain stuck-state line, never "Former manager"', () => {
    // Defensive case (#620): a null-actor stall must read as a plain state
    // transition, matching the existing null-actor stance for other lifecycle
    // kinds, not "Former manager".
    render(
      <DraftActivityEntry entry={{
        type: 'draft_activity', kind: 'stalled', teamName: null,
        created_at: '2026-09-01T00:00:00.000Z',
      }} />
    );
    expect(screen.getByText(/the draft is stuck: no draftable player/i)).toBeInTheDocument();
    expect(screen.queryByText(/former manager/i)).not.toBeInTheDocument();
    expect(screen.getByText(/a commissioner must resolve and resume/i)).toBeInTheDocument();
  });
});
