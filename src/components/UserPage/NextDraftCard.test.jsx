import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NextDraftCard, { featuredDraft } from './NextDraftCard';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-14T12:00:00Z');
const at = (ms) => new Date(NOW + ms).toISOString();

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  draft_status: 'pending',
  draft_date: at(2 * HOUR),
  ...overrides,
});

describe('featuredDraft', () => {
  test('is null when no league has a draft to show', () => {
    expect(featuredDraft([], NOW)).toBeNull();
    expect(featuredDraft(undefined, NOW)).toBeNull();
    expect(featuredDraft([
      league({ id: 1, draft_date: null }),
      league({ id: 2, draft_status: 'complete' }),
      league({ id: 3, pickem_only: true, draft_status: 'pending', draft_date: at(HOUR) }),
    ], NOW)).toBeNull();
  });

  test('a draft in progress beats a late draft, which beats a scheduled one', () => {
    const scheduled = league({ id: 1, draft_date: at(HOUR) });
    const late = league({ id: 2, draft_date: at(-HOUR) });
    const live = league({ id: 3, draft_status: 'active', draft_date: at(-3 * HOUR) });
    expect(featuredDraft([scheduled, late, live], NOW)).toEqual({ league: live, state: 'live' });
    expect(featuredDraft([scheduled, late], NOW)).toEqual({ league: late, state: 'late' });
    expect(featuredDraft([scheduled], NOW)).toEqual({ league: scheduled, state: 'scheduled' });
  });

  test('the earliest draft_date wins within a state', () => {
    const live = (id, ms) => league({ id, draft_status: 'active', draft_date: at(ms) });
    expect(featuredDraft([live(1, -HOUR), live(2, -5 * HOUR), live(3, -2 * HOUR)], NOW).league.id).toBe(2);
    const late = (id, ms) => league({ id, draft_date: at(ms) });
    expect(featuredDraft([late(1, -HOUR), late(2, -4 * HOUR)], NOW).league.id).toBe(2);
    const sched = (id, ms) => league({ id, draft_date: at(ms) });
    expect(featuredDraft([sched(1, 9 * HOUR), sched(2, 3 * HOUR)], NOW).league.id).toBe(2);
  });

  test('a pre-draft league 30 days past its draft date is not featured; the one drafting in 2 hours is', () => {
    const stale = league({ id: 1, draft_date: at(-30 * 24 * HOUR) });
    const upcoming = league({ id: 2, draft_date: at(2 * HOUR) });
    expect(featuredDraft([stale], NOW)).toBeNull();
    expect(featuredDraft([stale, upcoming], NOW)).toEqual({ league: upcoming, state: 'scheduled' });
  });

  test('a past-due draft is late for 24 hours after its draft date, then drops off', () => {
    const edge = league({ id: 1, draft_date: at(-24 * HOUR) });
    expect(featuredDraft([edge], NOW)).toEqual({ league: edge, state: 'late' });
    expect(featuredDraft([league({ id: 2, draft_date: at(-24 * HOUR - 1) })], NOW)).toBeNull();
  });
});

