import React, { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import ActionQueue from './ActionQueue';
import { invalidate, setResource } from '../../lib/resourceCache';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

// "Call your plays": the action items (GET /api/user/action-items, Contract A)
// and the featured draft, as Play-select cards. ActionQueue renders alone here,
// with apiClient mocked; the page-level wiring is UserPage's own tests.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// A few seconds of slack so the minute a test computes is still the minute rendered.
const inFromNow = (ms) => new Date(Date.now() + ms + 20 * 1000).toISOString();

const item = (overrides = {}) => ({
  id: 'lineup_problem:71:2026-6',
  type: 'lineup_problem',
  leagueId: 71,
  leagueName: 'Winsconsota',
  title: 'Fill your empty FLEX slot',
  detail: '3 bench players are still to play',
  severity: 'timed',
  deadlineAt: null,
  cta: { label: 'Fix lineup', to: '/league/71/lineup' },
  progress: null,
  ...overrides,
});

// One slate shares one lock: computed once, so two leagues' items never differ by the millisecond between calls.
const SLATE_LOCK = inFromNow(26 * HOUR);
const picks = (id, leagueName, overrides = {}) => item({
  id: `picks_open:${id}:2026-6`,
  type: 'picks_open',
  leagueId: id,
  leagueName,
  title: '14 picks still open',
  detail: '0 of 14 made for week 6',
  deadlineAt: SLATE_LOCK,
  cta: { label: 'Make picks', to: `/league/${id}/pickem` },
  progress: { done: 0, total: 14, open: 14 },
  ...overrides,
});

const waiver = (overrides = {}) => item({
  id: 'waiver_claims:71',
  type: 'waiver_claims',
  title: '1 waiver claim pending',
  detail: 'Claims process at their clear time',
  severity: 'info',
  deadlineAt: inFromNow(30 * HOUR),
  cta: { label: 'View claims', to: '/league/71/waivers' },
  ...overrides,
});

const body = (items, extra = {}) => ({
  generatedAt: new Date().toISOString(), counts: { total: items.length, dueToday: 0 }, partial: [], items, ...extra,
});

const liveLeague = (overrides = {}) => ({
  id: 9, name: 'Night League', draft_status: 'active', draft_date: new Date(Date.now() - HOUR).toISOString(), ...overrides,
});

// `answer`: a body, an Error (rejects), a function (per request) or 'pending'.
const mockItems = (answer) => {
  apiClient.get.mockImplementation(() => {
    const value = typeof answer === 'function' ? answer() : answer;
    if (value === 'pending') return new Promise(() => {});
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve({ data: value });
  });
};

// The cursor frame and filled foot are a CSS class and a data attribute with no role.
// eslint-disable-next-line testing-library/no-node-access, testing-library/no-container
const cursors = (container) => container.querySelectorAll('.cursor');
// eslint-disable-next-line testing-library/no-node-access, testing-library/no-container
const filled = (container) => container.querySelectorAll('[data-filled="true"]');
const frame = () => screen.findByRole('region', { name: 'Call your plays' });

beforeEach(() => { invalidate(undefined, { reload: false }); });
afterEach(() => {
  jest.clearAllMocks();
});

describe('the play cards', () => {
  test('fetches with the viewer time zone and heads the frame with a count of the cards', async () => {
    mockItems(body([picks(1, "Sunday Pick'em"), item({ deadlineAt: inFromNow(3 * HOUR) })]));
    renderWithProviders(<ActionQueue leagues={[]} />);

    const region = await frame();
    expect(within(region).getByRole('heading', { level: 2, name: 'Call your plays' })).toBeInTheDocument();
    expect(within(region).getByText('2 things need you')).toBeInTheDocument();
    expect(within(region).getByText(/^Earliest lock first · times in .+ · updated just now$/)).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith(
      `/api/user/action-items?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`
    );
  });

  test('a remount answered from the cache stamps the time of that fetch, not the mount', async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const realNow = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow - 10 * MINUTE);
    setResource(['action-items', tz], body([item({ deadlineAt: inFromNow(3 * HOUR) })]));
    clock.mockRestore();
    mockItems('pending'); // the quiet refetch stays in flight, so the cached entry is what is shown
    renderWithProviders(<ActionQueue leagues={[]} />);

    const region = await frame();
    expect(within(region).getByText(/ · updated 10 min ago$/)).toBeInTheDocument();
  });

  test('picks in two leagues are one card with a foot per league; one cursor, one filled foot', async () => {
    mockItems(body([
      picks(2, 'Thursday Night Regulars', { progress: { done: 3, total: 14, open: 11 } }),
      picks(1, "Sunday Pick'em"),
    ]));
    const { container } = renderWithProviders(<ActionQueue leagues={[]} />);

    const group = await screen.findByRole('group', { name: /^Next up: Picks\./ });
    expect(within(group).getByText('2 leagues · 14 games')).toBeInTheDocument();
    const feet = within(group).getAllByRole('link');
    expect(feet).toHaveLength(2);
    expect(feet[0]).toHaveAccessibleName("Make picks in Sunday Pick'em, 0 of 14 made");
    expect(feet[1]).toHaveAccessibleName('Make picks in Thursday Night Regulars, 3 of 14 made');
    expect(feet[1]).toHaveAttribute('href', '/league/2/pickem');
    expect(cursors(container)).toHaveLength(1);
    expect(filled(container)).toHaveLength(1);
    expect(filled(container)[0]).toBe(feet[0]);
  });

  test('a lineup problem 40 minutes out leads in the urgent strip; the picks after it stay open', async () => {
    mockItems(body([
      picks(1, "Sunday Pick'em", { deadlineAt: inFromNow(5 * HOUR) }),
      item({ deadlineAt: inFromNow(40 * MINUTE) }),
    ]));
    const { container } = renderWithProviders(<ActionQueue leagues={[]} />);

    const lead = await screen.findByRole('link', { name: /^Next up: Fill your empty FLEX slot\./ });
    expect(lead).toHaveAttribute('href', '/league/71/lineup');
    expect(lead).toHaveTextContent('40 min left');
    // the slot wrapper is a CSS class with no role
    // eslint-disable-next-line testing-library/no-node-access
    expect(lead.closest('.slot')).toHaveStyle({ '--cur': 'var(--ps-danger)' });
    expect(cursors(container)).toHaveLength(1);
    expect(filled(container)).toHaveLength(1);
    // the filled foot is a data attribute with no role
    // eslint-disable-next-line testing-library/no-node-access
    expect(within(lead).getByText('Fix lineup').closest('[data-filled]')).toHaveAttribute('data-filled', 'true');
    // The earlier lock is first in the grid.
    const names = screen.getAllByRole('link').map((l) => l.getAttribute('aria-label')).filter(Boolean);
    expect(names[0]).toMatch(/^Next up: Fill your empty FLEX slot/);
    expect(screen.getByRole('link', { name: /^14 picks still open\./ })).toBeInTheDocument();
  });

  test('only the lead can be urgent: a second card inside the hour stays open', async () => {
    mockItems(body([
      item({ id: 'a', title: 'First', deadlineAt: inFromNow(20 * MINUTE) }),
      item({ id: 'b', title: 'Second', deadlineAt: inFromNow(50 * MINUTE) }),
    ]));
    const { container } = renderWithProviders(<ActionQueue leagues={[]} />);

    await screen.findByRole('link', { name: /^Next up: First\./ });
    expect(container.textContent).toContain('20 min left');
    expect(container.textContent).not.toContain('50 min left');
    expect(cursors(container)).toHaveLength(1);
  });

  test('a live draft never outranks a pick that locks during it: the pick leads, the draft foot is outlined', async () => {
    mockItems(body([
      item({
        id: 'draft_live:9', type: 'draft_live', leagueId: 9, leagueName: 'Night League', title: 'Your draft is live', severity: 'blocking', deadlineAt: new Date().toISOString(), cta: { label: 'Join draft', to: '/league/9/draft' },
      }),
      picks(1, "Sunday Pick'em", { deadlineAt: inFromNow(38 * MINUTE) }),
    ]));
    const { container } = renderWithProviders(<ActionQueue leagues={[liveLeague()]} />);

    const lead = await screen.findByRole('link', { name: /^Next up: 14 picks still open\./ });
    expect(lead).toHaveTextContent('38 min left');
    // The league's draft_live item and the featured draft are one card, not two.
    const draft = screen.getByRole('link', { name: /^Draft room open\./ });
    expect(screen.getAllByRole('link', { name: /Draft room open/ })).toHaveLength(1);
    // the slot wrapper and filled foot are a CSS class and a data attribute with no role
    /* eslint-disable testing-library/no-node-access */
    expect(draft.closest('.slot')).not.toHaveClass('cursor');
    expect(draft.querySelector('[data-filled]')).toBeNull();
    /* eslint-enable testing-library/no-node-access */
    expect(cursors(container)).toHaveLength(1);
    expect(filled(container)).toHaveLength(1);
  });

  test('a live draft alone leads, with the live lock line and no pick slot', async () => {
    mockItems(body([]));
    const { container } = renderWithProviders(<ActionQueue leagues={[liveLeague()]} />);

    const lead = await screen.findByRole('link', { name: /^Next up: Draft room open\./ });
    expect(lead).toHaveAttribute('href', '/league/9/draft');
    expect(within(lead).getByText('Night League')).toBeInTheDocument();
    expect(within(lead).getByText('Live now')).toBeInTheDocument();
    expect(within(lead).getByText('If your clock runs out, autopick covers your turn.')).toBeInTheDocument();
    expect(within(lead).getByText('Open draft room')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/you pick/i);
    expect(cursors(container)).toHaveLength(1);
    expect(filled(container)).toHaveLength(1);
  });

  test('a member waiting on a draft that did not auto-start: cursor on it, no filled action on the page', async () => {
    mockItems(body([]));
    const waiting = { id: 4, name: 'Late League', draft_status: 'pending', draft_autostart_failed: true, draft_date: new Date(Date.now() - 2 * HOUR).toISOString() };
    const { container } = renderWithProviders(<ActionQueue leagues={[waiting]} />);

    await screen.findByRole('link', { name: /^Next up: Draft waiting./ });
    expect(cursors(container)).toHaveLength(1);
    expect(filled(container)).toHaveLength(0);
  });

  test('a draft_live item still makes the card when the leagues have not loaded', async () => {
    mockItems(body([
      item({
        id: 'draft_live:9', type: 'draft_live', leagueId: 9, leagueName: 'Night League', title: 'Your draft is live', severity: 'blocking', deadlineAt: new Date().toISOString(), cta: { label: 'Join draft', to: '/league/9/draft' },
      }),
    ]));
    renderWithProviders(<ActionQueue leagues={[]} />);

    expect(await screen.findByRole('link', { name: /^Next up: Draft room open\./ })).toHaveAttribute('href', '/league/9/draft');
  });

  test('a trade offer and an unknown type each get one card with the server cta', async () => {
    mockItems(body([
      item({
        id: 't', type: 'trade_offer', title: 'Trade offer from Bob', detail: 'Accept, counter or decline', severity: 'untimed', cta: { label: 'Review offer', to: '/league/71/trades' },
      }),
      item({
        id: 'x', type: 'brand_new', title: 'Something new', severity: 'untimed', cta: { label: 'Look', to: '/league/71' },
      }),
    ]));
    renderWithProviders(<ActionQueue leagues={[]} />);

    expect(await screen.findByRole('link', { name: /Review offer/ })).toHaveAttribute('href', '/league/71/trades');
    expect(screen.getByRole('link', { name: /Look/ })).toHaveAttribute('href', '/league/71');
  });

  test('more than 4 plays hide the rest behind Show all, which reveals them', async () => {
    mockItems(body([1, 2, 3, 4, 5].map((n) => item({
      id: `l${n}`, title: `Play ${n}`, deadlineAt: inFromNow((n + 1) * HOUR), cta: { label: 'Fix', to: `/league/${n}` },
    }))));
    renderWithProviders(<ActionQueue leagues={[]} />);

    await screen.findByRole('link', { name: /Play 1\./ });
    expect(screen.queryByText('Play 5', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^(Next up: )?Play \d\./ })).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: 'Show all 5' }));
    expect(screen.getAllByRole('link', { name: /^(Next up: )?Play \d\./ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });
});

