import React from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import renderWithProviders from "../../test-utils/renderWithProviders";
import apiClient from "../../api/apiClient";
import { useLeague } from "../../hooks/useLeague";
import { DEFAULT_ROSTER_SLOTS } from "../../lib/draftSim/templates";
import PlayerManagement from "./PlayerManagement";

jest.mock("../../api/apiClient", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// The league hook is mocked directly, the same way the matchup detail test
// mocks it (src/pages/matchup/MatchupPage.test.jsx, ~177), rather than
// through apiClient: PlayerManagement reads the selected league's roster
// template through useLeague, a separate read from the `/api/league` list
// mockBrowser below already stands up for the League dropdown.
jest.mock("../../hooks/useLeague", () => ({
  useLeague: jest.fn(),
}));

const player = (overrides = {}) => ({
  id: 1,
  name: "Patrick Mahomes",
  position: "QB",
  nfl_team: "Kansas City Chiefs",
  availability: { state: "free_agent", teamId: null, teamName: null, availableAt: null },
  projWeek: { week: 3, points: 22.4 },
  ros: { points: 210.5, perGame: 17.5, posRank: null, throughWeek: 17 },
  weeks: [{ week: 3, points: 22.4 }],
  ownership: null,
  upgrade: null,
  watching: false,
  ...overrides,
});
const league = {
  id: 1,
  name: "Sunday Ballers",
  draft_status: "complete",
  season_status: "regular",
  waiver_type: "faab",
  my_team_faab_remaining: 72,
  best_ball: false,
};
const priorityLeague = { ...league, waiver_type: "priority", my_team_waiver_priority: 3 };
// Roster templates a league's `roster_slots` can carry (#1419), mirroring
// the shapes CommissionerTools.jsx's own LINEUP_TEMPLATES stamp into a real
// league and templates.js's own IDP_LINEUP/SUPERFLEX_LINEUP.
const SUPERFLEX_SLOTS = [
  ...DEFAULT_ROSTER_SLOTS,
  { key: "SFLX", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] },
];
const IDP_SLOTS = [
  ...DEFAULT_ROSTER_SLOTS,
  { key: "DL", count: 1, eligiblePositions: ["DL"] },
  { key: "LB", count: 1, eligiblePositions: ["LB"] },
  { key: "DB", count: 1, eligiblePositions: ["DB"] },
];
const FULL_SLOTS = [
  ...DEFAULT_ROSTER_SLOTS,
  { key: "SFLX", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] },
  { key: "DL", count: 1, eligiblePositions: ["DL"] },
  { key: "LB", count: 1, eligiblePositions: ["LB"] },
  { key: "DB", count: 1, eligiblePositions: ["DB"] },
];

const originalMatchMedia = window.matchMedia;

function mockBrowser({
  players = [player()],
  leagues = [league],
  totalPages = 1,
  total = players.length,
  context,
  roster = [],
  // The selected league's own detail row, through useLeague - defaults to
  // the first dropdown league (a row with no `roster_slots`, so chips fall
  // back to the canonical DEFAULT_ROSTER_SLOTS set). Pass a row with its own
  // `roster_slots` to exercise a real template's chips, or `null` to model
  // "no league selected".
  templateLeague = leagues[0] ?? null,
  templateLeagueLoading = false,
  myClaims = [],
  claimsAfterAction = null,
  deferWaiverRefresh = false,
  rejectWaiverRefresh = false,
} = {}) {
  let actionDone = false;
  let resolveWaiverRefresh;
  const deferredWaiverRefresh = deferWaiverRefresh ? new Promise((resolve) => { resolveWaiverRefresh = resolve; }) : null;

  if (claimsAfterAction) apiClient.post.mockImplementation(async () => { actionDone = true; return {}; });
  apiClient.get.mockImplementation((url) => {
    if (url === "/api/league") return Promise.resolve({ data: leagues });
    if (url.startsWith("/api/team/roster")) return Promise.resolve({ data: roster });
    if (url.startsWith("/api/waivers?")) {
      // Handle the post-action refresh read with deferred/rejecting behavior
      if (actionDone) {
        if (deferWaiverRefresh) {
          return deferredWaiverRefresh.then(() =>
            Promise.resolve({ data: { myClaims: claimsAfterAction } })
          );
        }
        if (rejectWaiverRefresh) {
          return Promise.reject(new Error("Waiver refresh failed"));
        }
        return Promise.resolve({ data: { myClaims: claimsAfterAction } });
      }
      return Promise.resolve({ data: { myClaims } });
    }
    if (url === "/api/players")
      return Promise.resolve({
        data: {
          players,
          totalPages,
          total,
          context:
            context === undefined
              ? {
                  leagueName: "Sunday Ballers",
                  rosterCount: 8,
                  rosterCapacity: 14,
                  waiverType: "faab",
                  faabRemaining: 72,
                }
              : context,
        },
      });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });

  // Make resolveWaiverRefresh available for tests that need to control resolution timing
  if (deferWaiverRefresh) {
    mockBrowser.resolveWaiverRefresh = resolveWaiverRefresh;
  }

  useLeague.mockReturnValue({
    league: templateLeague,
    viewerTeamId: null,
    loading: templateLeagueLoading,
    error: null,
  });
}

beforeEach(() => {
  // A safe default so a test that never calls mockBrowser (it stubs
  // apiClient.get itself) still gets a defined useLeague() return instead of
  // undefined destructuring. mockBrowser overrides this per test as needed.
  useLeague.mockReturnValue({ league: null, viewerTeamId: null, loading: false, error: null });
});

afterEach(() => {
  jest.clearAllMocks();
  window.matchMedia = originalMatchMedia;
});

