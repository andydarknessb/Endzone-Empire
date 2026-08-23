import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LeagueManagement from './LeagueManagement';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

// The real list is every IANA zone Intl knows (400+): rendering and querying
// that many options in the Draft time zone Autocomplete is what made the
// "sends all the fields" test slow (issue #149). Only that one test opens
// this picker; DraftScheduleField.test.jsx already covers the real full
// list, including selecting America/New_York from it, so trimming it here
// costs no coverage.
jest.mock('../../lib/draftTimezone', () => ({
  ...jest.requireActual('../../lib/draftTimezone'),
  listIanaTimeZones: () => ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'UTC'],
}));

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  draft_status: 'pending',
  owner_id: 1,
  my_team_name: "alice's Team",
  ...overrides,
});

// Accepts an optional userEvent instance so a caller with its own setup()
// (e.g. a fake-timers session) can reuse this instead of re-inlining it.
const openNewLeague = (user = userEvent) => user.click(screen.getByRole('button', { name: 'New league' }));

afterEach(() => {
  jest.clearAllMocks();
});

test('fetches and renders the user\'s leagues on mount', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league');
});

test('pre-fills the invite code from a ?code= deep link and focuses Join', async () => {
  apiClient.get.mockResolvedValue({ data: [] });

  renderWithProviders(<LeagueManagement />, {
    state: { user: { id: 1 } },
    path: '/league/join',
    route: '/league/join?code=ABC123',
  });

  await waitFor(() =>
    expect(screen.getByLabelText(/invite code/i)).toHaveValue('ABC123')
  );
  expect(screen.getByRole('button', { name: 'Join League' })).toHaveFocus();
});

test('shows a friendly message when the user has no leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });

  expect(await screen.findByText(/you aren't in any leagues yet/i)).toBeInTheDocument();
});

test('shows an error alert when fetching leagues fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'server exploded' } } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });

  expect(await screen.findByText('server exploded')).toBeInTheDocument();
});

test('the Delete action only appears for leagues the user owns', async () => {
  apiClient.get.mockResolvedValue({
    data: [league({ id: 1, name: 'Mine', owner_id: 1 }), league({ id: 2, name: 'Not Mine', owner_id: 99 })],
  });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });

  await screen.findByText('Mine');
  // Only the owned league's card renders the "..." actions menu at all.
  const menuTriggers = screen.getAllByRole('button', { name: 'League actions' });
  expect(menuTriggers).toHaveLength(1);

  await userEvent.click(menuTriggers[0]);
  expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
});

test('creating a league posts the form data and shows the returned invite code', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { invite_code: 'abc123' } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();

  await userEvent.type(screen.getByLabelText(/League name/), 'Monday Mayhem');
  await userEvent.type(screen.getByLabelText(/Team name/), 'Monday Mavericks');
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Monday Mayhem',
      teamName: 'Monday Mavericks',
      maxTeams: 10,
      minTeams: 8,
      leagueType: 'fantasy',
    })
  );
  expect(await screen.findByText(/Invite code: abc123/)).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(3); // Draft Central + initial fetch + refetch after create
});

test('creating a league surfaces the server error on failure', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'name already taken' } } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();

  await userEvent.type(screen.getByLabelText(/League name/), 'Dup League');
  await userEvent.type(screen.getByLabelText(/Team name/), 'Dup Squad');
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  expect(await screen.findByText('name already taken')).toBeInTheDocument();
});

test('the "Require commissioner approval" toggle only appears once "Public league" is on', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();
  await userEvent.click(screen.getByRole('button', { name: /advanced settings/i }));

  expect(screen.queryByLabelText('Require commissioner approval to join')).not.toBeInTheDocument();

  await userEvent.click(screen.getByLabelText('Public league'));
  expect(screen.getByLabelText('Require commissioner approval to join')).toBeInTheDocument();
});

test('the best-ball helper text only appears once "Best ball mode" is on', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();
  await userEvent.click(screen.getByRole('button', { name: /advanced settings/i }));

  expect(screen.queryByText(/optimal lineup is set automatically/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByLabelText('Best ball mode'));
  expect(screen.getByText(/optimal lineup is set automatically/i)).toBeInTheDocument();
});

