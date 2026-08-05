import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import publicApiClient from '../../api/publicApiClient';
import DraftSimulator from './DraftSimulator';
import { buildPool } from '../../lib/draftSim/simFixtures';
import { SIM_STORAGE_KEY } from '../../lib/draftSim/persistence';

jest.mock('../../api/publicApiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

beforeEach(() => {
  window.localStorage.clear();
  publicApiClient.get.mockResolvedValue({
    data: { season: 2026, includeIdp: false, players: buildPool() },
  });
});

afterEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

async function startDraft() {
  const utils = render(<DraftSimulator />);
  fireEvent.click(screen.getByRole('button', { name: 'Start mock draft' }));
  await screen.findByText('On the clock');
  return utils;
}

const firstDraftButton = () => document.querySelector('button[aria-label^="Draft "]');
const showTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

const rowLabels = (sectionLabel) =>
  within(screen.getByRole('list', { name: sectionLabel }))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('aria-label'));

/**
 * The panel's view of where each pick landed, keyed by its R.PP label.
 * Empty rows carry ", empty" and are skipped.
 */
function panelPlacements() {
  const panel = screen.getByLabelText('My roster');
  const out = new Map();
  within(panel).getAllByRole('listitem').forEach((li) => {
    const match = li.getAttribute('aria-label').match(/^(.+?) slot, .*, pick (\d+\.\d{2})/);
    if (match) out.set(match[2], match[1]);
  });
  return out;
}

/** The history list's view of the same thing, from its "→ SLOT" tags. */
function historyPlacements() {
  const feed = screen.getByLabelText('Your picks in order');
  const out = new Map();
  within(feed).getAllByRole('listitem').forEach((li) => {
    const pickLabel = within(li).getByText(/^\d+\.\d{2}$/).textContent;
    const tag = within(li).getByText(/^→ /).textContent.replace('→', '').trim();
    out.set(pickLabel, tag);
  });
  return out;
}

describe('the roster panel before a pick is made (acceptance criterion 1)', () => {
  it('shows the format’s nine starter rows, six bench rows and no IR row', async () => {
    await startDraft();
    showTab('My team');

    expect(rowLabels('Starters')).toEqual([
      'QB slot, empty', 'RB 1 slot, empty', 'RB 2 slot, empty',
      'WR 1 slot, empty', 'WR 2 slot, empty', 'TE slot, empty',
      'FLEX slot, empty', 'K slot, empty', 'DEF slot, empty',
    ]);
    expect(rowLabels('Bench')).toEqual([
      'BN 1 slot, empty', 'BN 2 slot, empty', 'BN 3 slot, empty',
      'BN 4 slot, empty', 'BN 5 slot, empty', 'BN 6 slot, empty',
    ]);
    expect(screen.queryByRole('list', { name: 'Injured reserve' })).not.toBeInTheDocument();
    expect(screen.getByText('0 of 9 starters filled')).toBeInTheDocument();
    expect(screen.getByText('0 of 6 bench filled')).toBeInTheDocument();
  });

  it('starts the user on 1.01 from draft slot 1 and knows the next pick', async () => {
    await startDraft();
    showTab('My team');
    expect(screen.getByText('Next pick 1.01')).toBeInTheDocument();
  });

  it('leaves nine starters plus six bench equal to the fifteen round count', async () => {
    await startDraft();
    showTab('My team');
    const total = rowLabels('Starters').length + rowLabels('Bench').length;
    expect(total).toBe(15);
    // Rounds and roster spots agree, so no capacity note is shown.
    expect(screen.queryByText(/This draft runs/)).not.toBeInTheDocument();
  });
});

