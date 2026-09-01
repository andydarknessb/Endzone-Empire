import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import renderWithProviders from "../../test-utils/renderWithProviders";
import apiClient from "../../api/apiClient";
import PlayerManagement from "./PlayerManagement";

jest.mock("../../api/apiClient", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const player = (overrides = {}) => ({
  id: 1,
  name: "Patrick Mahomes",
  position: "QB",
  nfl_team: "Kansas City Chiefs",
  availability: { state: "free_agent" },
  ...overrides,
});
const league = {
  id: 1,
  name: "Sunday Ballers",
  draft_status: "complete",
  season_status: "regular",
  waiver_type: "faab",
  my_team_faab_remaining: 72,
};
const originalMatchMedia = window.matchMedia;

function mockBrowser({
  players = [player()],
  leagues = [league],
  totalPages = 1,
  total = players.length,
  context,
} = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url === "/api/league") return Promise.resolve({ data: leagues });
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
      params: { page: 1, position: "All", sort: "adp", leagueId: 1 },
    }),
  );
});

test("renders the server-authoritative availability actions without disclosing another Team", async () => {
  mockBrowser({
    players: [
      player({ id: 1, name: "Free Agent" }),
      player({ id: 2, name: "On Waivers", availability: { state: "waivers" } }),
      player({ id: 3, name: "My Starter", availability: { state: "my_team" } }),
      player({
        id: 4,
        name: "Rival Player",
        availability: { state: "rostered" },
      }),
    ],
  });
  renderWithProviders(<PlayerManagement />);

  expect(
    await screen.findByRole("button", { name: "Claim" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "In lineup" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Rostered" })).toBeDisabled();
  expect(
    screen.getAllByRole("button", { name: "Add free agent" }),
  ).toHaveLength(1);
  expect(
    screen.queryByText(/Rival Team|Rival Manager/),
  ).not.toBeInTheDocument();
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

test("uses URL-backed availability filters and labels the stored value Pool projection", async () => {
  mockBrowser({ players: [player({ projected_points: 211.4 })] });
  renderWithProviders(<PlayerManagement />);
  await screen.findByRole("button", { name: "Add free agent" });

  expect(screen.getByText("Pool projection")).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Availability"));
  await userEvent.click(
    await screen.findByRole("option", { name: "Free agents" }),
  );
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith("/api/players", {
      params: {
        page: 1,
        position: "All",
        sort: "adp",
        leagueId: 1,
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
        availability: "waivers",
        dir: "desc",
        search: "smith",
      },
    }),
  );
});

test("uses rich player cards and a filter drawer at mobile widths", async () => {
  window.matchMedia = jest
    .fn()
    .mockImplementation(() => ({
      matches: true,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
  mockBrowser({ players: [player({ projected_points: 211.4 })] });
  renderWithProviders(<PlayerManagement />);

  expect(
    await screen.findByRole("button", { name: "Filters" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(await screen.findByText("211.4 pts")).toBeInTheDocument();
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
  expect(screen.getByRole("button", { name: "Select league" })).toBeDisabled();
});