test('creating a league only sends the new optional fields the user actually set', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { invite_code: 'abc123' } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();

  await userEvent.type(screen.getByLabelText(/League name/), 'Plain League');
  await userEvent.type(screen.getByLabelText(/Team name/), 'Plain Squad');
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Plain League',
      teamName: 'Plain Squad',
      maxTeams: 10,
      minTeams: 8,
      leagueType: 'fantasy',
    })
  );
});

test('creating a public, approval-required, best-ball, PPR league with a draft date sends all the fields', async () => {
  // This is the heaviest interaction in the file (a dozen-plus MUI
  // controls, including the Draft time zone Autocomplete), which made it
  // exceed 15s under parallel worker load (#149) even though it only takes
  // ~1-2s alone. Fake timers keep MUI's ripple/transition timeouts from
  // costing real wall-clock time; pointerEventsCheck skips a getComputedStyle
  // walk up the ancestor chain on every click. Restored in `finally`
  // regardless of outcome. See listIanaTimeZones mock above for why the
  // zone picker itself is cheap here.
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { invite_code: 'abc123' } });

  // Mount happens on REAL timers, before the fake-timer window opens.
  // Rendering inside that window left the mount fetch's setLeagues landing
  // outside act (measured: one warning per run, #169). Note this findByText
  // does not itself gate on the fetch - `leagues` starts [] so the empty
  // state is in the first synchronous render - it is the awaited boundary
  // that lets the fetch settle before the fake window opens.
  // Nothing here needs faking; the transitions #149 added it for all start
  // at the first interaction below.
  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);

  jest.useFakeTimers();
  try {
    const user = userEvent.setup({
      delay: null,
      advanceTimers: jest.advanceTimersByTime,
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    });
    await openNewLeague(user);

    // Typing semantics (per-keystroke state) aren't under test here, only
    // the posted value, so a single change event stands in for real
    // keystrokes on both name fields.
    fireEvent.change(screen.getByLabelText(/League name/), { target: { value: 'Full Featured League' } });
    fireEvent.change(screen.getByLabelText(/Team name/), { target: { value: 'Full Featured Squad' } });
    // These are plain click-to-toggle native inputs (MUI Switch/Checkbox) or
    // a button whose handler only cares about the click, not pointer
    // semantics like hover/press timing, so fireEvent.click stands in for
    // userEvent's full hover+pointerdown+pointerup+click sequence.
    fireEvent.click(screen.getByRole('button', { name: /advanced settings/i }));
    fireEvent.click(screen.getByLabelText('Public league'));
    fireEvent.click(screen.getByLabelText('Require commissioner approval to join'));
    fireEvent.click(screen.getByLabelText('Best ball mode'));
    await user.click(screen.getByLabelText('Scoring'));
    await user.click(await screen.findByRole('option', { name: 'PPR' }));
    fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '2026-09-04T13:00' } });
    // #116 AC3: a scheduled draft's zone requires explicit acknowledgement
    // before Create League is enabled.
    expect(screen.getByRole('button', { name: 'Create League' })).toBeDisabled();
    await user.click(screen.getByLabelText('Draft time zone'));
    await user.click(await screen.findByRole('option', { name: 'America/New_York' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm this draft date and time/i }));
    // Submit is the one click here that must be awaited rather than fired.
    // `fireEvent` wraps its dispatch in a SYNCHRONOUS act, which returns
    // before the awaited apiClient.post resolves, leaving createLeague's
    // success path (the notice, the field resets, the refetch) to land
    // outside the interaction that caused it. Measured on the deduped tree:
    // 15 warnings per run from those updates, 0 once the click is awaited
    // (#169). Awaiting settles that path inside the interaction rather than
    // racing the assertions after it.
    await user.click(screen.getByRole('button', { name: 'Create League' }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
        name: 'Full Featured League',
        teamName: 'Full Featured Squad',
        maxTeams: 10,
        minTeams: 8,
        leagueType: 'fantasy',
        isPublic: true,
        joinApproval: true,
        bestBall: true,
        scoringPreset: 'ppr',
        // #116 AC4: 1pm in the selected zone (America/New_York, EDT/UTC-4 in
        // September), not the test runner's own zone.
        draftDate: '2026-09-04T17:00:00.000Z',
        draftTimezone: 'America/New_York',
      })
    );
    // `waitFor` above is satisfied the moment post is CALLED, so on its own it
    // says nothing about what the component did with the answer. Assert the
    // visible outcome too, as the sibling create test does.
    expect(await screen.findByText(/Invite code: abc123/)).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

