import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import {
  CountBadge, ErrorPanel, OddsBar, PlayCard, PsButton, pixelSx,
} from './index';

// The cursor frame, filled foot, slot and odds blocks are CSS classes and data attributes with no role.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
const filled = (container) => container.querySelectorAll('[data-filled="true"]');

const card = {
  kind: 'picks',
  name: 'Week 6 picks',
  league: 'Sunday League',
  lockDay: 'Sun',
  lockTime: '1:00 PM',
  lockNote: '5 of 14 picked',
  cta: { label: 'Make picks', to: '/leagues/1/pickem' },
  ariaLabel: 'Sunday League, locks Sunday 1:00 PM',
};

describe('PlayCard', () => {
  test('the lead wears the cursor and carries the one filled foot', () => {
    const { container } = renderWithProviders(<PlayCard {...card} state="next" lead />);
    expect(container.querySelectorAll('.cursor')).toHaveLength(1);
    expect(container.querySelector('.slot')).toHaveClass('cursor');
    expect(filled(container)).toHaveLength(1);
    expect(screen.getByRole('link', { name: /^Next up: Week 6 picks\./ })).toHaveAttribute('href', '/leagues/1/pickem');
  });

  test('a cta with onClick and no link is one button that fires it', async () => {
    const onClick = jest.fn();
    const { container } = renderWithProviders(<PlayCard {...card} cta={{ label: 'Create a league', onClick }} state="next" lead />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(filled(container)).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /^Next up: Week 6 picks./ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('a non-lead has no cursor and no filled foot, and keeps its slot', () => {
    const { container } = renderWithProviders(<PlayCard {...card} state="open" />);
    expect(container.querySelector('.slot')).not.toHaveClass('cursor');
    expect(container.querySelector('.cursor')).toBeNull();
    expect(filled(container)).toHaveLength(0);
    expect(screen.getByRole('link', { name: /^Week 6 picks\./ })).toBeInTheDocument();
  });

  test('a grouped card has one foot per action and only the first is filled when it leads', () => {
    const actions = [
      { label: 'Sunday League', note: '5 of 14', to: '/leagues/1/pickem', ariaLabel: 'Sunday League picks' },
      { label: 'Monday League', note: '0 of 14', to: '/leagues/2/pickem', ariaLabel: 'Monday League picks' },
    ];
    const { container } = renderWithProviders(<PlayCard {...card} cta={undefined} actions={actions} state="next" lead />);
    const group = screen.getByRole('group', { name: /^Next up: Week 6 picks/ });
    expect(within(group).getAllByRole('link')).toHaveLength(2);
    const feet = filled(container);
    expect(feet).toHaveLength(1);
    expect(feet[0]).toHaveAttribute('aria-label', 'Sunday League picks');
    expect(within(group).getByRole('link', { name: 'Monday League picks' })).not.toHaveAttribute('data-filled');
  });

  test('filledFoot false keeps the cursor on the lead but outlines the foot', () => {
    const { container } = renderWithProviders(<PlayCard {...card} state="next" lead filledFoot={false} />);
    expect(container.querySelectorAll('.cursor')).toHaveLength(1);
    expect(filled(container)).toHaveLength(0);
  });

  test('a grouped card that is not the lead has no filled foot', () => {
    const actions = [
      { label: 'A', to: '/a', ariaLabel: 'A picks' },
      { label: 'B', to: '/b', ariaLabel: 'B picks' },
    ];
    const { container } = renderWithProviders(<PlayCard {...card} actions={actions} state="open" />);
    expect(filled(container)).toHaveLength(0);
  });

  test('an urgent card shows "<countdown> left" and its name says so', () => {
    renderWithProviders(<PlayCard {...card} state="urgent" lead countdown="in 38 min" />);
    expect(screen.getAllByText('38 min left')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /38 min left$/ })).toBeInTheDocument();
  });

  test('a non-urgent card shows no strip', () => {
    renderWithProviders(<PlayCard {...card} state="next" lead countdown="in 38 min" />);
    expect(screen.queryByText(/left$/)).toBeNull();
  });

  test('the lead urgent cursor is danger, the plain lead is cursor yellow', () => {
    const { container: urgentFrame, unmount } = renderWithProviders(<PlayCard {...card} state="urgent" lead countdown="in 5 min" />);
    expect(getComputedStyle(urgentFrame.querySelector('.slot')).getPropertyValue('--cur')).toBe('var(--ps-danger)');
    unmount();
    const { container: nextFrame } = renderWithProviders(<PlayCard {...card} state="next" lead />);
    expect(getComputedStyle(nextFrame.querySelector('.slot')).getPropertyValue('--cur')).toBe('var(--ps-cursor)');
  });
});

describe('OddsBar', () => {
  test('renders 20 blocks with one filled per 5 points and a labelled image', () => {
    const { container } = renderWithProviders(<OddsBar pct={62} />);
    const bar = screen.getByRole('img', { name: '62% win probability' });
    expect(bar.children).toHaveLength(20);
    expect(container.querySelectorAll('[data-on="true"]')).toHaveLength(12);
  });

  test('clamps out-of-range percentages', () => {
    const { container } = renderWithProviders(<OddsBar pct={140} label={false} />);
    expect(container.querySelectorAll('[data-on="true"]')).toHaveLength(20);
  });
});

/* eslint-enable testing-library/no-node-access, testing-library/no-container */

describe('CountBadge', () => {
  test('speaks a sentence, singular and plural, and a custom noun', () => {
    const { unmount: unmountOne } = renderWithProviders(<CountBadge n={1} />);
    expect(screen.getByText('1 thing needs you')).toBeInTheDocument();
    unmountOne();
    const { unmount: unmountMany } = renderWithProviders(<CountBadge n={3} />);
    expect(screen.getByText('3 things need you')).toBeInTheDocument();
    unmountMany();
    renderWithProviders(<CountBadge n={2} noun="leagues" />);
    expect(screen.getByText('2 leagues')).toBeInTheDocument();
  });
});

describe('ErrorPanel', () => {
  test('is an alert with a retry', () => {
    const onRetry = jest.fn();
    renderWithProviders(<ErrorPanel title="Could not load" body="Try again." onRetry={onRetry} retryAriaLabel="Retry loading plays" />);
    const alert = screen.getByRole('alert');
    within(alert).getByRole('button', { name: 'Retry loading plays' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('PsButton disabled', () => {
  test('a button is natively disabled and does not click', async () => {
    const onClick = jest.fn();
    renderWithProviders(<PsButton disabled onClick={onClick}>Turn on alerts</PsButton>);
    const button = screen.getByRole('button', { name: 'Turn on alerts' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('a link says aria-disabled and does not navigate or fire onClick', async () => {
    const onClick = jest.fn();
    renderWithProviders(<PsButton disabled to="/league/1" onClick={onClick}>Open</PsButton>);
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('enabled, neither carries a disabled state', () => {
    renderWithProviders(<><PsButton>One</PsButton><PsButton to="/x">Two</PsButton></>);
    expect(screen.getByRole('button', { name: 'One' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Two' })).not.toHaveAttribute('aria-disabled');
  });
});

describe('pixelSx', () => {
  test('snaps up to 16 and caps at 32 on the 8px grid', () => {
    expect([12, 16, 20, 24, 32, 40].map((n) => pixelSx(n).fontSize)).toEqual(['16px', '16px', '24px', '24px', '32px', '32px']);
  });
});
