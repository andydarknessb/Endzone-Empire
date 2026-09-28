import React from 'react';
import { fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';

// Home v2 slice 4: Create league in five steps (CreateLeagueStepper). The seam
// is the page itself: UserPage rendered the way the app mounts it, apiClient
// mocked, so every assertion is about what a manager sees and what is sent.

// Each test walks the whole five-step flow over the full Home page, and a role
// query there costs about 450 ms in jsdom (measured 2026-09-28: getByRole 450 ms,
// getByLabelText 4 ms, the click itself 20-100 ms). The slowest test takes 8.9 s
// alone and about twice that under a parallel full-suite run, past the 15 s
// default in setupTests (8 tests failed there). The ceiling only matters on
// the failure path.
jest.setTimeout(45000);

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  my_team_id: 10,
  my_team_name: "alice's Team",
  draft_status: 'pending',
  owner_id: 1,
  ...overrides,
});

const getCallsTo = (url) => apiClient.get.mock.calls.filter(([calledUrl]) => calledUrl === url).length;

const renderPage = () => renderWithProviders(<SnackbarProvider><UserPage /></SnackbarProvider>, { state: baseState });

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

// The page's first Create league button (the header one). Matched loosely so
// the header's own copy can change without touching these tests.
const openCreate = async () => {
  await userEvent.click(screen.getAllByRole('button', { name: /create league/i })[0]);
  return screen.findByRole('dialog');
};
const next = () => userEvent.click(screen.getByRole('button', { name: 'Continue' }));
const submitCreate = () => userEvent.click(screen.getByRole('button', { name: 'Create league' }));
const heading = (name) => screen.getByRole('heading', { name });
const rail = () => within(screen.getByRole('navigation', { name: 'Create league steps' }));
const preview = () => within(screen.getByRole('complementary', { name: 'League preview' }));
// Keystroke-by-keystroke typing is covered where it matters (Enter advances,
// errors clear as the manager types); elsewhere a change event keeps these
// long walks through five steps fast.
const fillBasics = async (name, team) => {
  fireEvent.change(screen.getByLabelText(/League name/), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/Team name/), { target: { value: team } });
};

// Type -> Basics -> Rules -> Draft -> Review with every default kept.
const walkToReview = async ({ name = 'Monday Mayhem', team = 'Squad' } = {}) => {
  await openCreate();
  await next();
  await fillBasics(name, team);
  await next();
  await next();
  await next();
  expect(heading('Look good?')).toBeInTheDocument();
};

const mountEmpty = async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));
};

afterEach(() => {
  jest.clearAllMocks();
});

// --- Defaults and the live preview ---

test('the stepper opens on League type with the fantasy defaults: 12 teams, Half PPR, private, draft later', async () => {
  await mountEmpty();
  await openCreate();

  expect(heading('What kind of league?')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Fantasy football league/ })).toBeChecked();
  expect(screen.getByText('Draft, rosters, lineups, and weekly matchups.')).toBeInTheDocument();
  expect(screen.getByText('Pick winners every week. No draft and no rosters.')).toBeInTheDocument();
  expect(screen.getByText("A full fantasy league with pick'em turned on from day one.")).toBeInTheDocument();

  await next();
  expect(screen.getByLabelText('Teams')).toHaveValue(12);

  await next(); // Basics is empty: stays put
  await fillBasics('Monday Mayhem', 'Squad');
  await next();
  expect(screen.getByRole('radio', { name: /^Half PPR/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /^Private/ })).toBeChecked();
  expect(screen.queryByLabelText(/Require commissioner approval/)).not.toBeInTheDocument();

  await next();
  expect(screen.getByRole('radio', { name: /^Schedule later/ })).toBeChecked();
  expect(screen.queryByLabelText('Draft date')).not.toBeInTheDocument();

  const chips = preview().getAllByRole('listitem').map((li) => li.textContent);
  expect(chips).toEqual(['Fantasy football', '12 teams', 'Half PPR', 'Private', 'Draft TBD']);
});