describe('switching format (acceptance criterion 2)', () => {
  it('changes starter rows and round count while the bench stays at six', async () => {
    publicApiClient.get.mockResolvedValue({
      data: { season: 2026, includeIdp: true, players: buildPool({ idp: true }) },
    });
    render(<DraftSimulator />);

    expect(screen.getByText(/10-team Standard · 15 rounds/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'IDP format' }));
    expect(screen.getByText(/10-team IDP · 18 rounds/)).toBeInTheDocument();
    expect(screen.getByText(/12 starters plus 6 bench spots/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start mock draft' }));
    await screen.findByText('On the clock');
    showTab('My team');

    const starters = rowLabels('Starters');
    expect(starters).toHaveLength(12);
    expect(starters.slice(-3)).toEqual([
      'DL slot, empty', 'LB slot, empty', 'DB slot, empty',
    ]);
    expect(rowLabels('Bench')).toHaveLength(6);
    expect(starters.length + 6).toBe(18); // total spots equals the round count
  });
});

describe('the panel and the history agree, every round (acceptance criterion 7)', () => {
  it('keeps slot tags in sync with the roster through the final round', async () => {
    await startDraft();
    const simToMyPick = screen.getByRole('button', { name: 'Sim to my pick' });

    const checkpoints = [4, 9, 15];
    for (let round = 1; round <= 15; round++) {
      showTab('Players');
      const button = firstDraftButton();
      expect(button.disabled).toBe(false);
      fireEvent.click(button);

      if (checkpoints.includes(round)) {
        showTab('My team');
        const panel = panelPlacements();
        const history = historyPlacements();
        // Every pick the user has made is tagged, and both views name the same
        // slot for it. A later pick can re-home an earlier one out of FLEX, so
        // this has to hold at every checkpoint, not just at the end.
        expect(history.size).toBe(round);
        expect(panel.size).toBe(round);
        expect(history).toEqual(panel);
      }

      if (round < 15) fireEvent.click(simToMyPick);
    }
  });

  it('tags only the user’s rows in the league-wide rail', async () => {
    await startDraft();
    fireEvent.click(firstDraftButton());
    fireEvent.click(screen.getByRole('button', { name: 'Sim to my pick' }));

    const rail = screen.getAllByLabelText('Recent picks')[0];
    const rows = within(rail).getAllByRole('listitem');
    const tagged = rows.filter((row) => within(row).queryByText(/^→ /));
    // Many CPU picks landed between the user's first pick and their next turn;
    // exactly one row is the user's, and only it carries a slot tag.
    expect(rows.length).toBeGreaterThan(1);
    expect(tagged).toHaveLength(1);
  });
});

describe('refresh and restart (acceptance criterion 6)', () => {
  it('rebuilds the same slots from the resumed draft', async () => {
    const { unmount } = await startDraft();
    fireEvent.click(firstDraftButton());
    showTab('My team');
    const before = panelPlacements();
    expect(before.size).toBe(1);

    // Persistence is throttled (SAVE_THROTTLE_MS), and unmounting clears the
    // pending write, so a real refresh has to be modelled as "wait for the save,
    // THEN tear down" or the resumed draft legitimately has no picks in it.
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(SIM_STORAGE_KEY) || '{}');
      expect((saved.picks || []).length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // A refresh: same storage, a brand new component tree.
    unmount();
    render(<DraftSimulator />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    showTab('My team');

    // Slots are derived, never stored, so they rebuild from config + picks.
    expect(panelPlacements()).toEqual(before);
    expect(rowLabels('Starters')).toHaveLength(9);
    expect(rowLabels('Bench')).toHaveLength(6);
  });

  it('clears the roster along with the picks on restart', async () => {
    await startDraft();
    fireEvent.click(firstDraftButton());
    showTab('My team');
    expect(panelPlacements().size).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart' }));

    // Back to setup, and starting again gives an empty template.
    fireEvent.click(await screen.findByRole('button', { name: 'Start mock draft' }));
    await screen.findByText('On the clock');
    showTab('My team');
    expect(panelPlacements().size).toBe(0);
    expect(screen.getByText('0 of 9 starters filled')).toBeInTheDocument();
  });
});
