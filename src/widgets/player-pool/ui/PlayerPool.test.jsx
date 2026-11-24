import React, { createRef } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
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

const josh = { ...player, id: 2, name: "Josh Allen" };
const joe = { ...player, id: 3, name: "Joe Burrow" };
const page = (players, total = players.length) => ({
  data: { players, totalPages: 1, total, context: null },
});
// A read the test settles by hand, so it can finish after a newer read.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

test("byeWeekFilter sends the ?bye= week as byeWeeks, and without the prop the param is ignored", async () => {
  renderPool({ byeWeekFilter: true }, "/?bye=7");
  await waitFor(() => expect(playerReads().length).toBeGreaterThan(0));
  expect(playerReads()[0][1].params.byeWeeks).toBe("7");
  expect(screen.getByRole("combobox", { name: "Bye week" })).toBeInTheDocument();
});

test("no byeWeekFilter prop: no Bye week control and no byeWeeks param", async () => {
  renderPool({}, "/?bye=7");
  await waitFor(() => expect(playerReads().length).toBeGreaterThan(0));
  expect(playerReads()[0][1].params.byeWeeks).toBeUndefined();
  expect(screen.queryByRole("combobox", { name: "Bye week" })).not.toBeInTheDocument();
});

test("emptyCopy replaces the default empty message", async () => {
  apiClient.get.mockResolvedValue({ data: { players: [], totalPages: 1, total: 0, context: null } });
  renderPool({ emptyCopy: "No players are on waivers" });
  expect(await screen.findByText("No players are on waivers")).toBeInTheDocument();
});

test("a held older read that resolves after a newer one does not overwrite rows, count or onLoaded", async () => {
  const held = deferred();
  const onLoaded = jest.fn();
  apiClient.get.mockImplementation((url, { params }) =>
    params.search === "jo" ? held.promise : Promise.resolve(page([josh])),
  );
  renderPool({ onLoaded }, "/?q=jo");
  await waitFor(() => expect(playerReads()).toHaveLength(1));
  fireEvent.change(screen.getByRole("textbox", { name: "Search players" }), { target: { value: "josh" } });
  expect(await screen.findByText("Josh Allen")).toBeInTheDocument();
  await act(async () => held.resolve(page([joe], 3)));
  expect(screen.queryByText("Joe Burrow")).not.toBeInTheDocument();
  expect(screen.getByText("1 player matching “josh”")).toBeInTheDocument();
  expect(onLoaded).toHaveBeenLastCalledWith({ players: [josh], context: null, total: 1 });
});

test("a held older read that rejects after a newer one resolved reports nothing", async () => {
  const held = deferred();
  const onError = jest.fn();
  apiClient.get.mockImplementation((url, { params }) =>
    params.search === "jo" ? held.promise : Promise.resolve(page([josh])),
  );
  renderPool({ onError }, "/?q=jo");
  await waitFor(() => expect(playerReads()).toHaveLength(1));
  fireEvent.change(screen.getByRole("textbox", { name: "Search players" }), { target: { value: "josh" } });
  expect(await screen.findByText("Josh Allen")).toBeInTheDocument();
  await act(async () => held.reject(new Error("jo timed out")));
  expect(onError).not.toHaveBeenCalledWith("jo timed out");
  expect(screen.getByText("Josh Allen")).toBeInTheDocument();
});

test("while the first read is held, the list is loading: skeleton rows, aria-busy, no empty message, pager or count", async () => {
  const held = deferred();
  apiClient.get.mockReturnValue(held.promise);
  renderPool();
  expect(screen.getByTestId("player-pool-loading")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Players" })).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("No players found")).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByText(/^\d+ players?/)).not.toBeInTheDocument();
  await act(async () => held.resolve(page([])));
  expect(screen.queryByTestId("player-pool-loading")).not.toBeInTheDocument();
  expect(screen.getByText("No players found")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("0 players");
});

test("a later read keeps the rows on screen and marks the list aria-busy until it lands", async () => {
  const ref = createRef();
  const held = deferred();
  apiClient.get.mockResolvedValueOnce(page([josh])).mockReturnValueOnce(held.promise);
  renderPool({ ref });
  expect(await screen.findByText("Josh Allen")).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Players" });
  expect(table).not.toHaveAttribute("aria-busy", "true");
  act(() => {
    ref.current.refresh();
  });
  expect(table).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("Josh Allen")).toBeInTheDocument();
  expect(screen.queryByTestId("player-pool-loading")).not.toBeInTheDocument();
  await act(async () => held.resolve(page([josh])));
  expect(table).not.toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("Josh Allen")).toBeInTheDocument();
});

test("a first read that rejects draws neither the skeleton nor the empty message", async () => {
  const onError = jest.fn();
  apiClient.get.mockRejectedValue(new Error("boom"));
  renderPool({ onError });
  await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("player-pool-loading")).not.toBeInTheDocument();
  expect(screen.queryByText("No players found")).not.toBeInTheDocument();
});

test("ref.refresh() starts a read that supersedes the one before it", async () => {
  const ref = createRef();
  const held = deferred();
  apiClient.get.mockReturnValueOnce(held.promise).mockResolvedValueOnce(page([josh]));
  renderPool({ ref });
  await waitFor(() => expect(playerReads()).toHaveLength(1));
  act(() => {
    ref.current.refresh();
  });
  expect(await screen.findByText("Josh Allen")).toBeInTheDocument();
  await act(async () => held.resolve(page([joe], 3)));
  expect(screen.queryByText("Joe Burrow")).not.toBeInTheDocument();
  expect(screen.getByText("1 player")).toBeInTheDocument();
});