test('joining a league posts the trimmed invite code', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({});

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();

  await userEvent.click(screen.getByRole('tab', { name: 'Join League' }));
  await userEvent.type(screen.getByLabelText(/Invite code/), '  xyz789  ');
  await userEvent.type(screen.getByLabelText(/Team name/), 'Joiner FC');
  await userEvent.click(screen.getByRole('button', { name: 'Join League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/join', { inviteCode: 'xyz789', teamName: 'Joiner FC' })
  );
  expect(await screen.findByText('Joined league!')).toBeInTheDocument();
});

test('deleting a league calls the delete endpoint and refetches', async () => {
  apiClient.get.mockResolvedValue({ data: [league({ id: 7, owner_id: 1 })] });
  apiClient.delete.mockResolvedValue({});

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'League actions' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete League' }));

  await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/api/league/7'));
  expect(apiClient.get).toHaveBeenCalledTimes(3);
});

test('canceling the delete confirmation dialog leaves the league intact', async () => {
  apiClient.get.mockResolvedValue({ data: [league({ id: 7, owner_id: 1 })] });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'League actions' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(await screen.findByRole('heading', { name: /delete sunday ballers\?/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: /delete sunday ballers\?/i })).not.toBeInTheDocument()
  );
  expect(apiClient.delete).not.toHaveBeenCalled();
  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();
});

test('renders Dashboard/Draft Room/Matchups links pointing at the correct league id', async () => {
  apiClient.get.mockResolvedValue({ data: [league({ id: 42 })] });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/league/42');
  expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('href', '/league/42/draft');
  expect(screen.getByRole('link', { name: 'Game Center' })).toHaveAttribute('href', '/league/42/game-center');
});

// --- League type at creation ---

test("creating an NFL pick'em league hides the fantasy fields and sends leagueType, pickemMode and an explicit maxTeams only", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { invite_code: 'pool99' } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();

  expect(screen.getByRole('radio', { name: /Fantasy football league/ })).toBeChecked();
  await userEvent.type(screen.getByLabelText(/League name/), 'Office Pool');
  await userEvent.type(screen.getByLabelText(/Team name/), 'Office Champs');
  // Fantasy-only state set BEFORE the switch must not leak into the payload.
  fireEvent.change(screen.getByLabelText('Draft date'), { target: { value: '2026-09-04T13:00' } });
  await userEvent.click(screen.getByRole('radio', { name: /NFL pick'em league/ }));

  expect(screen.queryByLabelText('Scoring')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Draft date')).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Straight up/ })).toBeChecked();

  await userEvent.click(screen.getByRole('button', { name: /advanced settings/i }));
  expect(screen.queryByLabelText(/Min teams/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Best ball mode')).not.toBeInTheDocument();
  const maxTeams = screen.getByLabelText('Max teams');
  expect(maxTeams).toHaveAttribute('max', '50');
  await userEvent.clear(maxTeams);
  await userEvent.type(maxTeams, '40');

  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Office Pool',
      teamName: 'Office Champs',
      maxTeams: 40,
      leagueType: 'pickem',
      pickemMode: 'straight',
    })
  );
  expect(await screen.findByText(/Invite code: pool99/)).toBeInTheDocument();
});

test("choosing Both keeps the fantasy fields, caps teams at 20, and sends the chosen confidence mode", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { invite_code: 'abc123' } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();

  await userEvent.type(screen.getByLabelText(/League name/), 'Everything League');
  await userEvent.type(screen.getByLabelText(/Team name/), 'Everything Squad');
  await userEvent.click(screen.getByRole('radio', { name: /^Both/ }));
  await userEvent.click(screen.getByRole('radio', { name: /Confidence/ }));
  expect(screen.getByLabelText('Scoring')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /advanced settings/i }));
  expect(screen.getByLabelText(/Min teams/)).toBeInTheDocument();
  expect(screen.getByLabelText('Max teams')).toHaveAttribute('max', '20');
  await userEvent.click(screen.getByLabelText('Best ball mode'));

  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Everything League',
      teamName: 'Everything Squad',
      maxTeams: 10,
      minTeams: 8,
      leagueType: 'both',
      pickemMode: 'confidence',
      bestBall: true,
    })
  );
});