describe('lead order and the Shared Lock Rule', () => {
  const seatsOpen = (overrides = {}) => item({
    id: 'seats_open:4',
    type: 'seats_open',
    leagueId: 4,
    leagueName: 'Late League',
    title: 'Fill the empty seats',
    severity: 'blocking',
    deadlineAt: new Date(Date.now() - HOUR).toISOString(),
    cta: { label: 'Invite managers', to: '/league/4' },
    ...overrides,
  });
  const failedDraft = (overrides = {}) => ({
    id: 4, name: 'Late League', draft_status: 'pending', draft_autostart_failed: true, is_owner: true, draft_date: new Date(Date.now() - 2 * HOUR).toISOString(), ...overrides,
  });

  test('a stale seats_open never outranks the late draft: it is dropped and the draft leads with the filled foot', async () => {
    mockItems(body([seatsOpen()]));
    const { container } = renderWithProviders(<ActionQueue leagues={[failedDraft()]} />);

    const lead = await screen.findByRole('link', { name: /^Next up: Draft waiting on you./ });
    expect(lead).toHaveTextContent('Draft waiting on you');
    expect(screen.queryByText('Fill the empty seats')).not.toBeInTheDocument();
    expect(cursors(container)).toHaveLength(1);
    expect(filled(container)).toHaveLength(1);
    expect(lead).toContainElement(filled(container)[0]);
    expect(screen.getByText('1 thing needs you')).toBeInTheDocument();
  });

  test('any other play whose lock has passed ranks after the draft card; a lock still ahead leads', async () => {
    mockItems(body([
      item({ id: 'old', title: 'Past lock play', deadlineAt: new Date(Date.now() - 10 * MINUTE).toISOString() }),
      item({ id: 'new', title: 'Future lock play', deadlineAt: inFromNow(3 * HOUR) }),
    ]));
    renderWithProviders(<ActionQueue leagues={[failedDraft()]} />);

    await screen.findByRole('link', { name: /^Next up: Future lock play./ });
    const names = screen.getAllByRole('link').map((l) => l.getAttribute('aria-label')).filter(Boolean);
    expect(names.map((n) => n.replace('Next up: ', '').split('.')[0])).toEqual([
      'Future lock play', 'Draft waiting on you', 'Past lock play',
    ]);
  });

  test('picks that share a lock are one card; picks with different locks are separate cards', async () => {
    mockItems(body([
      picks(1, "Sunday Pick'em"),
      picks(2, 'Thursday Night Regulars'),
      picks(3, 'Monday League', { deadlineAt: inFromNow(50 * HOUR) }),
    ]));
    const { container } = renderWithProviders(<ActionQueue leagues={[]} />);

    const group = await screen.findByRole('group', { name: /^Next up: Picks\./ });
    expect(within(group).getByText('2 leagues · 14 games')).toBeInTheDocument();
    expect(within(group).getAllByRole('link')).toHaveLength(2);
    const lone = screen.getByRole('link', { name: /^14 picks still open. Make picks in Monday League/ });
    expect(within(lone).getByText('Monday League · 14 games')).toBeInTheDocument();
    expect(screen.getByText('2 things need you')).toBeInTheDocument();
    expect(cursors(container)).toHaveLength(1);
    expect(filled(container)).toHaveLength(1);
  });
});

