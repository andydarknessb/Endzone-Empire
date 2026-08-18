import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LeagueManagement from './LeagueManagement';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  draft_status: 'pending',
  owner_id: 1,
  my_team_name: "alice's Team",
  ...overrides,
});

const openNewLeague = () => userEvent.click(screen.getByRole('button', { name: 'New league' }));

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
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Monday Mayhem',
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
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Plain League',
      maxTeams: 10,
      minTeams: 8,
      leagueType: 'fantasy',
    })
  );
});

test('creating a public, approval-required, best-ball, PPR league with a draft date sends all the fields', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { invite_code: 'abc123' } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();

  await userEvent.type(screen.getByLabelText(/League name/), 'Full Featured League');
  await userEvent.click(screen.getByRole('button', { name: /advanced settings/i }));
  await userEvent.click(screen.getByLabelText('Public league'));
  await userEvent.click(screen.getByLabelText('Require commissioner approval to join'));
  await userEvent.click(screen.getByLabelText('Best ball mode'));
  await userEvent.click(screen.getByLabelText('Scoring'));
  await userEvent.click(await screen.findByRole('option', { name: 'PPR' }));
  await userEvent.type(screen.getByLabelText('Draft date'), '2026-09-04T13:00');
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Full Featured League',
      maxTeams: 10,
      minTeams: 8,
      leagueType: 'fantasy',
      isPublic: true,
      joinApproval: true,
      bestBall: true,
      scoringPreset: 'ppr',
      draftDate: new Date('2026-09-04T13:00').toISOString(),
    })
  );
});

test('joining a league posts the trimmed invite code', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({});

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await openNewLeague();

  await userEvent.click(screen.getByRole('tab', { name: 'Join League' }));
  await userEvent.type(screen.getByLabelText(/Invite code/), '  xyz789  ');
  await userEvent.click(screen.getByRole('button', { name: 'Join League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/join', { inviteCode: 'xyz789' })
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
  // Fantasy-only state set BEFORE the switch must not leak into the payload.
  await userEvent.type(screen.getByLabelText('Draft date'), '2026-09-04T13:00');
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

const previewFor = (overrides = {}) => ({
  id: 7, name: "Office Pick'em", maxTeams: 12, teamCount: 3, scoringPreset: null, bestBall: false,
  pickemOnly: true, pickemEnabled: true, joinApproval: false, draftDate: null, alreadyMember: false,
  myRequestStatus: null, isPublic: false, ownerUsername: 'alice', openSlots: true, joinable: true, joinReason: null,
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
  expect(screen.getByText(/run by alice/i)).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/preview?code=e402e816');
  expect(screen.getByRole('button', { name: 'Join League' })).toBeEnabled();
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
  await userEvent.click(screen.getByRole('button', { name: 'Join League' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/join', { inviteCode: 'deadbeef' })
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