test("switching back from pick'em keeps min teams inside the re-capped max", async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { invite_code: 'abc123' } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();

  await userEvent.type(screen.getByLabelText(/League name/), 'Small League');
  await userEvent.type(screen.getByLabelText(/Team name/), 'Small Squad');
  await userEvent.click(screen.getByRole('radio', { name: /NFL pick'em league/ }));
  await userEvent.click(screen.getByRole('button', { name: /advanced settings/i }));
  const maxTeams = screen.getByLabelText('Max teams');
  await userEvent.clear(maxTeams);
  await userEvent.type(maxTeams, '3');
  // Min teams was hidden while the type was pick'em; the switch back must not
  // leave the (still hidden until now) default of 8 above the max of 3.
  await userEvent.click(screen.getByRole('radio', { name: /^Both/ }));
  expect(screen.getByLabelText(/Min teams/)).toHaveValue(3);
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Small League',
      teamName: 'Small Squad',
      maxTeams: 3,
      minTeams: 3,
      leagueType: 'both',
      pickemMode: 'straight',
    })
  );
});

test('an empty or out-of-range team count blocks Create League with a visible reason instead of a silent submit', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();

  await userEvent.type(screen.getByLabelText(/League name/), 'Office Pool');
  await userEvent.click(screen.getByRole('radio', { name: /NFL pick'em league/ }));
  await userEvent.click(screen.getByRole('button', { name: /advanced settings/i }));
  const maxTeams = screen.getByLabelText('Max teams');
  await userEvent.clear(maxTeams);
  // Switching type must not quietly invent a count for an empty field.
  await userEvent.click(screen.getByRole('radio', { name: /^Both/ }));
  expect(screen.getByLabelText('Max teams')).toHaveValue(null);
  expect(screen.getByRole('button', { name: 'Create League' })).toBeDisabled();
  expect(screen.getByText(/team limits/i, { selector: 'p, span' })).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Max teams'), '60');
  expect(screen.getByRole('button', { name: 'Create League' })).toBeDisabled();
  await userEvent.clear(screen.getByLabelText('Max teams'));
  await userEvent.type(screen.getByLabelText('Max teams'), '12');
  expect(screen.getByRole('button', { name: 'Create League' })).toBeEnabled();
  expect(apiClient.post).not.toHaveBeenCalled();
});

// `ownerUsername` is still on the wire (#115 removes it) and the preview card
// must never render it: the viewer holding an invite code is by definition not
// a member, so the commissioner is named by their Team (#181).
const previewFor = (overrides = {}) => ({
  id: 7, name: "Office Pick'em", maxTeams: 12, teamCount: 3, scoringPreset: null, bestBall: false,
  pickemOnly: true, pickemEnabled: true, joinApproval: false, draftDate: null, alreadyMember: false,
  myRequestStatus: null, isPublic: false, ownerUsername: 'alice', ownerTeamName: 'Gridiron Gang',
  openSlots: true, joinable: true, joinReason: null,
  ...overrides,
});

/** The list call answers with `leagues`; the preview call with `preview` (a value) or rejects (an Error). */
const mockGets = ({ leagues = [], preview }) => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/league/preview')) {
      return preview instanceof Error ? Promise.reject(preview) : Promise.resolve({ data: preview });
    }
    return Promise.resolve({ data: leagues });
  });
};

test("an invite deep link previews the league before joining: name, league type and seats", async () => {
  mockGets({ preview: previewFor() });

  renderWithProviders(<LeagueManagement />, {
    state: { user: { id: 1 } },
    path: '/league/join',
    route: '/league/join?code=e402e816',
  });

  expect(await screen.findByText("Office Pick'em")).toBeInTheDocument();
  expect(screen.getByText("Pick'em")).toBeInTheDocument();
  expect(screen.getByText(/3\/12 teams/)).toBeInTheDocument();
  expect(screen.getByText(/run by Gridiron Gang/i)).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/preview?code=e402e816');
  expect(screen.getByRole('button', { name: 'Join League' })).toBeEnabled();
});

test("the preview names the commissioner by Team, never by the account name still on the wire", async () => {
  mockGets({ preview: previewFor() });

  renderWithProviders(<LeagueManagement />, {
    state: { user: { id: 1 } },
    path: '/league/join',
    route: '/league/join?code=e402e816',
  });

  const card = await screen.findByTestId('invite-preview');
  expect(card).toHaveTextContent('run by Gridiron Gang');
  // The payload still carries ownerUsername until #115 drops it. Nothing may
  // render it, and there is no fallback to it anywhere in the card.
  expect(card).not.toHaveTextContent(/alice\b/i);
});