test('the preview card shows the league and team names as they are typed', async () => {
  await mountEmpty();
  await openCreate();
  expect(preview().getByText('Untitled league')).toBeInTheDocument();

  await next();
  await fillBasics('Monday Mayhem', 'Squad');

  expect(preview().getByText('Monday Mayhem')).toBeInTheDocument();
  expect(preview().getByText('Squad · Commissioner')).toBeInTheDocument();
});

test('Scoring offers Standard, Half PPR and PPR once each', async () => {
  await mountEmpty();
  await openCreate();
  await next();
  await fillBasics('X', 'Y');
  await next();

  const scoring = within(screen.getByRole('radiogroup', { name: 'Scoring' }));
  expect(scoring.getAllByRole('radio').map((r) => r.value)).toEqual(['standard', 'half_ppr', 'ppr']);
});

// --- Payloads: exactly what the one-screen dialog sent ---

test('creating a fantasy league with the defaults posts the same payload, announces it, refetches and shows the done step', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2, name: 'Monday Mayhem', invite_code: 'ab12cd34' } });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await walkToReview();
  await submitCreate();

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Monday Mayhem',
      teamName: 'Squad',
      maxTeams: 12,
      leagueType: 'fantasy',
      scoringPreset: 'half_ppr',
    })
  );
  expect(await screen.findByText('League created!')).toBeInTheDocument();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(2));

  const done = await screen.findByRole('heading', { name: 'Monday Mayhem is ready' });
  await waitFor(() => expect(done).toHaveFocus());
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('ab12cd34')).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: 'Go to league' })).toHaveAttribute('href', '/league/2');
});

test('a done step without a league id or invite code offers neither', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: {} });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await walkToReview();
  await submitCreate();

  expect(await screen.findByRole('heading', { name: 'Monday Mayhem is ready' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Go to league' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Copy invite/ })).not.toBeInTheDocument();
});

test('the done step copies the invite code and the invite link', async () => {
  const writeText = jest.fn().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2, invite_code: 'ab12cd34' } });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await walkToReview();
  await submitCreate();
  await screen.findByRole('heading', { name: 'Monday Mayhem is ready' });

  await userEvent.click(screen.getByRole('button', { name: 'Copy invite code ab12cd34' }));
  expect(writeText).toHaveBeenLastCalledWith('ab12cd34');
  expect(await screen.findByText('Invite code copied')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));
  expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/#/league/join?code=ab12cd34`);
  expect(await screen.findByText('Invite link copied')).toBeInTheDocument();
});

test('a public, approval-required, best-ball, half-PPR league with a draft date sends every field, the zone acknowledged', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await openCreate();
  await next();
  await fillBasics('Full League', 'Full Squad');
  await userEvent.click(screen.getByRole('button', { name: '10' }));
  expect(screen.getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'true');
  await next();

  await userEvent.click(screen.getByRole('radio', { name: /^PPR/ }));
  await userEvent.click(screen.getByRole('radio', { name: /^Half PPR/ }));
  await userEvent.click(screen.getByRole('checkbox', { name: /^Best ball/ }));
  await userEvent.click(screen.getByRole('radio', { name: /^Public/ }));
  await userEvent.click(screen.getByRole('checkbox', { name: /Require commissioner approval/ }));
  await next();

  await userEvent.click(screen.getByRole('radio', { name: /^Pick a date and time/ }));
  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '2026-09-04T13:00' } });
  // Filter first: opening the full list renders every IANA zone.
  await userEvent.type(screen.getByLabelText('Draft time zone'), 'New_York');
  await userEvent.click(await screen.findByRole('option', { name: 'America/New_York' }));

  // #116 AC3: the zone must be acknowledged before the draft step passes.
  await next();
  const ack = screen.getByRole('checkbox', { name: /confirm this draft date and time/i });
  expect(ack).toHaveAttribute('aria-invalid', 'true');
  expect(ack).toHaveAccessibleDescription('Confirm the draft date and time zone to continue.');
  expect(heading('Draft day')).toBeInTheDocument();

  await userEvent.click(ack);
  await next();
  await submitCreate();

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Full League',
      teamName: 'Full Squad',
      maxTeams: 10,
      leagueType: 'fantasy',
      isPublic: true,
      joinApproval: true,
      bestBall: true,
      scoringPreset: 'half_ppr',
      // #116 AC4: 1pm in America/New_York (EDT, UTC-4 in September), not
      // the test runner's own zone.
      draftDate: '2026-09-04T17:00:00.000Z',
      draftTimezone: 'America/New_York',
    })
  );
});

