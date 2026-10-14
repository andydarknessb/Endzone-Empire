import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NextDraftCard, { featuredDraft, nextScheduledDraft } from './NextDraftCard';

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

  test('nextScheduledDraft is unchanged: future pre-draft only', () => {
    const future = league({ id: 1 });
    expect(nextScheduledDraft([league({ id: 2, draft_date: at(-HOUR) }), future], NOW)).toBe(future);
  });
});

describe('NextDraftCard states', () => {
  const renderCard = (l) => render(
    <MemoryRouter><NextDraftCard league={l} /></MemoryRouter>,
  );

  test('scheduled keeps the Next draft heading and a countdown', () => {
    renderCard(league({ id: 7, draft_date: new Date(Date.now() + 6 * 24 * HOUR).toISOString() }));
    expect(screen.getByRole('heading', { level: 2, name: 'Next draft' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Draft Room' })).toHaveAttribute('href', '/league/7/draft');
    expect(screen.getByRole('link', { name: 'Practice in Draft Sim' })).toBeInTheDocument();
  });

  test('live shows Draft live with the draft room as the one action', () => {
    renderCard(league({ id: 8, name: 'Night League', draft_status: 'active', draft_date: at(-HOUR) }));
    const card = screen.getByRole('region', { name: 'Draft live' });
    expect(within(card).getByRole('heading', { level: 2, name: 'Draft live' })).toBeInTheDocument();
    expect(within(card).getByText('Night League')).toBeInTheDocument();
    const link = within(card).getByRole('link', { name: 'Open Draft Room' });
    expect(link).toHaveAttribute('href', '/league/8/draft');
    expect(link).toHaveAttribute('data-variant', 'primary');
    expect(within(card).queryByRole('link', { name: 'Practice in Draft Sim' })).not.toBeInTheDocument();
  });

  test('late shows Draft starting soon, the explanation and a ghost link', () => {
    renderCard(league({ id: 9, name: 'Late League', draft_date: new Date(Date.now() - 2 * HOUR).toISOString() }));
    const card = screen.getByRole('region', { name: 'Draft starting soon' });
    expect(within(card).getByText('Late League')).toBeInTheDocument();
    expect(within(card).getByText('The draft time has passed. It starts when the commissioner begins it.')).toBeInTheDocument();
    const link = within(card).getByRole('link', { name: 'Open Draft Room' });
    expect(link).toHaveAttribute('href', '/league/9/draft');
    expect(link).toHaveAttribute('data-variant', 'ghost');
  });
});