test("a commissioner with no Team row shows the seat count alone, and still no account name", async () => {
  mockGets({ preview: previewFor({ ownerTeamName: null }) });

  renderWithProviders(<LeagueManagement />, {
    state: { user: { id: 1 } },
    path: '/league/join',
    route: '/league/join?code=e402e816',
  });

  const card = await screen.findByTestId('invite-preview');
  expect(card).toHaveTextContent('3/12 teams');
  // No dangling "run by", no middot with nothing after it, and above all no
  // fallback to the username: a missing Team name drops the clause entirely.
  expect(card).not.toHaveTextContent(/run by/i);
  expect(card).not.toHaveTextContent(/alice\b/i);
  expect(card).not.toHaveTextContent(/teams\s*·/);
});

test('a failed preview (unknown code) shows no card and leaves Join usable', async () => {
  const notFound = Object.assign(new Error('Request failed with status code 404'), {
    response: { status: 404, data: { error: 'no league with that invite code' } },
  });
  mockGets({ preview: notFound });
  apiClient.post.mockResolvedValue({});

  renderWithProviders(<LeagueManagement />, {
    state: { user: { id: 1 } },
    path: '/league/join',
    route: '/league/join?code=deadbeef',
  });

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/preview?code=deadbeef'));
  expect(screen.queryByTestId('invite-preview')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(/Team name/), 'Late Entry');
  await userEvent.click(screen.getByRole('button', { name: 'Join League' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/join', { inviteCode: 'deadbeef', teamName: 'Late Entry' })
  );
});

test('typing a code previews it once it is long enough', async () => {
  mockGets({ preview: previewFor({ name: 'Sunday Ballers', pickemOnly: false, pickemEnabled: false, scoringPreset: 'ppr' }) });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();
  await userEvent.click(screen.getByRole('tab', { name: 'Join League' }));
  await userEvent.type(screen.getByLabelText(/Invite code/), 'abc12');
  expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/league/preview'));

  await userEvent.type(screen.getByLabelText(/Invite code/), '3');
  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText('PPR')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/preview?code=abc123');
});

test('a preview answer that is not a league (an empty body) renders no card', async () => {
  mockGets({ preview: [] });

  renderWithProviders(<LeagueManagement />, {
    state: { user: { id: 1 } },
    path: '/league/join',
    route: '/league/join?code=abc1234',
  });

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/preview?code=abc1234'));
  // Let the debounce and the resolved fetch settle before asserting absence.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByTestId('invite-preview')).not.toBeInTheDocument();
});

// The closed-joining note is keyed on the preview's joinReason (the server's
// joinability answer), never on a draft status: a pick'em-only pool has no draft.
test('a league whose draft has started previews with a closed-joining note', async () => {
  mockGets({ preview: previewFor({ name: 'Late Joiners', pickemOnly: false, pickemEnabled: false, scoringPreset: 'standard', joinable: false, joinReason: 'draft-started' }) });

  renderWithProviders(<LeagueManagement />, {
    state: { user: { id: 1 } },
    path: '/league/join',
    route: '/league/join?code=e402e816',
  });

  expect(await screen.findByText('Late Joiners')).toBeInTheDocument();
  expect(screen.getByText(/the draft has already started/i)).toBeInTheDocument();
});

test("a completed pick'em-only pool previews with a season-complete note, not a draft one", async () => {
  mockGets({ preview: previewFor({ name: 'Last Year\'s Pool', joinable: false, joinReason: 'season-complete' }) });

  renderWithProviders(<LeagueManagement />, {
    state: { user: { id: 1 } },
    path: '/league/join',
    route: '/league/join?code=e402e816',
  });

  expect(await screen.findByText("Last Year's Pool")).toBeInTheDocument();
  expect(screen.getByText(/the season is complete/i)).toBeInTheDocument();
  expect(screen.queryByText(/draft/i)).not.toBeInTheDocument();
});

test('a joinable preview carries no closed-joining note', async () => {
  mockGets({ preview: previewFor({ joinable: true, joinReason: null }) });

  renderWithProviders(<LeagueManagement />, {
    state: { user: { id: 1 } },
    path: '/league/join',
    route: '/league/join?code=e402e816',
  });

  expect(await screen.findByText("Office Pick'em")).toBeInTheDocument();
  expect(screen.queryByText(/joining is closed/i)).not.toBeInTheDocument();
});