test('Schedule later with a date typed first sends no draft date', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await openCreate();
  await next();
  await fillBasics('Later League', 'Squad');
  await next();
  await next();
  await userEvent.click(screen.getByRole('radio', { name: /^Pick a date and time/ }));
  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '2026-09-04T13:00' } });
  await userEvent.click(screen.getByRole('radio', { name: /^Schedule later/ }));
  await next();
  await submitCreate();

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  expect(apiClient.post.mock.calls[0][1]).not.toHaveProperty('draftDate');
  expect(apiClient.post.mock.calls[0][1]).not.toHaveProperty('draftTimezone');
});

test("an NFL pick'em league sends leagueType, pickemMode and an explicit maxTeams, and none of the fantasy fields", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  // Fantasy-only answers given BEFORE the switch must not leak into the payload.
  await openCreate();
  await next();
  await fillBasics('Office Pool', 'Office Champs');
  await next();
  await userEvent.click(screen.getByRole('checkbox', { name: /^Best ball/ }));
  await next();
  await userEvent.click(screen.getByRole('radio', { name: /^Pick a date and time/ }));
  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '2026-09-04T13:00' } });

  await userEvent.click(rail().getByRole('button', { name: /^League type/ }));
  await userEvent.click(screen.getByRole('radio', { name: /NFL pick'em league/ }));
  await next();

  // A pick'em pool takes up to 50 managers, entered as a number.
  const managers = screen.getByLabelText('Managers');
  expect(managers).toHaveAttribute('type', 'number');
  expect(managers).toHaveAttribute('max', '50');
  await userEvent.clear(managers);
  await userEvent.type(managers, '30');
  await next();

  expect(screen.queryByRole('radiogroup', { name: 'Scoring' })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /^Best ball/ })).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Straight up/ })).toBeChecked();
  await next();

  expect(screen.getByText("Pick'em leagues don't draft.")).toBeInTheDocument();
  expect(screen.queryByLabelText('Draft date')).not.toBeInTheDocument();
  await next();
  await submitCreate();

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Office Pool',
      teamName: 'Office Champs',
      maxTeams: 30,
      leagueType: 'pickem',
      pickemMode: 'straight',
    })
  );
});

test("choosing Both sends leagueType 'both' with the chosen confidence mode and keeps the fantasy fields", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await openCreate();
  await userEvent.click(screen.getByRole('radio', { name: /^Both/ }));
  await next();
  await fillBasics('Everything League', 'Everything Squad');
  await next();
  await userEvent.click(screen.getByRole('radio', { name: /^Confidence/ }));
  await userEvent.click(screen.getByRole('checkbox', { name: /^Best ball/ }));
  expect(screen.getByRole('radiogroup', { name: 'Scoring' })).toBeInTheDocument();
  await next();
  await next();
  await submitCreate();

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Everything League',
      teamName: 'Everything Squad',
      maxTeams: 12,
      leagueType: 'both',
      pickemMode: 'confidence',
      bestBall: true,
      scoringPreset: 'half_ppr',
    })
  );
});

