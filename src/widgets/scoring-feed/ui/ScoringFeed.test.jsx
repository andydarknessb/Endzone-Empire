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
const NOW = new Date(2026, 8, 6, 15, 42);
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
  test('renders the Live pill and the latest play as "Name NFL · play · +pts to Team"', () => {
    render(<ScoringStrip items={FEED} now={NOW} />);
    const strip = screen.getByRole('region', { name: 'Recent league scoring plays' });
    const pill = within(strip).getByTestId('scoring-strip-live');
    // The canvas's `.chip.live` is the danger (red) chip, not the dashboard's
    // accent `live` variant; this is the red-tell for that tone.
    expect(pill).toHaveAttribute('data-variant', 'danger');
    expect(pill).toHaveTextContent('Live');

    const plays = within(strip).getAllByTestId('scoring-strip-play');
    // The visible group carries four plays on desktop (the canvas's count).
    const group = within(strip).getByTestId('scoring-strip-group');
    expect(within(group).getAllByTestId('scoring-strip-play')).toHaveLength(4);
    expect(plays[0]).toHaveTextContent('J. Jefferson');
    expect(plays[0]).toHaveTextContent('MIN');
    expect(plays[0]).toHaveTextContent('receiving TD');
    expect(plays[0]).toHaveTextContent('+10.4');
    expect(plays[0]).toHaveTextContent('to Fargo Frostbite');
    expect(plays[0].textContent.replace(/\s+/g, ' ').trim()).toBe(
      'J. Jefferson MIN · receiving TD · +10.4 to Fargo Frostbite'
    );
  });

  test('red-tell: renders no football emoji, no emoji at all, and no em dash', () => {
    const { container } = render(<ScoringStrip items={FEED} now={NOW} />);
    expect(container.textContent).not.toContain('\u{1F3C8}');
    expect(container.textContent).not.toMatch(EMOJI);
    expect(container.textContent).not.toMatch(EM_DASH);
    expect(container.innerHTML).not.toMatch(EMOJI);
  });

  test('counts the plays of the last rolling hour on desktop, singular when one', () => {
    render(<ScoringStrip items={FEED} now={NOW} />);
    // 15:42 now: every canvas play since 14:42 is in (the oldest is 14:44).
    expect(screen.getByTestId('scoring-strip-count')).toHaveTextContent('6 plays this hour');
  });

  test('a play older than an hour leaves the count', () => {
    const items = [FEED[0], { ...FEED[1], at: at(13, 0) }];
    render(<ScoringStrip items={items} now={NOW} />);
    expect(screen.getByTestId('scoring-strip-count')).toHaveTextContent('1 play this hour');
  });

  test('the count icon is inline SVG marked decorative', () => {
    render(<ScoringStrip items={FEED} now={NOW} />);
    const count = screen.getByTestId('scoring-strip-count');
    const svg = within(count).getByTestId('scoring-strip-count-icon');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    // No raster or emoji stand-in anywhere on the strip.
    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  });

  test('marquees on desktop with motion allowed: a hidden second group tiles the loop', () => {
    render(<ScoringStrip items={FEED} now={NOW} />);
    const track = screen.getByTestId('scoring-strip-track');
    expect(track).toHaveAttribute('data-motion', 'marquee');
    // The animation itself, read from the cascade (jsdom applies emotion's
    // stylesheet), not just the flag beside it.
    expect(window.getComputedStyle(track).getPropertyValue('animation')).toMatch(
      /^animation-\w+ 24s linear infinite$/
    );
    const clone = screen.getByTestId('scoring-strip-clone');
    expect(clone).toHaveAttribute('aria-hidden', 'true');
    // Eight play nodes in the DOM, four of them hidden from assistive tech.
    expect(screen.getAllByTestId('scoring-strip-play')).toHaveLength(8);
    expect(within(clone).getAllByTestId('scoring-strip-play')).toHaveLength(4);
  });

  test('under prefers-reduced-motion: reduce the strip has no animation and no clone', () => {
    reducedMotion = true;
    render(<ScoringStrip items={FEED} now={NOW} />);
    const track = screen.getByTestId('scoring-strip-track');
    expect(track).toHaveAttribute('data-motion', 'static');
    // Binds the animation, not only the flag: jsdom resolves the cascaded
    // `animation` from emotion's stylesheet and skips `@media` rules that do
    // not name `screen`, so this reads the ternary's own value. Making the
    // animation unconditional turns this red even with the flag intact.
    expect(track).toHaveStyle({ animation: 'none' });
    expect(window.getComputedStyle(track).getPropertyValue('animation')).toBe('none');
    expect(screen.queryByTestId('scoring-strip-clone')).toBeNull();
    expect(screen.getAllByTestId('scoring-strip-play')).toHaveLength(4);
    // The Live pill and the latest play still render; only the motion is gone.
    expect(screen.getByTestId('scoring-strip-live')).toHaveTextContent('Live');
    expect(screen.getAllByTestId('scoring-strip-play')[0]).toHaveTextContent('J. Jefferson');
  });

  test('a single play never marquees (nothing to cycle)', () => {
    render(<ScoringStrip items={[FEED[0]]} now={NOW} />);
    expect(screen.getByTestId('scoring-strip-track')).toHaveAttribute('data-motion', 'static');
    expect(screen.queryByTestId('scoring-strip-clone')).toBeNull();
  });

  test('on mobile it shows one play, no count, and no marquee', () => {
    mobile = true;
    render(<ScoringStrip items={FEED} now={NOW} />);
    expect(screen.getAllByTestId('scoring-strip-play')).toHaveLength(1);
    expect(screen.getByTestId('scoring-strip-play')).toHaveTextContent('J. Jefferson');
    expect(screen.queryByTestId('scoring-strip-count')).toBeNull();
    expect(screen.getByTestId('scoring-strip-track')).toHaveAttribute('data-motion', 'static');
    expect(screen.getByTestId('scoring-strip-live')).toHaveTextContent('Live');
  });

  test('with no items it renders the idle line and no Live pill', () => {
    render(<ScoringStrip items={[]} now={NOW} />);
    expect(
      screen.getByText('Live scoring plays will appear here once games kick off.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('scoring-strip-live')).toBeNull();
    expect(screen.queryByTestId('scoring-strip-play')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });

  test('a non-touchdown play reads its own label through playLabel', () => {
    const items = [{ ...FEED[0], type: 'fieldGoal', isTouchdown: false, pointsDelta: 3 }];
    render(<ScoringStrip items={items} now={NOW} />);
    expect(screen.getByTestId('scoring-strip-play')).toHaveTextContent('FIELD GOAL');
    expect(screen.getByTestId('scoring-strip-play')).toHaveTextContent('+3.0');
  });
});

describe('ScoringFeedList', () => {
  test('is a Card titled "Scoring feed" with one row per item: time, player, play and team', () => {
    render(<ScoringFeedList items={FEED.slice(0, 3)} week={3} tail="TDs only" />);
    const card = screen.getByRole('region', { name: 'Scoring feed' });
    expect(within(card).getByRole('heading', { level: 2, name: 'Scoring feed' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Week 3');
    expect(card).toHaveTextContent('TDs only');

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

  test('colors the side dot by item.side: home, away, or neutral for null', () => {
    render(<ScoringFeedList items={[FEED[1], FEED[0], FEED[3]]} />);
    const dots = screen.getAllByTestId('scoring-feed-side');
    expect(dots.map((d) => d.getAttribute('data-side'))).toEqual(['home', 'away', 'neutral']);
    // The dot is decorative; the side is also said in text for a screen reader,
    // and a play in another matchup says nothing.
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Home side');
    expect(rows[1]).toHaveTextContent('Away side');
    expect(rows[2]).not.toHaveTextContent(/side/);
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
