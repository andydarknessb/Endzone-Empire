import React from "react";
import { screen, waitFor } from "@testing-library/react";
import { TableCell, TableRow } from "@mui/material";
import renderWithProviders from "../../../test-utils/renderWithProviders";
import apiClient from "../../../api/apiClient";
import { useLeague } from "../../../hooks/useLeague";
import PlayerPool from "./PlayerPool";

jest.mock("../../../api/apiClient", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
jest.mock("../../../hooks/useLeague", () => ({ useLeague: jest.fn() }));

const player = {
  id: 1,
  name: "Patrick Mahomes",
  position: "QB",
  nfl_team: "Kansas City Chiefs",
  availability: { state: "waivers", teamId: null, teamName: null, availableAt: null },
  projWeek: { week: 3, points: 22.4 },
  ros: { points: 210.5, perGame: 17.5, posRank: null, throughWeek: 17 },
  weeks: [{ week: 3, points: 22.4 }],
  ownership: null,
  upgrade: null,
  watching: false,
};

function renderPool(props = {}, route = "/") {
  return renderWithProviders(
    <PlayerPool
      leagueId="1"
      columnCount={1}
      renderTableHead={() => (
        <TableRow>
          <TableCell>Player</TableCell>
        </TableRow>
      )}
      renderRow={(row) => (
        <TableRow>
          <TableCell>{row.name}</TableCell>
        </TableRow>
      )}
      {...props}
    />,
    { route },
  );
}

beforeEach(() => {
  useLeague.mockReturnValue({ league: { id: 1 }, loading: false, error: null });
  apiClient.get.mockResolvedValue({
    data: { players: [player], totalPages: 1, total: 1, context: null },
  });
});
afterEach(() => jest.clearAllMocks());

const playerReads = () => apiClient.get.mock.calls.filter(([url]) => url === "/api/players");

test("unlocked, the Availability control renders and All sends no availability", async () => {
  renderPool();
  await waitFor(() => expect(playerReads()).toHaveLength(1));
  expect(screen.getByRole("radiogroup", { name: "Availability" })).toBeInTheDocument();
  expect(playerReads()[0][1].params.availability).toBeUndefined();
});

test("locked, every read sends the locked Availability and no Availability control renders", async () => {
  // A stale ?availability= in the URL must not override the lock.
  renderPool({ availabilityLock: "waivers" }, "/?availability=rostered&page=2&q=mah");
  await waitFor(() => expect(playerReads().length).toBeGreaterThan(0));
  playerReads().forEach(([, config]) => expect(config.params.availability).toBe("waivers"));
  expect(screen.queryByRole("radiogroup", { name: "Availability" })).not.toBeInTheDocument();
  expect(screen.queryByText("Free agents")).not.toBeInTheDocument();
  expect(await screen.findByText("Patrick Mahomes")).toBeInTheDocument();
});
