import React, { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import configureMockStore from 'redux-mock-store';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import NavigationGuard, { useUnsavedChangesGuard } from './NavigationGuard';
import { clearLeagueCache } from '../../hooks/useLeague';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import apiClient from '../../api/apiClient';
import DraftSettings from '../DraftSettings/DraftSettings';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

// These specs drive the real browser history (window.history.go) under a real
// HashRouter — genuine POP traversal, not a synthetic PopStateEvent + go spy —
// so they exercise the async gap between issuing a restoration and its POP
// landing, which is exactly what the guard has to bridge.

// Real-timer flush — used only by the DraftSettings integration test below.
const flush = async (times = 6) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
};

// Fake-timer pump: advances exactly ONE jsdom history-traversal hop per
// iteration. jsdom delivers each history.go() as two chained setTimeout(0)
// tasks, and jest.runOnlyPendingTimers fires only timers pending at call time
// — a hop queued during the run waits for the next pump. That one-hop-per-pump
// control is what makes the guard's transient restorationPending window
// observable deterministically (runAllTimers would drain the whole chain and
// close the window before it could be asserted).
const pump = async (times = 1) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { jest.runOnlyPendingTimers(); });
  }
};

// Only used inside the fake-timer describe below.
const clickText = async (name) => {
  await act(async () => { screen.getByText(name).click(); });
  await pump(1);
};
const pressBack = async () => { await act(async () => { window.history.go(-1); }); };

function Editor() {
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);
  return (
    <div>
      <p>Editor page</p>
      <button type="button" onClick={() => setDirty(true)}>Make dirty</button>
      <button type="button" onClick={() => setDirty(false)}>Mark saved</button>
    </div>
  );
}
function Page({ label, to }) {
  const navigate = useNavigate();
  return (
    <div>
      <p>{label}</p>
      {to && <button type="button" onClick={() => navigate(to)}>{`Go ${to}`}</button>}
    </div>
  );
}

function renderGuardedApp() {
  window.history.replaceState(null, '', '/');
  return render(
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <NavigationGuard>
        <Routes>
          <Route path="/" element={<Page label="Home page" to="/step" />} />
          <Route path="/step" element={<Page label="Step page" to="/editor" />} />
          <Route path="/editor" element={<Editor />} />
        </Routes>
      </NavigationGuard>
    </HashRouter>
  );
}

afterEach(() => { window.history.replaceState(null, '', '/'); });

