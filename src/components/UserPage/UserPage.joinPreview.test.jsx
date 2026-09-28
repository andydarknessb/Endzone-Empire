import React from 'react';
import { act, fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';

// Home v2 slice 5: the Join League dialog previews the league an invite code
// points at (GET /api/league/preview?code=, debounced 300ms) before the
// manager commits to a Team name.

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const PREVIEW_PREFIX = '/api/league/preview?code=';

// The allowlisted preview body discovery.service.js answers with.
const previewBody = (overrides = {}) => ({
  id: 42,
  name: 'Lakeshore Dynasty',
  maxTeams: 12,
  teamCount: 8,
  scoringPreset: 'half_ppr',
  bestBall: false,
  pickemOnly: false,
  pickemEnabled: false,
  joinApproval: false,
  draftDate: '2026-10-11T17:00:00.000Z',
  createdAt: '2026-09-01T12:00:00.000Z',
  alreadyMember: false,
  myRequestStatus: null,
  openSlots: 4,
  isPublic: false,
  ownerTeamName: 'Tundra Kings',
  joinable: true,
  joinReason: null,
  ...overrides,
});

const notFound = () => Promise.reject({ response: { status: 404, data: { error: 'no league with that invite code' } } });

// Every dashboard widget resolves empty; the preview answers with `preview`
// (a body, or a function returning a promise for failure shapes).
const mockApi = ({ preview } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (typeof url === 'string' && url.startsWith(PREVIEW_PREFIX)) {
      if (typeof preview === 'function') return preview(url);
      if (preview) return Promise.resolve({ data: preview });
      return notFound();
    }
    return Promise.resolve({ data: [] });
  });
};

const previewCalls = () => apiClient.get.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith(PREVIEW_PREFIX));
const getCallsTo = (url) => apiClient.get.mock.calls.filter(([calledUrl]) => calledUrl === url).length;
const heroButton = (name) => within(screen.getByTestId('dashboard-hero')).getByRole('button', { name });
const alertsWithText = (text) => screen.queryAllByRole('alert').filter((el) => el.textContent.includes(text));

const renderPage = () => renderWithProviders(<SnackbarProvider><UserPage /></SnackbarProvider>, { state: baseState });

const openJoin = async () => {
  renderPage();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));
  await userEvent.click(heroButton('Join League'));
  return screen.findByRole('dialog');
};

const codeField = () => screen.getByLabelText(/invite code/i);
const teamField = () => screen.getByLabelText(/team name/i);

afterEach(() => {
  jest.clearAllMocks();
});

// --- Preview ---

test('a valid code shows the league preview before the Team name field and names the league on the Join button', async () => {
  mockApi({ preview: previewBody() });
  const dialog = await openJoin();

  await userEvent.type(codeField(), 'abcd1234');

  const card = await within(dialog).findByTestId('join-preview');
  expect(within(card).getByText('Lakeshore Dynasty')).toBeInTheDocument();
  expect(within(card).getByText('Fantasy · Half PPR')).toBeInTheDocument();
  expect(within(card).getByText('8 of 12 seats taken')).toBeInTheDocument();
  expect(within(card).getByText('Draft Oct 11')).toBeInTheDocument();
  expect(within(card).getByText('Run by Tundra Kings')).toBeInTheDocument();
  // The preview sits between the code and the Team name, so the manager sees
  // what they are joining before naming a team in it.
  // eslint-disable-next-line no-bitwise
  expect(card.compareDocumentPosition(teamField()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  expect(previewCalls().map(([url]) => url)).toEqual([`${PREVIEW_PREFIX}abcd1234`]);
  expect(within(dialog).getByRole('button', { name: 'Join Lakeshore Dynasty' })).toBeInTheDocument();
});

test('the code is stored as typed and shown upper-cased', async () => {
  mockApi({ preview: previewBody() });
  await openJoin();

  await userEvent.type(codeField(), 'abcd1234');

  expect(codeField()).toHaveValue('abcd1234');
  expect(codeField()).toHaveStyle({ textTransform: 'uppercase' });
});

test('a short code asks the manager to keep typing and previews nothing', async () => {
  mockApi({ preview: previewBody() });
  const dialog = await openJoin();

  await userEvent.type(codeField(), 'abc');

  expect(within(dialog).getByText(/keep typing/i)).toBeInTheDocument();
  // Longer than the 300ms debounce: still no lookup for a partial code.
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 400); }); });
  expect(previewCalls()).toHaveLength(0);
});

test('a pasted invite link is read for its code, previewed and joined with that code', async () => {
  mockApi({ preview: previewBody() });
  apiClient.post.mockResolvedValue({});
  const dialog = await openJoin();

  await userEvent.click(codeField());
  await userEvent.paste('https://endzoneempire.com/#/league/join?code=abcd1234');

  expect(await within(dialog).findByTestId('join-preview')).toBeInTheDocument();
  expect(previewCalls().map(([url]) => url)).toEqual([`${PREVIEW_PREFIX}abcd1234`]);

  await userEvent.type(teamField(), 'Joiner FC');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Join Lakeshore Dynasty' }));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/join', { inviteCode: 'abcd1234', teamName: 'Joiner FC' }));
});

