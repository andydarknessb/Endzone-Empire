import React from 'react';
import { render, screen, within } from '@testing-library/react';
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
    <MemoryRouter><NextDraftCard league={l} {...props} /></MemoryRouter>,
  );

  test('scheduled keeps the Next draft heading and a countdown', () => {
    renderCard(league({ id: 7, draft_date: new Date(Date.now() + 6 * 24 * HOUR).toISOString() }));
    expect(screen.getByRole('heading', { level: 2, name: 'Next draft' })).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Open Draft Room' });
    expect(open).toHaveAttribute('href', '/league/7/draft');
    expect(open).toHaveClass('MuiButton-contained');
    expect(screen.getByRole('link', { name: 'Practice in Draft Sim' })).toBeInTheDocument();
  });

  test('live shows Draft live with Join draft as the one primary action', () => {
    renderCard(league({ id: 8, name: 'Night League', draft_status: 'active', draft_date: at(-HOUR) }));
    const card = screen.getByRole('region', { name: 'Draft live' });
    expect(within(card).getByRole('heading', { level: 2, name: 'Draft live' })).toBeInTheDocument();
    expect(within(card).getByText('Night League')).toBeInTheDocument();
    const link = within(card).getByRole('link', { name: 'Join draft' });
    expect(link).toHaveAttribute('href', '/league/8/draft');
    expect(link).toHaveClass('MuiButton-contained');
    expect(within(card).queryByRole('link', { name: 'Practice in Draft Sim' })).not.toBeInTheDocument();
  });

  test('late shows Draft starting soon, a ghost link and the plain copy by default', () => {
    renderCard(league({ id: 9, name: 'Late League', draft_date: new Date(Date.now() - 2 * HOUR).toISOString() }));
    const card = screen.getByRole('region', { name: 'Draft starting soon' });
    expect(within(card).getByText('Late League')).toBeInTheDocument();
    expect(within(card).getByText('Your draft is about to start.')).toBeInTheDocument();
    const link = within(card).getByRole('link', { name: 'Open Draft Room' });
    expect(link).toHaveAttribute('href', '/league/9/draft');
    expect(link).toHaveClass('MuiButton-outlined');
  });

  test('late says the draft did not start on its own when auto-start failed', () => {
    renderCard(league({ id: 9, draft_autostart_failed: true, draft_date: new Date(Date.now() - 2 * HOUR).toISOString() }));
    const card = screen.getByRole('region', { name: 'Draft starting soon' });
    expect(within(card).getByText("The draft didn't start on its own. It starts when the commissioner begins it.")).toBeInTheDocument();
    expect(within(card).queryByText('Your draft is about to start.')).not.toBeInTheDocument();
  });
});
