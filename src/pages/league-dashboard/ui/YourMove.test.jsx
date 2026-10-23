import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import YourMove from './YourMove';

// The cursor, the filled foot and the slot are CSS classes and data attributes with no role.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
const cursors = (container) => container.querySelectorAll('.cursor');
const filled = (container) => container.querySelectorAll('[data-filled="true"]');

// A lock well ahead of now, so nothing here is urgent unless a test says so.
const LOCK = '2099-10-18T18:00:00.000Z';
const SOON = () => new Date(Date.now() + 45 * 60 * 1000).toISOString();

const lineup = (deadlineAt = LOCK) => ({
  id: 'lineup_problem:1',
  type: 'lineup_problem',
  title: 'Set your lineup',
  detail: '1 empty starting slot',
  cta: { label: 'Set lineup', to: '/league/1/lineup' },
  deadlineAt,
});
const picks = (deadlineAt = LOCK) => ({
  id: 'picks_open:1:2026-7',
  type: 'picks_open',
  title: 'Week 7 picks',
  detail: '9 of 14 picks made',
  cta: { label: 'Make picks', to: '/league/1/pickem' },
  deadlineAt,
});
const waivers = {
  id: 'waiver_claims:1',
  type: 'waiver_claims',
  title: 'Waivers',
  detail: 'Claims clear after Week 7. 1 claim pending.',
  cta: { label: 'View claims', to: '/league/1/waivers' },
  deadlineAt: '2099-10-21T07:00:00.000Z',
};

describe('YourMove', () => {
  test('the lead is the one cursor and the one filled foot, whatever else is due', () => {
    const { container } = renderWithProviders(
      <YourMove lead={{ feet: [lineup()] }} rest={[{ feet: [waivers] }]} badge={2} />
    );
    expect(cursors(container)).toHaveLength(1);
    expect(filled(container)).toHaveLength(1);
    expect(screen.getByRole('link', { name: /^Next up: Set your lineup/ })).toHaveAttribute('href', '/league/1/lineup');
    // The non-lead is a plain link, outlined: no cursor frame, no filled foot.
    const other = screen.getByRole('link', { name: /^Waivers/ });
    expect(other.closest('.slot')).not.toHaveClass('cursor');
    expect(other).not.toHaveAttribute('data-filled');
  });

  test('items that share a lock are one card with a foot per action, and only the first foot is filled', () => {
    const { container } = renderWithProviders(
      <YourMove lead={{ feet: [lineup(), picks()] }} rest={[]} badge={1} />
    );
    const group = screen.getByRole('group', { name: 'Lineup and picks' });
    const feet = within(group).getAllByRole('link');
    expect(feet.map((foot) => foot.textContent)).toEqual(['Set lineup', 'Make picks']);
    expect(feet[0]).toHaveAttribute('href', '/league/1/lineup');
    expect(feet[1]).toHaveAttribute('href', '/league/1/pickem');
    expect(cursors(container)).toHaveLength(1);
    expect(filled(container)).toHaveLength(1);
    expect(feet[0]).toHaveAttribute('data-filled', 'true');
    expect(feet[1]).not.toHaveAttribute('data-filled');
    // The card's own heading names it, and the card counts once.
    expect(screen.getByRole('heading', { level: 3, name: 'Lineup and picks' })).toBeInTheDocument();
    expect(screen.getByText('1 thing needs you')).toBeInTheDocument();
  });

  test('the badge counts the cards, and the lead card leads', () => {
    renderWithProviders(
      <YourMove lead={{ feet: [lineup(), picks()] }} rest={[{ feet: [waivers] }]} badge={2} />
    );
    expect(screen.getByText('2 things need you')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Lineup and picks', 'Waivers']);
    expect(screen.getByText('Earliest lock first')).toBeInTheDocument();
  });

  test('a non-lead card is compact: name, lock and foot, with no field band or league line', () => {
    renderWithProviders(
      <YourMove lead={{ feet: [lineup()] }} rest={[{ feet: [waivers] }]} badge={2} />
    );
    const compact = screen.getByRole('link', { name: /^Waivers/ });
    expect(within(compact).getByText('Claims clear after Week 7. 1 claim pending.')).toBeInTheDocument();
    expect(compact.querySelectorAll('svg')).toHaveLength(1); // the foot's arrow only: no pictogram
    const lead = screen.getByRole('link', { name: /^Next up: Set your lineup/ });
    expect(lead.querySelectorAll('svg').length).toBeGreaterThan(1); // the pictogram band and the arrow
  });

  test('the lead note carries the swap the page names, once', () => {
    renderWithProviders(
      <YourMove
        lead={{ feet: [lineup()], note: 'Start Jordan Addison for Puka Nacua · +23.0 pts' }}
        rest={[]}
        badge={1}
      />
    );
    expect(screen.getAllByText('Start Jordan Addison for Puka Nacua · +23.0 pts')).toHaveLength(1);
    expect(screen.queryByText('1 empty starting slot')).not.toBeInTheDocument();
  });

  test('a lock inside the hour turns the lead urgent: a red strip and the red cursor, still one of each', () => {
    const { container } = renderWithProviders(
      <YourMove lead={{ feet: [lineup(SOON()), picks(SOON())] }} rest={[]} badge={1} urgent />
    );
    expect(screen.getByText(/^\d+ min left$/)).toBeInTheDocument();
    expect(cursors(container)).toHaveLength(1);
    expect(container.querySelector('.cursor').getAttribute('class')).toMatch(/slot/);
    expect(filled(container)).toHaveLength(1);
    // The group is named by its heading and the strip: "Lineup and picks 44 min left".
    expect(screen.getByRole('group', { name: /^Lineup and picks \d+ min left$/ })).toBeInTheDocument();
  });

  test('with nothing due it is a calm "You\'re set" card: no cursor, no filled action, no badge', () => {
    const { container } = renderWithProviders(<YourMove empty />);
    expect(screen.getByRole('heading', { level: 3, name: "You're set" })).toBeInTheDocument();
    expect(screen.getByText('Nothing is due')).toBeInTheDocument();
    expect(cursors(container)).toHaveLength(0);
    expect(filled(container)).toHaveLength(0);
    expect(screen.queryByText(/^\d+ things? needs? you$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('an empty card takes the page\'s own note', () => {
    renderWithProviders(<YourMove empty={{ note: 'Lineup set · picks in · next lock Mon 7:15 PM' }} />);
    expect(screen.getByText('Lineup set · picks in · next lock Mon 7:15 PM')).toBeInTheDocument();
  });

  test('no lead is the same calm card', () => {
    const { container } = renderWithProviders(<YourMove rest={[]} />);
    expect(screen.getByRole('heading', { level: 3, name: "You're set" })).toBeInTheDocument();
    expect(cursors(container)).toHaveLength(0);
  });
});