test('an unknown code says no league uses it, without blocking the Join button', async () => {
  mockApi({ preview: notFound });
  const dialog = await openJoin();

  await userEvent.type(codeField(), 'deadbeef');
  await userEvent.type(teamField(), 'Joiner FC');

  expect(await within(dialog).findByText('No league uses that code')).toBeInTheDocument();
  expect(codeField()).toHaveAttribute('aria-invalid', 'true');
  expect(within(dialog).queryByTestId('join-preview')).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Join league' })).toBeEnabled();
});

test('a league that is closed to joining says why and disables Join', async () => {
  mockApi({ preview: previewBody({ joinable: false, joinReason: 'draft-started' }) });
  const dialog = await openJoin();

  await userEvent.type(codeField(), 'abcd1234');
  await userEvent.type(teamField(), 'Joiner FC');

  const reason = 'The draft has already started · joining is closed.';
  const card = await within(dialog).findByTestId('join-preview');
  expect(within(card).getByText(reason)).toBeInTheDocument();
  const join = within(dialog).getByRole('button', { name: 'Join Lakeshore Dynasty' });
  expect(join).toBeDisabled();
  expect(join).toHaveAccessibleDescription(reason);
});

test('a league the manager already belongs to says so and disables Join', async () => {
  mockApi({ preview: previewBody({ alreadyMember: true }) });
  const dialog = await openJoin();

  await userEvent.type(codeField(), 'abcd1234');
  await userEvent.type(teamField(), 'Joiner FC');

  const card = await within(dialog).findByTestId('join-preview');
  expect(within(card).getByText("You're already a member of this league.")).toBeInTheDocument();
  const join = within(dialog).getByRole('button', { name: 'Join Lakeshore Dynasty' });
  expect(join).toBeDisabled();
  expect(join).toHaveAccessibleDescription("You're already a member of this league.");
});

// --- Slice 1 behaviors, kept ---

test('Invite code and Team name are required and a disabled Join says what is missing', async () => {
  mockApi();
  const dialog = await openJoin();

  expect(codeField()).toBeRequired();
  expect(teamField()).toBeRequired();
  const join = within(dialog).getByRole('button', { name: 'Join league' });
  expect(join).toBeDisabled();
  expect(join).toHaveAccessibleDescription('Add the invite code and your Team name to continue.');

  await userEvent.type(codeField(), 'x');
  expect(join).toBeDisabled();
  await userEvent.type(teamField(), 'y');
  expect(join).toBeEnabled();
});

test('joining posts the trimmed code and Team name, is announced once, closes and refetches leagues', async () => {
  mockApi({ preview: previewBody() });
  apiClient.post.mockResolvedValue({});
  const dialog = await openJoin();
  expect(getCallsTo('/api/league')).toBe(1); // opening the dialog fetches no league list

  await userEvent.type(codeField(), '  abcd1234  ');
  await userEvent.type(teamField(), '  Joiner FC ');
  await within(dialog).findByTestId('join-preview');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Join Lakeshore Dynasty' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/join', { inviteCode: 'abcd1234', teamName: 'Joiner FC' })
  );
  expect(await screen.findByText('Joined league!')).toBeInTheDocument();
  expect(screen.getAllByText('Joined league!')).toHaveLength(1);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(2));
});

test('a failed join keeps the dialog open with the answers and shows the error once, inside it', async () => {
  mockApi();
  apiClient.post.mockRejectedValue({ response: { data: { error: 'no league with that invite code' } } });
  const dialog = await openJoin();

  await userEvent.type(codeField(), 'bogus');
  await userEvent.type(teamField(), 'Joiner FC');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Join league' }));

  expect(await within(dialog).findByText('no league with that invite code')).toBeInTheDocument();
  expect(alertsWithText('no league with that invite code')).toHaveLength(1);
  expect(codeField()).toHaveValue('bogus');
  expect(teamField()).toHaveValue('Joiner FC');
});

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('Join cannot be sent twice while the first request is in flight', async () => {
  mockApi();
  const pending = deferred();
  apiClient.post.mockReturnValue(pending.promise);
  const dialog = await openJoin();

  await userEvent.type(codeField(), 'abc123');
  await userEvent.type(teamField(), 'Joiner FC');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Join league' }));

  const busy = screen.getByRole('button', { name: 'Joining…' });
  expect(busy).toBeDisabled();
  fireEvent.click(busy); // a forced second submit (e.g. key repeat) still must not post
  expect(apiClient.post).toHaveBeenCalledTimes(1);

  pending.resolve({});
  expect(await screen.findByText('Joined league!')).toBeInTheDocument();
});