test("a fractional pick'em count is refused at Basics, then rounded down when the type switches to fantasy", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await openCreate();
  await userEvent.click(screen.getByRole('radio', { name: /NFL pick'em league/ }));
  await next();
  await fillBasics('Odd Pool', 'Odd Squad');
  const managers = screen.getByLabelText('Managers');
  await userEvent.clear(managers);
  await userEvent.type(managers, '12.5');
  await next();

  expect(heading('Name it and size it')).toBeInTheDocument();
  expect(managers).toHaveAttribute('aria-invalid', 'true');
  expect(managers).toHaveAccessibleDescription('Enter a whole number from 2 to 50.');

  await userEvent.click(rail().getByRole('button', { name: /^League type/ }));
  await userEvent.click(screen.getByRole('radio', { name: /Fantasy football league/ }));
  await next();
  expect(screen.getByLabelText('Teams')).toHaveValue(12);
  await next();
  await next();
  await next();
  await submitCreate();

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', expect.objectContaining({ maxTeams: 12, leagueType: 'fantasy' }))
  );
});

// --- A real form, validated on submit ---

test('Enter in a field advances the step, like Continue', async () => {
  await mountEmpty();
  await openCreate();
  await next();

  await userEvent.type(screen.getByLabelText(/League name/), 'Monday Mayhem');
  await userEvent.type(screen.getByLabelText(/Team name/), 'Squad{Enter}');

  expect(heading('House rules')).toBeInTheDocument();
});

test('Continue stays enabled and, on an empty Basics step, puts the errors under the fields and focuses the first', async () => {
  await mountEmpty();
  await openCreate();
  await next();

  const cont = screen.getByRole('button', { name: 'Continue' });
  expect(cont).toBeEnabled();
  await userEvent.click(cont);

  expect(heading('Name it and size it')).toBeInTheDocument();
  const name = screen.getByLabelText(/League name/);
  const team = screen.getByLabelText(/Team name/);
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(name).toHaveAccessibleDescription('Enter a league name.');
  expect(team).toHaveAttribute('aria-invalid', 'true');
  expect(team).toHaveAccessibleDescription('Enter your team name.');
  expect(name).toHaveFocus();
  expect(apiClient.post).not.toHaveBeenCalled();

  await userEvent.type(name, 'Monday Mayhem');
  await userEvent.type(team, 'Squad');
  await next();
  expect(heading('House rules')).toBeInTheDocument();
});

test('focus moves to each step heading as the manager advances', async () => {
  await mountEmpty();
  await openCreate();
  await waitFor(() => expect(heading('What kind of league?')).toHaveFocus());

  await next();
  await waitFor(() => expect(heading('Name it and size it')).toHaveFocus());
  await fillBasics('X', 'Y');
  await next();
  await waitFor(() => expect(heading('House rules')).toHaveFocus());
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(heading('Name it and size it')).toHaveFocus());
});

test('the step rail locks every step after the first invalid one', async () => {
  await mountEmpty();
  await openCreate();

  // Nothing ahead of the furthest step reached is open yet.
  expect(rail().getByRole('button', { name: /^Basics/ })).toHaveAttribute('aria-disabled', 'true');

  await next();
  await fillBasics('Monday Mayhem', 'Squad');
  await next();
  await next();
  await next();
  expect(rail().getByRole('button', { name: /^Review/ })).toHaveAttribute('aria-disabled', 'false');

  await userEvent.click(rail().getByRole('button', { name: /^Basics/ }));
  await userEvent.clear(screen.getByLabelText(/League name/));

  for (const step of [/^Rules/, /^Draft/, /^Review/]) {
    expect(rail().getByRole('button', { name: step })).toHaveAttribute('aria-disabled', 'true');
  }
  await userEvent.click(rail().getByRole('button', { name: /^Review/ }));
  expect(heading('Name it and size it')).toBeInTheDocument();
  expect(rail().getByRole('button', { name: /^Basics/ })).toHaveAttribute('aria-current', 'step');
});

