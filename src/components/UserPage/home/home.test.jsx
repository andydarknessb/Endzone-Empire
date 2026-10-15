import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import {
  CountBadge, ErrorPanel, HomeButton, LeagueLinks, OddsBar, PickemTile, PlayCard, ScoreTile, pixelSx,
} from './index';

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
    const urgent = renderWithProviders(<PlayCard {...card} state="urgent" lead countdown="in 5 min" />);
    expect(getComputedStyle(urgent.container.querySelector('.slot')).getPropertyValue('--cur')).toBe('var(--home-danger)');
    urgent.unmount();
    const next = renderWithProviders(<PlayCard {...card} state="next" lead />);
    expect(getComputedStyle(next.container.querySelector('.slot')).getPropertyValue('--cur')).toBe('var(--home-cursor)');
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

describe('LeagueLinks', () => {
  test('runs Matchup, Lineup, Picks, Waivers whatever order it is given, and drops the rest', () => {
    renderWithProviders(
      <LeagueLinks
        league="Sunday League"
        links={[
          { label: 'Waivers', to: '/w' },
          { label: 'Picks', to: '/p' },
          { label: 'Matchup', to: '/m' },
          { label: 'Lineup', to: '/l' },
          { label: 'Trade', to: '/t' },
        ]}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Sunday League' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Matchup', 'Lineup', 'Picks', 'Waivers']);
    expect(within(nav).getByRole('link', { name: 'Sunday League matchup' })).toHaveAttribute('href', '/m');
  });

  test('renders nothing when the league has none of the four', () => {
    const { container } = renderWithProviders(<LeagueLinks league="X" links={[]} />);
    expect(container.querySelector('nav')).toBeNull();
  });
});

describe('ScoreTile', () => {
  const tile = {
    league: 'Sunday League',
    status: 'Q3 · 4:12',
    you: { name: 'You', score: '88.4' },
    opp: { name: 'Gridiron Gang', score: '71.0' },
    youLeads: true,
    margin: '+17.4',
    pct: 80,
    to: '/leagues/1/matchup',
    ariaLabel: 'Sunday League matchup: you 88.4, Gridiron Gang 71.0',
    links: [{ label: 'Lineup', to: '/l' }],
  };

  test('the score block is one link with the whole score as its name', () => {
    renderWithProviders(<ScoreTile {...tile} />);
    const block = screen.getByRole('link', { name: tile.ariaLabel });
    expect(block).toHaveAttribute('href', '/leagues/1/matchup');
    expect(block).not.toHaveClass('scored');
    expect(within(block).getByRole('img', { name: '80% win probability' })).toBeInTheDocument();
  });

  test('scored puts the flash class on the score block', () => {
    renderWithProviders(<ScoreTile {...tile} scored />);
    expect(screen.getByRole('link', { name: tile.ariaLabel })).toHaveClass('scored');
  });
});

describe('PickemTile', () => {
  test('one link for the figure, and the Picks link is not repeated in the foot', () => {
    renderWithProviders(
      <PickemTile
        league="Pick'em League"
        standing="3rd of 12"
        figure="74"
        figureLabel="points"
        note="9 of 14 picked"
        to="/p"
        ariaLabel="Pick'em League picks: 74 points"
        links={[{ label: 'Picks', to: '/p' }, { label: 'Waivers', to: '/w' }]}
      />
    );
    expect(screen.getByRole('link', { name: "Pick'em League picks: 74 points" })).toHaveAttribute('href', '/p');
    expect(screen.getByRole('link', { name: "Pick'em League waivers" })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: "Pick'em League picks" })).toBeNull();
  });
});

describe('CountBadge', () => {
  test('speaks a sentence, singular and plural, and a custom noun', () => {
    const one = renderWithProviders(<CountBadge n={1} />);
    expect(one.getByText('1 thing needs you')).toBeInTheDocument();
    one.unmount();
    const many = renderWithProviders(<CountBadge n={3} />);
    expect(many.getByText('3 things need you')).toBeInTheDocument();
    many.unmount();
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

describe('HomeButton disabled', () => {
  test('a button is natively disabled and does not click', async () => {
    const onClick = jest.fn();
    renderWithProviders(<HomeButton disabled onClick={onClick}>Turn on alerts</HomeButton>);
    const button = screen.getByRole('button', { name: 'Turn on alerts' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('a link says aria-disabled and does not navigate or fire onClick', async () => {
    const onClick = jest.fn();
    renderWithProviders(<HomeButton disabled to="/league/1" onClick={onClick}>Open</HomeButton>);
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('enabled, neither carries a disabled state', () => {
    renderWithProviders(<><HomeButton>One</HomeButton><HomeButton to="/x">Two</HomeButton></>);
    expect(screen.getByRole('button', { name: 'One' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Two' })).not.toHaveAttribute('aria-disabled');
  });
});

describe('pixelSx', () => {
  test('snaps up to 16 and caps at 32 on the 8px grid', () => {
    expect([12, 16, 20, 24, 32, 40].map((n) => pixelSx(n).fontSize)).toEqual(['16px', '16px', '24px', '24px', '32px', '32px']);
  });
});