describe('NextDraftCard states', () => {
  const renderCard = (l, props = {}) => render(
    <MemoryRouter><NextDraftCard league={l} now={NOW} {...props} /></MemoryRouter>,
  );

  test('scheduled shows the day, time, seats joined and the way into the draft room', () => {
    renderCard(league({
      id: 7, draft_date: at(6 * 24 * HOUR), team_count: 8, max_teams: 10,
    }));
    const link = screen.getByRole('link', { name: /^Draft scheduled. Open the Sunday Ballers draft room: the draft opens/ });
    expect(link).toHaveAttribute('href', '/league/7/draft');
    expect(within(link).getByText('Draft scheduled')).toBeInTheDocument();
    expect(within(link).getByText('Sunday Ballers · 8 of 10 teams joined')).toBeInTheDocument();
    expect(within(link).getByText('Opens in 6 days.')).toBeInTheDocument();
    expect(within(link).getByText('Open draft room')).toBeInTheDocument();
  });

  // The cursor frame and filled foot are a CSS class and a data attribute with no role.
  /* eslint-disable testing-library/no-node-access, testing-library/no-container */
  test('live reads Live now with the autopick note; the lead carries the filled foot', () => {
    const { container } = renderCard(league({
      id: 8, name: 'Night League', draft_status: 'active', draft_date: at(-HOUR),
    }), { lead: true });
    const link = screen.getByRole('link', { name: /^Next up: Draft room open\./ });
    expect(link).toHaveAttribute('href', '/league/8/draft');
    expect(within(link).getByText('Live now')).toBeInTheDocument();
    expect(within(link).getByText('If your clock runs out, autopick covers your turn.')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-filled="true"]')).toHaveLength(1);
    expect(container.textContent).not.toMatch(/you pick/i);
  });

  test("live names the viewer's slot in the round, or that the clock is theirs", () => {
    const live = (draft) => league({ draft_status: 'active', draft_date: at(-HOUR), status: { phase: 'drafting', draft } });
    const { unmount } = renderCard(live({ round: 1, slot: 7, onTheClock: false }));
    const link = screen.getByRole('link', { name: /^Draft room open./ });
    expect(within(link).getByText('Sunday Ballers · Round 1, you pick 7th')).toBeInTheDocument();
    expect(link).toHaveAccessibleName(/the draft is live. Round 1, you pick 7th$/);
    unmount();
    renderCard(live({ round: 2, slot: 6, onTheClock: true }));
    const clock = screen.getByRole('link', { name: /^Draft room open./ });
    expect(within(clock).getByText("Sunday Ballers · You're on the clock")).toBeInTheDocument();
    expect(clock).toHaveAccessibleName(/You're on the clock$/);
  });

  test('a live draft whose viewer has no picks left (null round and slot) shows no detail', () => {
    renderCard(league({ draft_status: 'active', draft_date: at(-HOUR), status: { phase: 'drafting', draft: { round: null, slot: null, onTheClock: false } } }));
    const link = screen.getByRole('link', { name: /^Draft room open/ });
    expect(within(link).getByText('Sunday Ballers')).toBeInTheDocument();
    expect(link).not.toHaveTextContent(/you pick/i);
  });

  test('a card that is not the lead has an outlined foot', () => {
    const { container } = renderCard(league({ draft_status: 'active', draft_date: at(-HOUR) }));
    expect(container.querySelector('[data-filled]')).toBeNull();
    expect(container.querySelector('.cursor')).toBeNull();
  });

  test('a member waiting on the commissioner keeps the cursor but has no filled foot, even as the lead', () => {
    const { container } = renderCard(league({ id: 9, draft_autostart_failed: true, draft_date: at(-2 * HOUR) }), { lead: true });
    expect(container.querySelectorAll('.cursor')).toHaveLength(1);
    expect(container.querySelectorAll('[data-filled="true"]')).toHaveLength(0);
  });

  /* eslint-enable testing-library/no-node-access, testing-library/no-container */
  test('late reads Not started with the about-to-start note', () => {
    renderCard(league({ id: 9, name: 'Late League', draft_date: at(-2 * HOUR) }));
    const link = screen.getByRole('link', { name: /Late League draft room/ });
    expect(within(link).getByText('Draft starting soon')).toBeInTheDocument();
    expect(within(link).getByText('Not started')).toBeInTheDocument();
    expect(within(link).getByText('Your draft is about to start.')).toBeInTheDocument();
  });

  test('auto-start failed: a member waits, the commissioner is waited on', () => {
    const failed = league({ id: 9, draft_autostart_failed: true, draft_date: at(-2 * HOUR) });
    const { unmount } = renderCard(failed);
    expect(screen.getByText('Draft waiting')).toBeInTheDocument();
    expect(screen.getByText("The draft didn't start on its own. It starts when the commissioner begins it.")).toBeInTheDocument();
    unmount();

    renderCard(failed, { commissioner: true, lead: true });
    expect(screen.getByText('Draft waiting on you')).toBeInTheDocument();
    expect(screen.getByText("Your draft didn't start on its own.")).toBeInTheDocument();
    expect(screen.getByText('Open draft room')).toBeInTheDocument();
  });
});

describe('NextDraftCard expiry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('a scheduled draft calls onExpire once when its time arrives', () => {
    const onExpire = jest.fn();
    const start = Date.now();
    render(
      <MemoryRouter>
        <NextDraftCard league={league({ draft_date: new Date(start + 5000).toISOString() })} onExpire={onExpire} />
      </MemoryRouter>,
    );
    act(() => { jest.advanceTimersByTime(4000); });
    expect(onExpire).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1500); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test('a live draft has nothing to expire', () => {
    const onExpire = jest.fn();
    render(
      <MemoryRouter>
        <NextDraftCard league={league({ draft_status: 'active', draft_date: at(-HOUR) })} onExpire={onExpire} />
      </MemoryRouter>,
    );
    act(() => { jest.advanceTimersByTime(60 * 1000); });
    expect(onExpire).not.toHaveBeenCalled();
  });
});
