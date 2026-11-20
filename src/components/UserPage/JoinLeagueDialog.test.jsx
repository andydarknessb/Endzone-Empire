import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../api/apiClient';
import JoinLeagueDialog from './JoinLeagueDialog';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';

// The dialog on its own: what it looks up for a typed invite code and what the
// field says about the code's length. Leagues created before release #2859 have
// 8-character codes; leagues created since have 16.

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const PREVIEW_PREFIX = '/api/league/preview?code=';
const KEEP_TYPING = 'Keep typing. Invite codes are 8 or 16 letters and numbers.';
const TOO_LONG = "That's longer than an invite code. Invite codes are 8 or 16 letters and numbers.";
const CODE_16 = 'a1b2c3d4e5f6a7b8';

const previewBody = () => ({
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
});

const notFound = () => Promise.reject({ response: { status: 404, data: { error: 'no league with that invite code' } } });

const renderDialog = (preview = () => Promise.resolve({ data: previewBody() })) => {
  apiClient.get.mockImplementation((url) => (url.startsWith(PREVIEW_PREFIX) ? preview(url) : Promise.resolve({ data: [] })));
  render(<SnackbarProvider><JoinLeagueDialog open onClose={jest.fn()} onJoined={jest.fn()} /></SnackbarProvider>);
};

const previewCalls = () => apiClient.get.mock.calls.filter(([url]) => url.startsWith(PREVIEW_PREFIX));
const codeField = () => screen.getByLabelText(/invite code/i, { selector: 'input' });
const waitPastDebounce = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 400); }); });

afterEach(() => {
  jest.clearAllMocks();
});

test('a 16-character code is looked up once and shows its preview with no error state', async () => {
  renderDialog();

  await userEvent.type(codeField(), CODE_16);

  expect(await screen.findByTestId('join-preview')).toBeInTheDocument();
  expect(previewCalls().map(([url]) => url)).toEqual([`${PREVIEW_PREFIX}${CODE_16}`]);
  expect(codeField()).not.toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText(TOO_LONG)).not.toBeInTheDocument();
  expect(screen.queryByText(KEEP_TYPING)).not.toBeInTheDocument();
});

test('an 8-character code is still looked up and previewed', async () => {
  renderDialog();

  await userEvent.type(codeField(), CODE_16.slice(0, 8));

  expect(await screen.findByTestId('join-preview')).toBeInTheDocument();
  expect(previewCalls().map(([url]) => url)).toEqual([`${PREVIEW_PREFIX}${CODE_16.slice(0, 8)}`]);
});

test.each([9, 12, 15])('a %i-character code reads as still being typed: no lookup and not marked wrong', async (length) => {
  renderDialog();

  await userEvent.type(codeField(), CODE_16.slice(0, length));

  expect(screen.getByText(KEEP_TYPING)).toBeInTheDocument();
  expect(codeField()).toHaveAccessibleDescription(KEEP_TYPING);
  await waitPastDebounce();
  expect(previewCalls()).toHaveLength(0);
  expect(screen.queryByText(TOO_LONG)).not.toBeInTheDocument();
  expect(codeField()).not.toHaveAttribute('aria-invalid', 'true');
});

test('a 17-character code reads as too long and is never looked up', async () => {
  renderDialog();

  await userEvent.type(codeField(), `${CODE_16}c`);

  expect(screen.getByText(TOO_LONG)).toBeInTheDocument();
  expect(codeField()).toHaveAccessibleDescription(TOO_LONG);
  await waitPastDebounce();
  expect(previewCalls()).toHaveLength(0);
  expect(codeField()).toHaveAttribute('aria-invalid', 'true');
});

test('a not-found answer for the first 8 characters of a longer code clears on the next character', async () => {
  renderDialog(notFound);

  await userEvent.type(codeField(), CODE_16.slice(0, 8));
  expect(await screen.findByText('No league uses that code')).toBeInTheDocument();

  await userEvent.type(codeField(), CODE_16.slice(8, 9));
  expect(screen.queryByText('No league uses that code')).not.toBeInTheDocument();
});