describe('lock notes in words', () => {
  test('the picks note reads in hours, not "1d 01h"', async () => {
    mockItems(body([picks(1, "Sunday Pick'em")]));
    renderWithProviders(<ActionQueue leagues={[]} />);

    expect(await screen.findByText('First game locks in 26 hours. Each game locks at its own kickoff.')).toBeInTheDocument();
  });

  test('inside the last hour the note reads in minutes and the urgent strip keeps "N min left"', async () => {
    mockItems(body([picks(1, "Sunday Pick'em", { deadlineAt: inFromNow(37 * MINUTE) })]));
    renderWithProviders(<ActionQueue leagues={[]} />);

    expect(await screen.findByText('First game locks in 37 min. Each game locks at its own kickoff.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Next up: 14 picks still open./ })).toHaveTextContent('37 min left');
  });
});

describe('on the sideline', () => {
  test('waiver claims sit under the cards with a link, followed by the one-line promise', async () => {
    mockItems(body([picks(1, "Sunday Pick'em"), waiver({ leagueName: 'Winsconsota' })]));
    renderWithProviders(<ActionQueue leagues={[]} />);

    const region = await frame();
    expect(within(region).getByRole('heading', { level: 3, name: 'On the sideline' })).toBeInTheDocument();
    expect(within(region).getByText('1 waiver claim pending')).toBeInTheDocument();
    expect(within(region).getByText(/^Winsconsota · clears /)).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'View claims in Winsconsota' })).toHaveAttribute('href', '/league/71/waivers');
    expect(within(region).getByText(/^Nothing else is due before \w+day's kickoff\.$/)).toBeInTheDocument();
    // The waiver claim is not a play: one card, one badge.
    expect(within(region).getByText('1 thing needs you')).toBeInTheDocument();
  });

  test('says nothing else is due before the next lock weekday with no sideline items', async () => {
    mockItems(body([picks(1, "Sunday Pick'em")]));
    renderWithProviders(<ActionQueue leagues={[]} />);

    const region = await frame();
    expect(within(region).getByText(/^Nothing else is due before \w+day's kickoff\.$/)).toBeInTheDocument();
  });

  test('says nothing else is due today when the next lock is later today', async () => {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 0);
    const laterToday = new Date(Date.now() + (endOfDay.getTime() - Date.now()) / 2).toISOString();
    mockItems(body([picks(1, "Sunday Pick'em", { deadlineAt: laterToday })]));
    renderWithProviders(<ActionQueue leagues={[]} />);

    const region = await frame();
    expect(within(region).getByText('Nothing else is due today.')).toBeInTheDocument();
    expect(within(region).queryByText(/before \w+day's kickoff/)).not.toBeInTheDocument();
  });

  test('says nothing else needs you today when no play has a lock', async () => {
    mockItems(body([item({
      id: 't', type: 'trade_offer', title: 'Trade offer from Bob', severity: 'untimed', cta: { label: 'Review offer', to: '/league/71/trades' },
    })]));
    renderWithProviders(<ActionQueue leagues={[]} />);

    expect(await screen.findByText('Nothing else needs you today.')).toBeInTheDocument();
  });
});

describe('empty, loading and error', () => {
  test('info-only items: nothing needs you, no badge, the waiver row on the sideline, no cursor or filled foot', async () => {
    mockItems(body([waiver()]));
    const { container } = renderWithProviders(<ActionQueue leagues={[]} />);

    const region = await frame();
    expect(within(region).getByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(within(region).queryByText(/^\d+ things? needs? you$/)).not.toBeInTheDocument();
    expect(within(region).getByRole('heading', { level: 3, name: 'On the sideline' })).toBeInTheDocument();
    expect(within(region).getByText('1 waiver claim pending')).toBeInTheDocument();
    expect(cursors(container)).toHaveLength(0);
    expect(filled(container)).toHaveLength(0);
  });

  test('no items at all: the huddle breaks, all plays called', async () => {
    mockItems(body([]));
    const { container } = renderWithProviders(<ActionQueue leagues={[]} />);

    const region = await frame();
    expect(within(region).getByText('All plays called')).toBeInTheDocument();
    expect(within(region).getByText('Nothing needs you right now.')).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container
    const huddle = region.querySelector('svg.huddle-break');
    expect(huddle).toHaveAttribute('aria-hidden', 'true');
    // eslint-disable-next-line testing-library/no-node-access
    expect(huddle.querySelectorAll('path')).toHaveLength(3);
    expect(within(region).queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(cursors(container)).toHaveLength(0);
    expect(filled(container)).toHaveLength(0);
  });

  test('shows a skeleton in the card shape until the list arrives', async () => {
    mockItems('pending');
    renderWithProviders(<ActionQueue leagues={[]} />);

    expect(screen.getByTestId('action-queue-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your plays');
    expect(screen.queryByText('Nothing needs you right now.')).not.toBeInTheDocument();
  });

  test('a failed fetch is an error with Try again, never the empty line; Try again refetches', async () => {
    let calls = 0;
    mockItems(() => {
      calls += 1;
      return calls === 1 ? new Error('Network Error') : body([item({ deadlineAt: inFromNow(3 * HOUR) })]);
    });
    const onLoaded = jest.fn();
    renderWithProviders(<ActionQueue leagues={[]} onLoaded={onLoaded} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't check what needs you");
    expect(alert).toHaveTextContent('Your leagues are below. Open each one, or try again.');
    expect(screen.queryByText('Nothing needs you right now.')).not.toBeInTheDocument();
    expect(screen.queryByText('Network Error')).not.toBeInTheDocument();
    expect(onLoaded).toHaveBeenLastCalledWith(null);

    await userEvent.click(screen.getByRole('button', { name: 'Try checking your plays again' }));
    expect(await screen.findByRole('link', { name: /^Next up: Fill your empty FLEX slot\./ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onLoaded).toHaveBeenLastCalledWith(expect.objectContaining({ items: expect.any(Array) }));
  });

  test('a list with a failed builder and nothing to show is not "nothing needs you"', async () => {
    mockItems(body([], { partial: ['lineup_problem'] }));
    renderWithProviders(<ActionQueue leagues={[]} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check what needs you");
    expect(screen.queryByText('Nothing needs you right now.')).not.toBeInTheDocument();
  });
});

describe('refreshKey', () => {
  function Harness({ onLoaded }) {
    const [key, setKey] = useState(0);
    return (
      <>
        <button type="button" onClick={() => setKey((k) => k + 1)}>refresh</button>
        <ActionQueue leagues={[]} refreshKey={key} onLoaded={onLoaded} />
      </>
    );
  }

  test('a change refetches quietly: no skeleton, and the new list replaces the old', async () => {
    let calls = 0;
    mockItems(() => {
      calls += 1;
      return body([item({ title: calls === 1 ? 'Old play' : 'New play', deadlineAt: inFromNow(3 * HOUR) })]);
    });
    renderWithProviders(<Harness />);

    await screen.findByRole('link', { name: /Old play/ });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
    expect(screen.queryByTestId('action-queue-skeleton')).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /New play/ })).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  test('a refetch keeps the empty state mounted, so the huddle does not replay', async () => {
    mockItems(body([]));
    const { container } = renderWithProviders(<Harness />);

    await screen.findByText('All plays called');
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container
    const huddle = container.querySelector('svg.huddle-break');
    mockItems('pending');
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
    expect(apiClient.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Loading your plays')).not.toBeInTheDocument();
    expect(screen.getByText('All plays called')).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container
    expect(container.querySelector('svg.huddle-break')).toBe(huddle);
  });

  test('a failed refetch keeps the old plays and shows no error', async () => {
    let calls = 0;
    mockItems(() => {
      calls += 1;
      return calls === 1 ? body([item({ title: 'Old play', deadlineAt: inFromNow(3 * HOUR) })]) : new Error('down');
    });
    const onLoaded = jest.fn();
    renderWithProviders(<Harness onLoaded={onLoaded} />);

    await screen.findByRole('link', { name: /Old play/ });
    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(apiClient.get).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: /Old play/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });
});