// Fake timers make the POP traversal dance deterministic: jsdom schedules
// every history.go() hop through window.setTimeout, so pump() steps the
// traversal state machine one hop at a time instead of guessing how many
// real event-loop turns it needs (the old approach, which flaked on slow
// CI runners when hops collapsed into a single timer drain).
describe('guarded POP traversal (deterministic fake timers)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(async () => {
    // Drain in-flight traversal chains so a stale popstate can't fire into
    // the next test or hold the jest worker open at exit.
    await act(async () => { jest.runAllTimers(); });
    jest.useRealTimers();
  });

  test('Keep editing after a restored back press leaves later navigation working', async () => {
    renderGuardedApp();
    await clickText('Go /step');
    await clickText('Go /editor');
    await clickText('Make dirty');

    // Hop A queues the traversal; hop B fires popstate -> the guard blocks,
    // restores, and raises the confirmation.
    await pressBack();
    await pump(2);

    expect(screen.getByText('Editor page')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: /You have unsaved changes/ });
    await act(async () => { within(dialog).getByRole('button', { name: 'Keep editing' }).click(); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Editor page')).toBeInTheDocument();

    // Land the restoration traversal that was still in flight when the
    // dialog was dismissed, so the next phase starts from a settled history.
    await pump(2);

    // A later navigation still works: mark the edit saved, then back reaches Step.
    await clickText('Mark saved');
    await pressBack();
    await pump(2);
    expect(screen.getByText('Step page')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('Discard after a restored back press reaches exactly the attempted destination', async () => {
    renderGuardedApp();
    await clickText('Go /step');
    await clickText('Go /editor');
    await clickText('Make dirty');

    await pressBack(); // queues hop A
    // A fires (queues B); B fires popstate -> guard blocks: dialog opens,
    // restorationPending=true, and the restoring go() queues hop C.
    await pump(2);

    // While the restoration POP is still in flight, Discard is disabled so the
    // replayed traversal cannot fire against the wrong history position.
    const discard = screen.getByRole('button', { name: 'Discard changes' });
    expect(discard).toBeDisabled();

    // C fires (queues D); D fires the restoration popstate -> pending clears.
    await pump(2);
    expect(discard).toBeEnabled();

    await act(async () => { discard.click(); }); // replay go() queues hop E
    await pump(2); // E -> F: popstate lands the replayed traversal on Step
    // Exactly one step back — the Step page the user aimed at, not Home.
    expect(screen.getByText('Step page')).toBeInTheDocument();
    expect(screen.queryByText('Editor page')).not.toBeInTheDocument();
  });

  test('rapid repeated back presses during restoration are coalesced without skipping entries', async () => {
    renderGuardedApp();
    await clickText('Go /step');
    await clickText('Go /editor');
    await clickText('Make dirty');

    // Two Back presses before the restoration settles. The coalescing
    // bounce-back adds extra hops per press, so don't hop-count here —
    // waitFor auto-advances the fake timers until the guard settles, and
    // doubles as the enabled-guard so the click can't be swallowed by a
    // still-disabled button.
    await act(async () => { window.history.go(-1); window.history.go(-1); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Discard changes' })).toBeEnabled());

    // Guard held us on the editor and raised a single confirmation.
    expect(screen.getByText('Editor page')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    await act(async () => { screen.getByRole('button', { name: 'Discard changes' }).click(); });
    // Only the first attempted step is honored: Step, not Home (no skipped entry).
    await screen.findByText('Step page');
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  });
});

// ---- Scenario 4: pending Keeper assignment edits use the same browser-back guard ----

const leagueResponse = () => ({
  data: {
    league: {
      id: 1, name: 'Sunday Ballers', owner_id: 1, draft_status: 'pending', draft_type: 'snake',
      draft_rotation: 'snake', min_teams: 2, roster_limit: 4,
      roster_slots: [{ key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] }],
      bench_slots: 1, ir_slots: 0, position_caps: {}, pick_time_seconds: 60, autodraft_delay_seconds: 10,
      keepers_enabled: true, keeper_count: 2, keeper_lock_at: null,
    },
    teams: [
      { id: 1, name: "Alice's Team", owner: 'alice', draft_position: 1, faab_remaining: 100, locked: false, draft_ready: true, roster_count: 0, total_points: '0' },
      { id: 2, name: "Bob's Team", owner: 'bob', draft_position: 2, faab_remaining: 100, locked: false, draft_ready: false, roster_count: 0, total_points: '0' },
    ],
  },
});

function renderDraftSettingsApp() {
  const response = leagueResponse();
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1') return Promise.resolve(response);
    if (url === '/api/draft/league/1/keepers') {
      return Promise.resolve({ data: [{ team_id: 1, player_id: 101, name: 'Player One', position: 'QB', draft_round: 1 }] });
    }
    if (url === '/api/draft/league/1/keeper-candidates') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  const store = configureMockStore([])({ user: { id: 1, username: 'alice' }, errors: { loginMessage: '', registrationMessage: '' } });
  window.history.replaceState(null, '', '/');
  return render(
    <Provider store={store}>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NavigationGuard>
          <SnackbarProvider>
            <Routes>
              <Route path="/" element={<Page label="Home page" to="/league/1/draft-settings" />} />
              <Route path="/league/:leagueId/draft-settings" element={<DraftSettings />} />
            </Routes>
          </SnackbarProvider>
        </NavigationGuard>
      </HashRouter>
    </Provider>
  );
}

test('pending keeper assignment edits participate in the browser-back guard', async () => {
  clearLeagueCache();
  renderDraftSettingsApp();

  await act(async () => { screen.getByText('Go /league/1/draft-settings').click(); });
  await screen.findByText('Sunday Ballers');
  await userEvent.click(screen.getByRole('tab', { name: 'Keepers' }));
  await screen.findByRole('checkbox', { name: 'Enable keepers' });
  // Removing the loaded keeper is an assignment edit — marks assignments dirty.
  await userEvent.click(await screen.findByRole('button', { name: 'Remove keeper' }));

  await pressBack();
  await flush(6);
  expect(await screen.findByRole('dialog', { name: /You have unsaved changes/ })).toBeInTheDocument();

  await waitFor(() => expect(screen.getByRole('button', { name: 'Discard changes' })).toBeEnabled());
  await act(async () => { screen.getByRole('button', { name: 'Discard changes' }).click(); });
  await flush(6);
  expect(await screen.findByText('Home page')).toBeInTheDocument();
  expect(screen.queryByText('Sunday Ballers')).not.toBeInTheDocument();
  clearLeagueCache();
});
