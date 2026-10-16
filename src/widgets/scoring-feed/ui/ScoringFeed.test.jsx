/* eslint-disable testing-library/no-node-access -- these cases read emotion rules, data attributes and the Live chip's dot, which have no role or text */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScoringFeed, ScoringFeedList, ScoringStrip, formatPlayTime } from '../index';

// Both media queries the strip reads go through useMediaQuery, mocked the way
// TeamAvatar.test.jsx and GifMessage.test.jsx mock it (the house precedent),
// but answered PER QUERY: the reduced-motion query reads `reducedMotion`, the
// theme's `sm` breakpoint query (a max-width) reads `mobile`. Default: desktop,
// motion allowed; a test flips either before rendering.
let reducedMotion = false;
let mobile = false;
beforeEach(() => {
  reducedMotion = false;
  mobile = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: /prefers-reduced-motion/.test(query)
      ? reducedMotion
      : /max-width/.test(query)
        ? mobile
        : false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

// The canvas's sample afternoon (build.mjs FEED), as the item shape the page
// hands the widget: newest first, times in local clock time so the formatted
// output is the viewer's own.
const at = (h, m) => new Date(2026, 8, 6, h, m);
const FEED = [
  { playerId: 1, name: 'J. Jefferson', nflTeam: 'MIN', teamName: 'Fargo Frostbite', pointsDelta: 10.4, type: 'receiving', isTouchdown: true, at: at(15, 41), side: 'away' },
  { playerId: 2, name: 'A. Jones', nflTeam: 'GB', teamName: 'Duluth Dockworkers', pointsDelta: 9.3, type: 'rushing', isTouchdown: true, at: at(15, 37), side: 'home' },
  { playerId: 3, name: 'T. Kelce', nflTeam: 'KC', teamName: 'Duluth Dockworkers', pointsDelta: 7.2, type: 'receiving', isTouchdown: true, at: at(15, 29), side: 'home' },
  { playerId: 4, name: 'C. Lamb', nflTeam: 'DAL', teamName: 'Bemidji Blizzard', pointsDelta: 8.1, type: 'receiving', isTouchdown: true, at: at(15, 14), side: null },
  { playerId: 5, name: 'B. Robinson', nflTeam: 'ATL', teamName: 'Mankato Mavericks', pointsDelta: 6.2, type: 'rushing', isTouchdown: true, at: at(14, 58), side: null },
  { playerId: 6, name: 'J. Allen', nflTeam: 'BUF', teamName: 'Fargo Frostbite', pointsDelta: 6.9, type: 'rushing', isTouchdown: true, at: at(14, 44), side: 'away' },
];

// Every emoji, not only the football: the legacy ticker's football emoji is
// the one the ticket names, and the class is what house style forbids.
const EMOJI = /\p{Extended_Pictographic}/u;
const EM_DASH = new RegExp(String.fromCharCode(0x2014));

describe('ScoringStrip', () => {
  test('is a Board-black region with a quiet "Latest plays" label and the play as "Name NFL · play · +pts to Team"', () => {
    render(<ScoringStrip items={FEED} />);
    const strip = screen.getByRole('region', { name: 'Recent league scoring plays' });
    expect(strip).toHaveTextContent('Latest plays');
    // Live is the h1 row's and the hero's chip: the strip draws none, and no red badge.
    expect(within(strip).queryByText('Live')).toBeNull();
    expect(screen.queryByTestId('scoring-strip-live')).toBeNull();

    const plays = within(strip).getAllByTestId('scoring-strip-play');
    expect(plays[0]).toHaveTextContent('J. Jefferson');
    expect(plays[0].textContent.replace(/\s+/g, ' ').trim()).toBe(
      'J. Jefferson MIN · receiving TD · +10.4 to Fargo Frostbite'
    );
  });

  // AC 6b (spec #2334): six plays render the newest four, statically.
  test('renders the newest four of six plays, statically, with no animation', () => {
    render(<ScoringStrip items={FEED} />);
    const plays = screen.getAllByTestId('scoring-strip-play');
    expect(plays).toHaveLength(4);
    expect(plays.map((el) => el.textContent.split(' ')[1])).toEqual(['Jefferson', 'Jones', 'Kelce', 'Lamb']);
    // No marquee: one group, no hidden clone, no motion flag, and no animation rule on any node.
    expect(screen.queryByTestId('scoring-strip-clone')).toBeNull();
    const strip = screen.getByTestId('scoring-strip');
    [strip, ...strip.querySelectorAll('*')].forEach((el) => {
      expect(window.getComputedStyle(el).getPropertyValue('animation') || 'none').toMatch(/^(none|)$/);
    });
    expect(strip.querySelector('[data-motion]')).toBeNull();
  });

  test('honours desktopLimit and shows the newest play only below sm', () => {
    const { unmount } = render(<ScoringStrip items={FEED} desktopLimit={2} />);
    expect(screen.getAllByTestId('scoring-strip-play')).toHaveLength(2);
    unmount();
    mobile = true;
    render(<ScoringStrip items={FEED} />);
    expect(screen.getAllByTestId('scoring-strip-play')).toHaveLength(1);
    expect(screen.getByTestId('scoring-strip-play')).toHaveTextContent('J. Jefferson');
  });

  test('no football emoji, no emoji at all, and no em dash', () => {
    const { container } = render(<ScoringStrip items={FEED} />);
    expect(container.textContent).not.toContain('\u{1F3C8}');
    expect(container.textContent).not.toMatch(EMOJI);
    expect(container.textContent).not.toMatch(EM_DASH);
    expect(container.innerHTML).not.toMatch(EMOJI);
  });

  test('with no plays it is not drawn (the feed keeps the idle line)', () => {
    const { container } = render(<ScoringStrip items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('a non-touchdown play reads its own label through playLabel', () => {
    const items = [{ ...FEED[0], type: 'fieldGoal', isTouchdown: false, pointsDelta: 3 }];
    render(<ScoringStrip items={items} />);
    expect(screen.getByTestId('scoring-strip-play')).toHaveTextContent('FIELD GOAL');
    expect(screen.getByTestId('scoring-strip-play')).toHaveTextContent('+3.0');
  });
});

describe('ScoringFeedList', () => {
  test('is a frame titled "Scoring feed" with one row per item: time, player, play and team', () => {
    render(<ScoringFeedList items={FEED.slice(0, 3)} week={3} tail="TDs only" />);
    const card = screen.getByRole('region', { name: 'Scoring feed' });
    expect(within(card).getByRole('heading', { level: 2, name: 'Scoring feed' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Week 3');
    expect(card).toHaveTextContent('TDs only');

    const list = within(card).getByRole('list');
    expect(list).toHaveAttribute('role', 'list');
    const rows = within(card).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    const first = rows[0];
    expect(within(first).getByTestId('scoring-feed-time')).toHaveTextContent(formatPlayTime(at(15, 41)));
    expect(within(first).getByTestId('scoring-feed-time').textContent).not.toBe('');
    expect(first).toHaveTextContent('J. Jefferson');
    expect(first).toHaveTextContent('receiving TD');
    expect(first).toHaveTextContent('MIN');
    expect(first).toHaveTextContent('Fargo Frostbite');
    expect(within(first).getByTestId('scoring-feed-points')).toHaveTextContent('+10.4');
    // Line one is "player · play", line two "NFL · fantasy team".
    expect(first.textContent).toMatch(/J\. Jefferson · receiving TD/);
    expect(first.textContent).toMatch(/MIN · Fargo Frostbite/);
  });

  test('says the side in words for a screen reader, and nothing for a play in another matchup', () => {
    render(<ScoringFeedList items={[FEED[1], FEED[0], FEED[3]]} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Home side');
    expect(rows[1]).toHaveTextContent('Away side');
    expect(rows[2]).not.toHaveTextContent(/side/);
    expect(screen.getAllByTestId('scoring-feed-side').map((d) => d.getAttribute('data-side'))).toEqual(['home', 'away']);
  });

  test('a play with no time leaves the time cell blank rather than "Invalid Date"', () => {
    render(<ScoringFeedList items={[{ ...FEED[0], at: undefined }]} />);
    expect(screen.getByTestId('scoring-feed-time').textContent).toBe('');
    expect(screen.getByRole('listitem')).not.toHaveTextContent(/Invalid/);
  });

  test('an empty list renders the idle line and no rows', () => {
    render(<ScoringFeedList items={[]} />);
    expect(
      screen.getByText('Live scoring plays will appear here once games kick off.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.queryByTestId('scoring-feed-show-all')).toBeNull();
  });

  test('shows `limit` rows and a "Show all N plays" footer that expands in place', async () => {
    render(<ScoringFeedList items={FEED} limit={4} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    const footer = screen.getByRole('button', { name: 'Show all 6 plays' });
    await userEvent.click(footer);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer plays' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  test('with onShowAll the footer hands off to the page instead of expanding', async () => {
    const onShowAll = jest.fn();
    render(<ScoringFeedList items={FEED} limit={4} onShowAll={onShowAll} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show all 6 plays' }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Show all 6 plays' })).toBeInTheDocument();
  });

  test('no footer when every play already fits', () => {
    render(<ScoringFeedList items={FEED.slice(0, 3)} limit={6} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByTestId('scoring-feed-show-all')).toBeNull();
  });

  test('the heading level follows headingLevel (ADR 0021)', () => {
    render(<ScoringFeedList items={FEED.slice(0, 1)} headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Scoring feed' })).toBeInTheDocument();
  });

  test('renders no emoji and no em dash anywhere', () => {
    const { container } = render(<ScoringFeedList items={FEED} />);
    expect(container.textContent).not.toMatch(EMOJI);
    expect(container.innerHTML).not.toMatch(EMOJI);
    expect(container.textContent).not.toMatch(EM_DASH);
  });

  test('ScoringFeed is the card under the widget name', () => {
    expect(ScoringFeed).toBe(ScoringFeedList);
  });
});
