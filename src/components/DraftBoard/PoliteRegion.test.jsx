import React from 'react';
import { render, screen } from '@testing-library/react';
import PoliteRegion from './PoliteRegion';
import PickAnnouncer from './PickAnnouncer';
import StallAnnouncer from './StallAnnouncer';
import FeedAnnouncer from './FeedAnnouncer';
import ReadinessAnnouncer from './ReadinessAnnouncer';
import DraftChatMembershipAnnouncer from './DraftChatMembershipAnnouncer';

describe('PoliteRegion', () => {
  it('renders one element with role="status" and aria-live="polite" whose text is the text prop', () => {
    render(<PoliteRegion text="Gridiron Giants drafted Justin Jefferson" />);
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute('aria-live', 'polite');
    expect(regions[0]).toHaveTextContent('Gridiron Giants drafted Justin Jefferson');
  });

  it('is visually hidden (MUI visuallyHidden), never a plain visible span', () => {
    // The five prior inline copies were each styled sx={visuallyHidden}; this
    // leaf must reproduce it exactly, or an announcement would render as
    // visible text in the Draft room chrome on every tab.
    render(<PoliteRegion text="The draft is stuck on MinneApple: no draftable player." />);
    expect(screen.getByRole('status')).toHaveStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
      whiteSpace: 'nowrap',
    });
  });

  it('renders empty rather than absent when text is the empty string', () => {
    render(<PoliteRegion text="" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('renders empty when text is omitted', () => {
    render(<PoliteRegion />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('the five Draft-room announcers, mounted together with their minimal props', () => {
  it('each mounted announcer renders exactly one status region', () => {
    // ReadinessAnnouncer only mounts a region for a pending draft where the
    // viewer holds a Team (#164): give it exactly that so all five are present.
    const teams = [{ teamId: 1, teamName: 'A', draft_ready: false }];
    render(
      <>
        <PickAnnouncer pick={null} />
        <StallAnnouncer stall={null} />
        <FeedAnnouncer entries={[]} />
        <ReadinessAnnouncer teams={teams} viewerTeamId={1} draftStatus="pending" />
        <DraftChatMembershipAnnouncer membership="member" />
      </>
    );
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(5);
    regions.forEach((region) => expect(region).toHaveAttribute('aria-live', 'polite'));
  });
});