test("renders a league-scoped Player Browser without duplicate roster management", async () => {
  mockBrowser();
  renderWithProviders(<PlayerManagement />);

  expect(
    await screen.findByRole("heading", { name: "Player Browser" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("link", { name: "Manage lineup" }),
  ).toHaveAttribute("href", "/league/1/lineup");
  expect(
    screen.queryByRole("heading", { name: "My Roster" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Remove" }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith("/api/players", {
      // Formal review formal-1310-f1: Upgrade is the default sort once a
      // league is selected in a non-best-ball league. "All" sends no
      // position filter at all (#1419): it relies on the server's
      // league-scoped gate rather than a literal position=All.
      params: { page: 1, sort: "upgrade", leagueId: 1, view: "cards" },
    }),
  );
});

test("formal-1310-f1: Upgrade is the default sort only with a selected, non-best-ball league; no league or best ball stays ADP; an explicit ?sort= still wins", async () => {
  mockBrowser({ leagues: [{ ...league, best_ball: true }] });
  renderWithProviders(<PlayerManagement />);

  await screen.findByTestId("player-row");
  await waitFor(() => {
    const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
    expect(playerCalls.at(-1)[1].params.sort).toBe("adp");
  });
});

test("formal-1310-f1: an explicit ?sort= wins over the contextual Upgrade default", async () => {
  mockBrowser();
  renderWithProviders(<PlayerManagement />, {
    route: "/player?league=1&sort=name",
    path: "/player",
  });

  await waitFor(() => {
    const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
    expect(playerCalls.at(-1)[1].params.sort).toBe("name");
  });
});

// #1307, ADR 0040: PlayerManagement opens the Decision card (context derived
// from the row's own availability) instead of PlayerQuickView.
test("clicking a free-agent player's name opens the Decision card with an Add-to-roster action, not PlayerQuickView", async () => {
  mockBrowser({ players: [player({ id: 3, name: "Free Roamer" })] });
  renderWithProviders(<PlayerManagement />);

  await userEvent.click(await screen.findByRole("button", { name: "Free Roamer" }));

  const card = await screen.findByTestId("decision-card");
  expect(within(card).getByRole("heading", { name: "Free Roamer" })).toBeInTheDocument();
  expect(within(card).getByTestId("add-player-action")).toBeInTheDocument();
  expect(screen.queryByTestId("quickview-content")).not.toBeInTheDocument();
});

// Formal review round 1, f1 (blocker): opening one of the caller's OWN
// players (availability.state "my_team") used to crash in isEligibleMove
// on an entry with no eligibleSlots, since this page has no lineup wiring
// at all to give the card.
test("clicking one of the caller's own players' name opens the Decision card without crashing, and renders an Open lineup link", async () => {
  mockBrowser({
    players: [player({ id: 5, name: "My Own Guy", availability: { state: "my_team", teamId: 1, teamName: null, availableAt: null } })],
  });
  renderWithProviders(<PlayerManagement />);

  await userEvent.click(await screen.findByRole("button", { name: "My Own Guy" }));

  const card = await screen.findByTestId("decision-card");
  expect(within(card).getByRole("heading", { name: "My Own Guy" })).toBeInTheDocument();
  expect(within(card).getByTestId("decision-card-open-lineup")).toHaveAttribute(
    "href",
    "/league/1/lineup",
  );
  expect(within(card).queryByTestId("decision-card-bench-action")).not.toBeInTheDocument();
  // #1513: myTeam({ managed: false }) carries no onSwap, so lineupManaged
  // stays false and Drop renders no more than Bench/Start does.
  expect(within(card).queryByTestId("decision-card-drop")).not.toBeInTheDocument();
});

// Formal review round 1, f3: without a roster prop, the required drop pick
// at capacity has no options and Add never enables.
test("at roster capacity, the free-agent drop pick lists the caller's own roster", async () => {
  mockBrowser({
    players: [player({ id: 6, name: "Waiting Room" })],
    context: {
      leagueName: "Sunday Ballers",
      rosterCount: 16,
      rosterCapacity: 16,
      waiverType: "faab",
      faabRemaining: 72,
    },
    roster: [
      { id: 30, name: "Bench Guy", position: "WR", projected_weekly_points: 3.2 },
      { id: 31, name: "Star Player", position: "RB", projected_weekly_points: 22 },
    ],
  });
  renderWithProviders(<PlayerManagement />);

  await userEvent.click(await screen.findByRole("button", { name: "Waiting Room" }));
  const action = await screen.findByTestId("add-player-action");
  await userEvent.click(within(action).getByLabelText("Drop a player"));

  const options = await screen.findAllByRole("option");
  expect(within(options[1]).getByText(/Bench Guy/)).toBeInTheDocument();
  expect(within(options[2]).getByText(/Star Player/)).toBeInTheDocument();
});

// #1310, ADR 0040: the row's action follows the state - Add, Claim, Trade,
// Lineup - and NO row ever renders a disabled "Rostered" button (the red
// tell this ticket replaces: a rostered player is always tradeable).
test("renders the server-authoritative availability actions, state-driven", async () => {
  mockBrowser({
    players: [
      player({ id: 1, name: "Free Agent" }),
      player({ id: 2, name: "On Waivers", availability: { state: "waivers", teamId: null, teamName: null, availableAt: "2026-09-17T07:00:00.000Z" } }),
      player({ id: 3, name: "My Starter", availability: { state: "my_team", teamId: 1, teamName: null, availableAt: null } }),
      player({
        id: 4,
        name: "Rival Player",
        availability: { state: "rostered", teamId: 9, teamName: "Rival Squad", availableAt: null },
      }),
    ],
  });
  renderWithProviders(<PlayerManagement />);

  expect(
    await screen.findByRole("button", { name: "Claim" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Lineup" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Rostered" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Trade" })).toBeEnabled();
  expect(
    screen.getAllByRole("button", { name: "Add free agent" }),
  ).toHaveLength(1);
  // Status now names the owning team (ADR 0040 Lead correction item 2) -
  // the opposite of the old PlayerQuickView-era rule this replaces.
  expect(screen.getByText("Rival Squad")).toBeInTheDocument();
});

// #1513: the Decision card's own build - rostered({ availability }) - shows
// Propose trade, not the Open lineup link a my_team player gets.
test("clicking a rostered player's name opens the Decision card with a Propose trade action", async () => {
  mockBrowser({
    players: [
      player({
        id: 4,
        name: "Rival Player",
        availability: { state: "rostered", teamId: 9, teamName: "Rival Squad", availableAt: null },
      }),
    ],
  });
  renderWithProviders(<PlayerManagement />);

  await userEvent.click(await screen.findByRole("button", { name: "Rival Player" }));

  const card = await screen.findByTestId("decision-card");
  expect(within(card).getByTestId("decision-card-propose-trade")).toBeInTheDocument();
  expect(within(card).queryByTestId("decision-card-open-lineup")).not.toBeInTheDocument();
});

test("a rostered row's Trade action deep-links into TradeCenter with the owning team and this player preselected", async () => {
  mockBrowser({
    players: [
      player({
        id: 4,
        name: "Rival Player",
        availability: { state: "rostered", teamId: 9, teamName: "Rival Squad", availableAt: null },
      }),
    ],
  });
  renderWithProviders(<PlayerManagement />);

  expect(await screen.findByRole("link", { name: "Trade" })).toHaveAttribute(
    "href",
    "/league/1/trades?receivingTeamId=9&playerId=4",
  );
});

test("priority league: Claim submits a waiver claim directly, through the same claim-player feature WaiverWire's own dialog uses", async () => {
  mockBrowser({
    leagues: [priorityLeague],
    players: [
      player({ id: 2, name: "On Waivers", availability: { state: "waivers", teamId: null, teamName: null, availableAt: null } }),
    ],
  });
  apiClient.post.mockResolvedValue({});
  renderWithProviders(<PlayerManagement />);

  await userEvent.click(await screen.findByRole("button", { name: "Claim" }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith("/api/waivers/claim", {
      leagueId: 1,
      playerId: 2,
      dropPlayerId: null,
      bid: 0,
    }),
  );
});

// #1576: in a FAAB league a one-tap claim would silently post a $0 bid that
// loses to any $1 bid, so the row's Claim opens the Decision card where the
// bid and drop are collected.
test("FAAB league: the row's Claim opens the Decision card claim action and does not post a claim (#1576)", async () => {
  mockBrowser({
    players: [
      player({ id: 2, name: "On Waivers", availability: { state: "waivers", teamId: null, teamName: null, availableAt: null } }),
    ],
  });
  renderWithProviders(<PlayerManagement />);

  await userEvent.click(await screen.findByRole("button", { name: "Claim" }));

  expect(await screen.findByTestId("claim-player-action")).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();
});

test("Pending claims link shows the manager's pending count and routes to the Waiver wire (#1575)", async () => {
  mockBrowser({
    myClaims: [{ id: 1, status: "pending" }, { id: 2, status: "pending" }, { id: 3, status: "processed" }],
  });
  renderWithProviders(<PlayerManagement />);

  const link = await screen.findByRole("link", { name: "Pending claims (2)" });
  expect(link).toHaveAttribute("href", "/league/1/waivers");
});

test("Pending claims link is hidden in a best ball league (#1575)", async () => {
  const bb = { ...league, best_ball: true };
  mockBrowser({ leagues: [bb], myClaims: [{ id: 1, status: "pending" }] });
  renderWithProviders(<PlayerManagement />);

  await screen.findByText("Patrick Mahomes");
  expect(screen.queryByRole("link", { name: /Pending claims/ })).not.toBeInTheDocument();
});

test("Pending claims count increments after a successful row claim without a reload (#1575)", async () => {
  mockBrowser({
    leagues: [priorityLeague],
    players: [
      player({ id: 2, name: "On Waivers", availability: { state: "waivers", teamId: null, teamName: null, availableAt: null } }),
    ],
    myClaims: [{ id: 1, status: "pending" }],
    claimsAfterAction: [{ id: 1, status: "pending" }, { id: 2, status: "pending" }],
  });
  renderWithProviders(<PlayerManagement />);
  expect(await screen.findByRole("link", { name: "Pending claims (1)" })).toBeInTheDocument();

  await userEvent.click(await screen.findByRole("button", { name: "Claim" }));

  expect(await screen.findByRole("link", { name: "Pending claims (2)" })).toBeInTheDocument();
});

test("Pending claims count moves after a claim submitted from the at-capacity Decision card (#1575)", async () => {
  mockBrowser({
    players: [
      player({ id: 2, name: "On Waivers", availability: { state: "waivers", teamId: null, teamName: null, availableAt: null } }),
    ],
    context: { leagueName: "Sunday Ballers", rosterCount: 16, rosterCapacity: 16, waiverType: "priority", waiverPriority: 3 },
    roster: [{ id: 30, name: "Bench Guy", position: "WR", projected_weekly_points: 3.2 }],
    myClaims: [{ id: 1, status: "pending" }],
    claimsAfterAction: [{ id: 1, status: "pending" }, { id: 2, status: "pending" }],
  });
  renderWithProviders(<PlayerManagement />);
  expect(await screen.findByRole("link", { name: "Pending claims (1)" })).toBeInTheDocument();

  await userEvent.click(await screen.findByRole("button", { name: "Claim" }));
  const action = await screen.findByTestId("claim-player-action");
  await userEvent.click(within(action).getByLabelText("Drop a player"));
  await userEvent.click((await screen.findAllByRole("option"))[1]);
  await userEvent.click(within(action).getByTestId("claim-player-submit"));

  // The Decision card is a modal, so the page behind it is aria-hidden.
  expect(await screen.findByRole("link", { name: "Pending claims (2)", hidden: true })).toBeInTheDocument();
});

test("Pending claims link keeps the prior count while the post-action re-read is in flight (#1686)", async () => {
  mockBrowser({
    leagues: [priorityLeague],
    players: [
      player({ id: 2, name: "On Waivers", availability: { state: "waivers", teamId: null, teamName: null, availableAt: null } }),
    ],
    myClaims: [{ id: 1, status: "pending" }],
    claimsAfterAction: [{ id: 1, status: "pending" }, { id: 2, status: "pending" }],
    deferWaiverRefresh: true,
  });
  renderWithProviders(<PlayerManagement />);
  expect(await screen.findByRole("link", { name: "Pending claims (1)" })).toBeInTheDocument();

  await userEvent.click(await screen.findByRole("button", { name: "Claim" }));

  // While the refresh read is in flight (deferred), the link should still show the prior count
  expect(screen.getByRole("link", { name: "Pending claims (1)" })).toBeInTheDocument();

  // Resolve the deferred read
  mockBrowser.resolveWaiverRefresh();

  // Now the link should update to show the new count
  expect(await screen.findByRole("link", { name: "Pending claims (2)" })).toBeInTheDocument();
});

test("Pending claims link keeps the last known count after a failed re-read (#1686)", async () => {
  mockBrowser({
    leagues: [priorityLeague],
    players: [
      player({ id: 2, name: "On Waivers", availability: { state: "waivers", teamId: null, teamName: null, availableAt: null } }),
    ],
    myClaims: [{ id: 1, status: "pending" }],
    claimsAfterAction: [{ id: 1, status: "pending" }, { id: 2, status: "pending" }],
    rejectWaiverRefresh: true,
  });
  renderWithProviders(<PlayerManagement />);
  expect(await screen.findByRole("link", { name: "Pending claims (1)" })).toBeInTheDocument();

  await userEvent.click(await screen.findByRole("button", { name: "Claim" }));

  // Wait for the post-action re-read (the `&r=` URL) to be issued and to reject,
  // then let the rejection settle into the endpoint's error state before asserting.
  await waitFor(() =>
    expect(apiClient.get.mock.calls.some(([url]) => /^\/api\/waivers\?.*&r=/.test(String(url)))).toBe(true),
  );
  const refreshIndex = apiClient.get.mock.calls.findIndex(([url]) => /^\/api\/waivers\?.*&r=/.test(String(url)));
  await expect(apiClient.get.mock.results[refreshIndex].value).rejects.toThrow("Waiver refresh failed");
  // After the failed re-read settles, the link still shows the last known count
  expect(await screen.findByRole("link", { name: "Pending claims (1)" })).toBeInTheDocument();
});

// A full roster makes the one-tap claim impossible: the server 409s with
// "choose a player to drop" and the row had nowhere to choose one. At
// capacity the row's Claim opens the Decision card's claim bar (drop pick +
// bid) instead of firing a claim that cannot succeed.
test("at roster capacity, the row's Claim opens the Decision card claim bar instead of posting a claim", async () => {
  mockBrowser({
    players: [
      player({ id: 2, name: "On Waivers", availability: { state: "waivers", teamId: null, teamName: null, availableAt: null } }),
    ],
    context: {
      leagueName: "Sunday Ballers",
      rosterCount: 16,
      rosterCapacity: 16,
      waiverType: "priority",
      waiverPriority: 3,
    },
    roster: [
      { id: 30, name: "Bench Guy", position: "WR", projected_weekly_points: 3.2 },
      { id: 31, name: "Star Player", position: "RB", projected_weekly_points: 22 },
    ],
  });
  renderWithProviders(<PlayerManagement />);

  await userEvent.click(await screen.findByRole("button", { name: "Claim" }));

  const action = await screen.findByTestId("claim-player-action");
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(within(action).getByText(/roster is full/i)).toBeInTheDocument();
  await userEvent.click(within(action).getByLabelText("Drop a player"));
  const options = await screen.findAllByRole("option");
  expect(within(options[1]).getByText(/Bench Guy/)).toBeInTheDocument();
  expect(within(options[2]).getByText(/Star Player/)).toBeInTheDocument();
});

// Formal review formal-1310-f3: the busy state used to be page-wide (every
// row's Claim relabeled/disabled while ANY one was in flight). It must be
// scoped to the one row the manager actually tapped.
test("formal-1310-f3: only the tapped row's Claim goes busy, not every waivers row", async () => {
  let resolvePost;
  apiClient.post.mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }));
  mockBrowser({
    leagues: [priorityLeague],
    players: [
      player({ id: 2, name: "First Waiver", availability: { state: "waivers", teamId: null, teamName: null, availableAt: null } }),
      player({ id: 3, name: "Second Waiver", availability: { state: "waivers", teamId: null, teamName: null, availableAt: null } }),
    ],
  });
  renderWithProviders(<PlayerManagement />);

  const claimButtons = await screen.findAllByRole("button", { name: "Claim" });
  expect(claimButtons).toHaveLength(2);
  await userEvent.click(claimButtons[0]);

  expect(await screen.findByRole("button", { name: "Claiming…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Claim" })).toBeEnabled();

  resolvePost({});
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Claim" })).toHaveLength(2));
});

test("adds a Free agent then refreshes the server-authoritative browser state", async () => {
  mockBrowser({ players: [player({ id: 8, name: "Free Agent" })] });
  apiClient.post.mockResolvedValue({});
  renderWithProviders(<PlayerManagement />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Add free agent" }),
  );
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith("/api/team/roster/8", {
      leagueId: 1,
    }),
  );
  await waitFor(() =>
    expect(
      apiClient.get.mock.calls.filter(([url]) => url === "/api/players").length,
    ).toBeGreaterThan(1),
  );
});

// Formal review round 2, f11: the roster read (f3's fix, for the at-capacity
// drop pick) must refresh alongside the players list after an add, or a
// later drop pick still lists a player who is no longer on the roster.
test("adding a Free agent also re-reads the caller's own roster", async () => {
  mockBrowser({ players: [player({ id: 8, name: "Free Agent" })] });
  apiClient.post.mockResolvedValue({});
  renderWithProviders(<PlayerManagement />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Add free agent" }),
  );
  await waitFor(() =>
    expect(
      apiClient.get.mock.calls.filter(([url]) => url.startsWith("/api/team/roster")).length,
    ).toBeGreaterThan(1),
  );
});

test("uses URL-backed availability filters through the segmented control", async () => {
  mockBrowser({ players: [player()] });
  renderWithProviders(<PlayerManagement />);
  await screen.findByRole("button", { name: "Add free agent" });

  await userEvent.click(screen.getByRole("radio", { name: "Free agents" }));
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith("/api/players", {
      params: {
        page: 1,
        // Formal review formal-1310-f1: Upgrade is the default sort once a
        // league is selected in a non-best-ball league. "All" sends no
        // position filter at all (#1419).
        sort: "upgrade",
        leagueId: 1,
        view: "cards",
        availability: "free_agent",
      },
    }),
  );
});

test("restores selected league, search, position, sort, direction, and page from the URL", async () => {
  mockBrowser();
  renderWithProviders(<PlayerManagement />, {
    route:
      "/player?league=1&page=2&pos=RB&availability=waivers&sort=name&dir=desc&q=smith",
    path: "/player",
  });

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith("/api/players", {
      params: {
        page: 2,
        position: "RB",
        sort: "name",
        leagueId: 1,
        view: "cards",
        availability: "waivers",
        dir: "desc",
        search: "smith",
      },
    }),
  );
});