test('Edit on the review step returns to that step', async () => {
  await mountEmpty();
  await walkToReview({ name: 'Monday Mayhem', team: 'Squad' });

  const review = within(screen.getByRole('dialog'));
  expect(review.getByText('Monday Mayhem · 12 teams')).toBeInTheDocument();
  expect(review.getByText('Half PPR · Private')).toBeInTheDocument();
  await userEvent.click(review.getByRole('button', { name: 'Edit rules' }));

  expect(heading('House rules')).toBeInTheDocument();
});

// --- In flight, failure, success ---

test('Create cannot be sent twice while the first request is in flight', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  const pending = deferred();
  apiClient.post.mockReturnValue(pending.promise);
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await walkToReview();
  await submitCreate();

  const busy = screen.getByRole('button', { name: 'Creating league…' });
  expect(busy).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(busy); // a forced second submit (e.g. key repeat) still must not post
  fireEvent.click(busy);
  expect(apiClient.post).toHaveBeenCalledTimes(1);

  pending.resolve({ data: { id: 2 } });
  expect(await screen.findByText('League created!')).toBeInTheDocument();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});

test('a failed create keeps the dialog open with the answers and shows the error once, inside it', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'name already taken' } } });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await walkToReview({ name: 'Dup League', team: 'Dup Squad' });
  await submitCreate();

  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText(/name already taken/)).toBeInTheDocument();
  const alerts = screen.queryAllByRole('alert').filter((el) => el.textContent.includes('name already taken'));
  expect(alerts).toHaveLength(1);
  expect(within(dialog).getByText("We couldn't create the league.")).toBeInTheDocument();
  expect(screen.queryByText('League created!')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create league' })).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Edit league' }));
  expect(screen.getByLabelText(/League name/)).toHaveValue('Dup League');
  expect(screen.getByLabelText(/Team name/)).toHaveValue('Dup Squad');
});

test('a successful create is announced once', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await walkToReview();
  await submitCreate();

  expect(await screen.findByText('League created!')).toBeInTheDocument();
  expect(screen.getAllByText('League created!')).toHaveLength(1);
});

// --- Closing ---

test('Cancel on the first step closes the dialog without making a write request', async () => {
  await mountEmpty();
  await openCreate();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('closing mid-way keeps the answers; closing the done step starts the next league fresh', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await openCreate();
  await userEvent.click(screen.getByRole('radio', { name: /NFL pick'em league/ }));
  await next();
  await fillBasics('Kept League', 'Kept Squad');
  await userEvent.click(screen.getByRole('button', { name: /^Close/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await openCreate();
  expect(heading('Name it and size it')).toBeInTheDocument();
  expect(screen.getByLabelText(/League name/)).toHaveValue('Kept League');

  await next();
  await next();
  await next();
  await submitCreate();
  await screen.findByRole('heading', { name: 'Kept League is ready' });
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await openCreate();
  expect(heading('What kind of league?')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Fantasy football league/ })).toBeChecked();
  await next();
  expect(screen.getByLabelText(/League name/)).toHaveValue('');
});

// --- A refetch never hides a good list ---

test('a failed refresh after a create keeps the last good list on screen, through the retry too', async () => {
  let leaguesCall = 0;
  const retry = deferred();
  apiClient.get.mockImplementation((url) => {
    if (url !== '/api/league') return Promise.resolve({ data: [] });
    leaguesCall += 1;
    if (leaguesCall === 1) return Promise.resolve({ data: [league()] });
    if (leaguesCall === 2) return Promise.reject({ response: { data: { error: 'server exploded' } } });
    return retry.promise;
  });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });
  renderPage();
  await screen.findByText('Sunday Ballers');

  await walkToReview();
  await submitCreate();
  await screen.findByRole('heading', { name: 'Monday Mayhem is ready' });
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  expect(await screen.findByText('server exploded')).toBeInTheDocument();
  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.queryAllByTestId('league-skeleton')).toHaveLength(0);

  retry.resolve({ data: [league(), league({ id: 2, name: 'Monday Mayhem' })] });
  expect(await screen.findByText('Monday Mayhem')).toBeInTheDocument();
});
