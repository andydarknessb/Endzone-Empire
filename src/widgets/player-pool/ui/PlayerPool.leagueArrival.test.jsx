import React, { useState } from "react";
import { act, screen } from "@testing-library/react";
import { TableCell, TableRow } from "@mui/material";
import renderWithProviders from "../../../test-utils/renderWithProviders";
import apiClient from "../../../api/apiClient";
import { invalidate } from "../../../lib/resourceCache";
import PlayerPool from "./PlayerPool";

// The real useLeague and useResource on purpose: the extra read came from what
// the hook reported on the commit a league arrived, which a mocked useLeague
// cannot show.
jest.mock("../../../api/apiClient", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const LEAGUE = {
  league: {
    id: 1,
    name: "MinneApple",
    best_ball: false,
    roster_slots: [
      { key: "QB", label: "QB", count: 1, eligiblePositions: ["QB"] },
      { key: "RB", label: "RB", count: 2, eligiblePositions: ["RB"] },
      { key: "WR", label: "WR", count: 2, eligiblePositions: ["WR"] },
    ],
  },
  teams: [],
  viewerTeamId: 7,
};

const PAGE = {
  players: [
    {
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
    },
  ],
  totalPages: 1,
  total: 1,
  context: null,
};

let selectLeague;

function PoolWhoseLeagueArrivesLater() {
  const [leagueId, setLeagueId] = useState("");
  selectLeague = setLeagueId;
  return (
    <PlayerPool
      leagueId={leagueId}
      // PlayerManagement's own rule: nothing is read until a league is selected.
      ready={leagueId !== ""}
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
    />
  );
}

const readsOf = (url) => apiClient.get.mock.calls.filter(([called]) => called === url);

beforeEach(() => invalidate(undefined, { reload: false }));
afterEach(() => invalidate(undefined, { reload: false }));

test("a league arriving after mount reads the players once, after its template has loaded", async () => {
  let resolveLeague;
  apiClient.get.mockImplementation((url) => {
    if (url === "/api/league/1") return new Promise((resolve) => { resolveLeague = resolve; });
    if (url === "/api/players") return Promise.resolve({ data: PAGE });
    return Promise.reject(new Error(`unexpected read: ${url}`));
  });
  renderWithProviders(<PoolWhoseLeagueArrivesLater />);

  act(() => selectLeague("1"));

  expect(readsOf("/api/league/1")).toHaveLength(1);
  expect(readsOf("/api/players")).toHaveLength(0);

  await act(async () => resolveLeague({ data: LEAGUE }));

  expect(await screen.findByText("Patrick Mahomes")).toBeInTheDocument();
  expect(readsOf("/api/players")).toHaveLength(1);
  expect(readsOf("/api/players")[0][1].params).toMatchObject({ leagueId: 1, view: "cards", sort: "upgrade", page: 1 });
});