test("uses stacked player-row cards and a filter drawer at mobile widths", async () => {
  window.matchMedia = jest
    .fn()
    .mockImplementation(() => ({
      matches: true,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
  mockBrowser({ players: [player({ name: "Card Player" })] });
  renderWithProviders(<PlayerManagement />);

  expect(
    await screen.findByRole("button", { name: "Filters" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(await screen.findByTestId("player-row-card")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Filters" }));
  expect(
    await screen.findByRole("heading", { name: "Player filters" }),
  ).toBeInTheDocument();
});

test("keeps player browsing available without a fantasy league while withholding acquisition", async () => {
  mockBrowser({
    leagues: [{ id: 5, name: "Office Pool", pickem_only: true }],
    context: null,
  });
  renderWithProviders(<PlayerManagement />);

  expect(
    await screen.findByText(/not in a fantasy league yet/i),
  ).toBeInTheDocument();
  // findByRole (not getByRole): the player row's own action button depends on
  // the SEPARATE /api/players fetch, which now races the roster fetch this
  // ticket adds - both settle, but not necessarily in the order the "no
  // league" alert (leagues-only) does.
  expect(await screen.findByRole("button", { name: "Select league" })).toBeDisabled();
});

// A league fetched with no leagueId sends the plain (pre-view=cards) shape:
// view=cards is a 400 without one (server ruling), so PlayerManagement never
// sends it while no league is selected.
test("never sends view=cards without a selected league", async () => {
  mockBrowser({
    leagues: [{ id: 5, name: "Office Pool", pickem_only: true }],
    context: null,
  });
  renderWithProviders(<PlayerManagement />);

  await screen.findByText(/not in a fantasy league yet/i);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/players", { params: { page: 1, sort: "adp" } }));
});

// #970: player management reads its failures through readHttpFailure. The
// envelope is shape (b): the machine CODE in `error`, the sentence for the
// manager in `message`. The old hand-rolled `err.response?.data?.error` read
// the code, so the browser's error Alert showed PLAYER_INDEX_UNAVAILABLE.
test("a load refusal carrying a code beside a message renders the message, not the code", async () => {
  apiClient.get.mockImplementation((url) => (
    url === "/api/players"
      ? Promise.reject({
          response: {
            status: 503,
            data: {
              error: "PLAYER_INDEX_UNAVAILABLE",
              message: "The player index is rebuilding. Try again in a moment.",
            },
          },
        })
      : Promise.resolve({ data: [league] })
  ));

  renderWithProviders(<PlayerManagement />, { path: "/players", route: "/players" });

  expect(
    await screen.findByText("The player index is rebuilding. Try again in a moment.")
  ).toBeInTheDocument();
  expect(screen.queryByText("PLAYER_INDEX_UNAVAILABLE")).not.toBeInTheDocument();
});

// Issue #1002 acceptance criterion 2 / #1310: the Sort dropdown still
// translates a sortFields KEY to the server's wire name at the fetch site,
// unaffected by this ticket's removal of the old per-column header sort
// (those columns - Pos rank, ADP, Pool projection - left the list itself,
// ADR 0040: "Pool projection leaves waivers and the player list").
test("choosing a Sort option sends the matching ?sort= wire name", async () => {
  mockBrowser();
  renderWithProviders(<PlayerManagement />);
  await screen.findByRole("heading", { name: "Player Browser" });

  await userEvent.click(screen.getByLabelText("Sort"));
  expect(await screen.findByRole("option", { name: "Pool projection" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("option", { name: "Position rank" }));

  await waitFor(() => {
    const playerCalls = apiClient.get.mock.calls.filter(
      ([url]) => url === "/api/players",
    );
    expect(playerCalls.at(-1)[1].params.sort).toBe("position_rank");
  });
});

// The `?sort=` URL param carried WIRE names before #1002 and now carries keys,
// and one field's two names differ, so a bookmark made before this change would
// otherwise resolve to nothing and silently fall back to the default sort. The
// legacy value is still accepted on read and maps to the same request.
test("a pre-existing ?sort= bookmark holding the old wire name still sorts by that field", async () => {
  mockBrowser();
  renderWithProviders(<PlayerManagement />, {
    route: "/player?league=1&sort=projected_points",
    path: "/player",
  });

  await waitFor(() => {
    const playerCalls = apiClient.get.mock.calls.filter(
      ([url]) => url === "/api/players",
    );
    expect(playerCalls.at(-1)[1].params.sort).toBe("projected_points");
  });
});

test("hides the Upgrade column entirely in a best ball league", async () => {
  mockBrowser({
    leagues: [{ ...league, best_ball: true }],
    players: [player({ upgrade: { points: 4.1, overPlayer: { id: 9, name: "Bench" }, slot: "RB" } })],
  });
  renderWithProviders(<PlayerManagement />);

  await screen.findByTestId("player-row");
  expect(screen.queryByRole("columnheader", { name: "Upgrade" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("player-row-upgrade")).not.toBeInTheDocument();
});

// #1312, ADR 0040 follow-up (grill ruling Q6): the row's own Watch toggle -
// the button label flips from the row's own `watching` field (the view=cards
// payload, #1309), no extra fetch.
test("the row's Watch toggle PUTs, then re-reads the players list (no optimistic guess)", async () => {
  mockBrowser({ players: [player({ id: 9, name: "Watch Target", watching: false })] });
  apiClient.put.mockResolvedValue({});
  renderWithProviders(<PlayerManagement />);

  // Risk review (accessibility): the icon-only toggle's accessible name
  // folds in the player's own name, so a multi-row page never exposes
  // several identically named controls.
  const toggle = await screen.findByRole("button", { name: "Watch Watch Target" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");

  await userEvent.click(toggle);

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith("/api/players/9/watch", null, {
      params: { leagueId: 1 },
    }),
  );
  // Watch, like Add/Claim, refreshes the server-authoritative list rather
  // than guessing the next state locally.
  await waitFor(() =>
    expect(
      apiClient.get.mock.calls.filter(([url]) => url === "/api/players").length,
    ).toBeGreaterThan(1),
  );
});

test("a watched row renders \"Watching\" and DELETEs on click", async () => {
  mockBrowser({ players: [player({ id: 9, name: "Watch Target", watching: true })] });
  apiClient.delete.mockResolvedValue({});
  renderWithProviders(<PlayerManagement />);

  const toggle = await screen.findByRole("button", { name: "Watching Watch Target" });
  expect(toggle).toHaveAttribute("aria-pressed", "true");

  await userEvent.click(toggle);

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith("/api/players/9/watch", {
      params: { leagueId: 1 },
    }),
  );
});

test("no league selected: the row renders no Watch toggle", async () => {
  mockBrowser({
    leagues: [{ id: 5, name: "Office Pool", pickem_only: true }],
    context: null,
  });
  renderWithProviders(<PlayerManagement />);

  await screen.findByRole("button", { name: "Select league" });
  expect(screen.queryByTestId("player-row-watch")).not.toBeInTheDocument();
});

// #1312 Ruling: "The Players list gains a Watching toggle that filters
// client-side on that flag" - never a fifth Availability segment, and never
// a second server read (the toggle carries no leagueId/position/etc. of its
// own, so it never appears in the /api/players params).
test("the Watching toggle filters the list to only watched players, client-side, with no extra fetch", async () => {
  mockBrowser({
    players: [
      player({ id: 1, name: "Watched Guy", watching: true }),
      player({ id: 2, name: "Unwatched Guy", watching: false }),
    ],
  });
  renderWithProviders(<PlayerManagement />);

  await screen.findByText("Watched Guy");
  expect(screen.getByText("Unwatched Guy")).toBeInTheDocument();
  const callsBeforeToggle = apiClient.get.mock.calls.filter(([url]) => url === "/api/players").length;

  await userEvent.click(screen.getByRole("checkbox", { name: "Watching" }));

  expect(screen.getByText("Watched Guy")).toBeInTheDocument();
  expect(screen.queryByText("Unwatched Guy")).not.toBeInTheDocument();
  expect(
    apiClient.get.mock.calls.filter(([url]) => url === "/api/players").length,
  ).toBe(callsBeforeToggle);

  await userEvent.click(screen.getByRole("checkbox", { name: "Watching" }));
  expect(screen.getByText("Unwatched Guy")).toBeInTheDocument();
});

// Emotion writes every rule into `document.styleSheets` under the generated
// class name; this reads one element's own declarations back (the same helper
// SegmentedControl.test.jsx uses).
const ruleFor = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith("css-"));
  let text = "";
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (rule.selectorText === `.${cls}`) text += `${rule.style.cssText};`;
    });
  });
  return text;
};

// Desktop regression: the five Availability segments rendered as a `scrollable`
// strip with its scrollbar hidden, inside a grid column too narrow for them,
// so "Rostered" and "My team" were off the edge with no pointer-driven way to
// reach them (the drawer's swipe does not exist on a desktop). jsdom cannot
// measure the column, but it can read the group's own rule: on desktop the
// group must not be the hidden-scrollbar strip. The mobile drawer keeps it.
test("desktop renders the Availability control at its natural width, never as a hidden-scrollbar strip", async () => {
  mockBrowser();
  renderWithProviders(<PlayerManagement />);

  await screen.findByTestId("player-row");
  const group = ruleFor(screen.getByRole("radiogroup", { name: "Availability" }));
  expect(group).not.toMatch(/overflow-x: auto/);
  expect(group).not.toMatch(/scrollbar-width: none/);
  expect(screen.getAllByRole("radio")).toHaveLength(5);
});

test("the mobile Filters drawer keeps the Availability control as a swipeable strip", async () => {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: true,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  mockBrowser();
  renderWithProviders(<PlayerManagement />);

  await userEvent.click(await screen.findByRole("button", { name: "Filters" }));
  const group = ruleFor(await screen.findByRole("radiogroup", { name: "Availability" }));
  expect(group).toMatch(/overflow-x: auto/);
});

test("the Watching toggle, with nothing watched on the page, shows its own empty state", async () => {
  mockBrowser({ players: [player({ id: 1, name: "Unwatched Guy", watching: false })] });
  renderWithProviders(<PlayerManagement />);

  await screen.findByText("Unwatched Guy");
  await userEvent.click(screen.getByRole("checkbox", { name: "Watching" }));

  expect(await screen.findByText("No watched players on this page")).toBeInTheDocument();
});

// #1419: the Players page derives its Position chips from the selected
// league's own roster template (useLeague, `roster_slots`) instead of the
// hardcoded POSITIONS list this red-tell used to be sent against - it names
// DE, DT, CB and S directly rather than folding them under DL/DB.
describe("position chips derived from the roster template (#1419)", () => {
  async function openPositionOptions() {
    await userEvent.click(screen.getByLabelText("Position"));
    return screen.findAllByRole("option");
  }

  test("a non-IDP template renders no defender chips", async () => {
    mockBrowser({ templateLeague: { ...league, roster_slots: DEFAULT_ROSTER_SLOTS } });
    renderWithProviders(<PlayerManagement />);
    await screen.findByTestId("player-row");

    const options = await openPositionOptions();
    const labels = options.map((option) => option.textContent);
    expect(labels).not.toContain("DL");
    expect(labels).not.toContain("LB");
    expect(labels).not.toContain("DB");
  });

  test("an IDP template renders DL, LB and DB chips, never the six granular codes", async () => {
    mockBrowser({ templateLeague: { ...league, roster_slots: IDP_SLOTS } });
    renderWithProviders(<PlayerManagement />);
    await screen.findByTestId("player-row");

    const options = await openPositionOptions();
    const labels = options.map((option) => option.textContent);
    expect(labels).toEqual(expect.arrayContaining(["DL", "LB", "DB"]));
    expect(labels).not.toEqual(
      expect.arrayContaining(["DE", "DT", "NT", "ILB", "OLB", "CB", "S", "FS", "SS"]),
    );
  });

  test("the FLEX chip requests the union of its slot's eligible positions (RB, WR, TE)", async () => {
    mockBrowser({ templateLeague: { ...league, roster_slots: SUPERFLEX_SLOTS } });
    renderWithProviders(<PlayerManagement />);
    await screen.findByTestId("player-row");

    await userEvent.click(screen.getByLabelText("Position"));
    await userEvent.click(await screen.findByRole("option", { name: "FLEX" }));

    await waitFor(() => {
      const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
      expect(playerCalls.at(-1)[1].params.positions).toBe("RB,WR,TE");
    });
    const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
    expect(playerCalls.at(-1)[1].params.position).toBeUndefined();
  });

  test("the SFLX chip requests QB as well (QB, RB, WR, TE)", async () => {
    mockBrowser({ templateLeague: { ...league, roster_slots: SUPERFLEX_SLOTS } });
    renderWithProviders(<PlayerManagement />);
    await screen.findByTestId("player-row");

    await userEvent.click(screen.getByLabelText("Position"));
    await userEvent.click(await screen.findByRole("option", { name: "SFLX" }));

    await waitFor(() => {
      const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
      expect(playerCalls.at(-1)[1].params.positions).toBe("QB,RB,WR,TE");
    });
    const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
    expect(playerCalls.at(-1)[1].params.position).toBeUndefined();
  });

  test("chips render in canonical order: All, QB, RB, WR, TE, FLEX, SFLX, K, DEF, DL, LB, DB", async () => {
    mockBrowser({ templateLeague: { ...league, roster_slots: FULL_SLOTS } });
    renderWithProviders(<PlayerManagement />);
    await screen.findByTestId("player-row");

    const options = await openPositionOptions();
    expect(options.map((option) => option.textContent)).toEqual([
      "All", "QB", "RB", "WR", "TE", "FLEX", "SFLX", "K", "DEF", "DL", "LB", "DB",
    ]);
  });

  // Formal review f2: with no server-side gate on an ungated request, the
  // page must offer every chip that could narrow it - the full 12-chip
  // canonical set, not just the 8 DEFAULT_ROSTER_SLOTS carries.
  test("no league selected renders the full canonical set (FLEX meaning RB, WR, TE)", async () => {
    mockBrowser({
      leagues: [{ id: 5, name: "Office Pool", pickem_only: true }],
      context: null,
      templateLeague: null,
    });
    renderWithProviders(<PlayerManagement />);
    await screen.findByText(/not in a fantasy league yet/i);

    const options = await openPositionOptions();
    expect(options.map((option) => option.textContent)).toEqual([
      "All", "QB", "RB", "WR", "TE", "FLEX", "SFLX", "K", "DEF", "DL", "LB", "DB",
    ]);
  });

  test("a league with an empty roster template renders the full canonical set", async () => {
    mockBrowser({ templateLeague: { ...league, roster_slots: [] } });
    renderWithProviders(<PlayerManagement />);
    await screen.findByTestId("player-row");

    const options = await openPositionOptions();
    expect(options.map((option) => option.textContent)).toEqual([
      "All", "QB", "RB", "WR", "TE", "FLEX", "SFLX", "K", "DEF", "DL", "LB", "DB",
    ]);
  });

  // Formal review f2: since the full-canonical fallback now carries a DL
  // chip too, a deep link into it survives the league-switch reset effect's
  // first pass instead of being stripped to "All" before the manager ever
  // sees it.
  test("a deep link's ?pos=DL survives first render with no league selected", async () => {
    mockBrowser({
      leagues: [{ id: 5, name: "Office Pool", pickem_only: true }],
      context: null,
      templateLeague: null,
      players: [player()],
    });
    renderWithProviders(<PlayerManagement />, { route: "/player?pos=DL", path: "/player" });

    await screen.findByText(/not in a fantasy league yet/i);
    await waitFor(() => {
      const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
      expect(playerCalls.at(-1)[1].params.positions).toBe("DL,DE,DT,NT");
    });
  });

  test("switching to a league whose template drops the selected chip resets the filter to All", async () => {
    const leagues = [
      { ...league, id: 1, name: "IDP League" },
      { ...league, id: 2, name: "Standard League" },
    ];
    mockBrowser({ leagues, players: [player()] });
    useLeague.mockImplementation((leagueId) => {
      if (Number(leagueId) === 1) {
        return { league: { ...league, id: 1, roster_slots: IDP_SLOTS }, viewerTeamId: null, loading: false, error: null };
      }
      if (Number(leagueId) === 2) {
        return { league: { ...league, id: 2, roster_slots: DEFAULT_ROSTER_SLOTS }, viewerTeamId: null, loading: false, error: null };
      }
      return { league: null, viewerTeamId: null, loading: false, error: null };
    });
    renderWithProviders(<PlayerManagement />, { route: "/player?league=1&pos=DL", path: "/player" });
    await screen.findByTestId("player-row");
    await waitFor(() => {
      const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
      expect(playerCalls.at(-1)[1].params.positions).toBe("DL,DE,DT,NT");
    });

    await userEvent.click(screen.getByLabelText("League"));
    await userEvent.click(await screen.findByRole("option", { name: "Standard League" }));

    await waitFor(() => {
      const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
      expect(playerCalls.at(-1)[1].params.positions).toBeUndefined();
    });
    const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
    expect(playerCalls.at(-1)[1].params.position).toBeUndefined();
  });

  // Formal review f3: chips (and so selectedChip) is rebuilt on every
  // templateLeague reload even when its VALUES are unchanged, since
  // useResource hands back a new `league` object each time. Before the fix,
  // fetchPlayers depended on that object directly, so any rerender that
  // called useLeague again - even with equal content - refetched.
  test("f3: a rerender with an equal-but-new league object issues no extra /api/players call", async () => {
    mockBrowser({ players: [player({ id: 1, name: "Steady Guy", watching: false })] });
    // A fresh wrapper object AND a fresh roster_slots array every call, each
    // with equal content - the shape a real reload actually hands back
    // (JSON reparsed on the wire), and the "equal-but-new" case the fix
    // targets. Reusing the literal DEFAULT_ROSTER_SLOTS reference would let
    // parseRosterSlots' array pass-through mask the bug entirely.
    useLeague.mockImplementation(() => ({
      league: { ...league, roster_slots: [...DEFAULT_ROSTER_SLOTS] },
      viewerTeamId: null,
      loading: false,
      error: null,
    }));
    renderWithProviders(<PlayerManagement />);
    await screen.findByText("Steady Guy");

    const callsBefore = apiClient.get.mock.calls.filter(([url]) => url === "/api/players").length;
    // Toggling Watching re-renders the component (and so calls useLeague
    // again) without changing anything fetchPlayers should care about.
    await userEvent.click(screen.getByRole("checkbox", { name: "Watching" }));

    expect(
      apiClient.get.mock.calls.filter(([url]) => url === "/api/players").length,
    ).toBe(callsBefore);
  });

  // Formal review f3: the players fetch now holds while the SELECTED
  // league's own template is loading, rather than firing once under the
  // fallback template and again once the real one lands.
  test("f3: a loading-to-loaded template transition issues exactly one filtered /api/players call", async () => {
    // watching: true so Loader Guy stays visible once the Watching toggle
    // (this test's neutral rerender trigger, below) filters the list.
    mockBrowser({ players: [player({ id: 1, name: "Loader Guy", watching: true })] });
    let templateLoaded = false;
    useLeague.mockImplementation(() => (
      templateLoaded
        ? { league: { ...league, roster_slots: DEFAULT_ROSTER_SLOTS }, viewerTeamId: null, loading: false, error: null }
        : { league: null, viewerTeamId: null, loading: true, error: null }
    ));
    renderWithProviders(<PlayerManagement />, { route: "/player?league=1&pos=RB", path: "/player" });

    await screen.findByRole("link", { name: "Manage lineup" });
    expect(
      apiClient.get.mock.calls.filter(([url]) => url === "/api/players"),
    ).toHaveLength(0);

    templateLoaded = true;
    // Any rerender picks up the mock's new (now loaded) return value.
    await userEvent.click(screen.getByRole("checkbox", { name: "Watching" }));

    await screen.findByText("Loader Guy");
    const playerCalls = apiClient.get.mock.calls.filter(([url]) => url === "/api/players");
    expect(playerCalls).toHaveLength(1);
    expect(playerCalls[0][1].params.position).toBe("RB");
  });

  // Formal review f2 (round 2): useResource's stale-while-revalidate reload
  // (an invalidation of an already-loaded row) sets `loading` true while
  // KEEPING `templateLeague` set - unlike a first load, nothing about the
  // template actually became unknown, so this must never hold or refetch.
  test("f2: a stale-while-revalidate reload (loading true, template kept) issues no extra /api/players call", async () => {
    mockBrowser({ players: [player({ id: 1, name: "Revalidate Guy", watching: true })] });
    let revalidating = false;
    useLeague.mockImplementation(() => ({
      // A fresh roster_slots array every call (as a real reload would hand
      // back) with unchanged content - `loading` toggles, `league` never
      // goes null.
      league: { ...league, roster_slots: [...DEFAULT_ROSTER_SLOTS] },
      viewerTeamId: null,
      loading: revalidating,
      error: null,
    }));
    renderWithProviders(<PlayerManagement />, { route: "/player?league=1&pos=RB", path: "/player" });

    await screen.findByText("Revalidate Guy");
    const callsAfterInitialLoad = apiClient.get.mock.calls.filter(([url]) => url === "/api/players").length;
    expect(callsAfterInitialLoad).toBeGreaterThan(0);

    // The reload starts (loading flips true, template row kept on screen)...
    revalidating = true;
    await userEvent.click(screen.getByRole("checkbox", { name: "Watching" }));
    // ...and lands (loading flips back false, unchanged content).
    revalidating = false;
    await userEvent.click(screen.getByRole("checkbox", { name: "Watching" }));

    expect(
      apiClient.get.mock.calls.filter(([url]) => url === "/api/players").length,
    ).toBe(callsAfterInitialLoad);
  });
});
