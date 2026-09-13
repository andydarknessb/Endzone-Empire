import React from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import renderWithProviders from "../../test-utils/renderWithProviders";
import apiClient from "../../api/apiClient";
import PlayerManagement from "./PlayerManagement";

jest.mock("../../api/apiClient", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
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
const originalMatchMedia = window.matchMedia;

function mockBrowser({
  players = [player()],
  leagues = [league],
  totalPages = 1,
  total = players.length,
  context,
  roster = [],
} = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url === "/api/league") return Promise.resolve({ data: leagues });
    if (url.startsWith("/api/team/roster")) return Promise.resolve({ data: roster });
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
}

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
      // league is selected in a non-best-ball league.
      params: { page: 1, position: "All", sort: "upgrade", leagueId: 1, view: "cards" },
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

test("Claim submits a waiver claim directly, through the same claim-player feature WaiverWire's own dialog uses", async () => {
  mockBrowser({
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

// Formal review formal-1310-f3: the busy state used to be page-wide (every
// row's Claim relabeled/disabled while ANY one was in flight). It must be
// scoped to the one row the manager actually tapped.
test("formal-1310-f3: only the tapped row's Claim goes busy, not every waivers row", async () => {
  let resolvePost;
  apiClient.post.mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }));
  mockBrowser({
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
        position: "All",
        // Formal review formal-1310-f1: Upgrade is the default sort once a
        // league is selected in a non-best-ball league.
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
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/players", { params: { page: 1, position: "All", sort: "adp" } }));
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
