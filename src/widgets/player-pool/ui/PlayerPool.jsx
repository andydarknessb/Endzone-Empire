import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useMediaQuery, useTheme } from "@mui/material";
import apiClient from "../../../api/apiClient";
import { readHttpFailure } from "../../../lib/httpFailure";
import { useLeague } from "../../../hooks/useLeague";
import { wireSortName } from "../../../components/DraftBoard/sortFields";
import { parseRosterSlots, chipsForRosterSlots } from "../../../shared/lib";
import { SORT_OPTIONS, DEFAULT_SORT_KEY, sortKeyFromParam } from "../model/sortKeys";
import PlayerPoolPlayselect from "./PlayerPoolPlayselect";

// Order matches the segmented control's own left-to-right order (#1310,
// Players.dc.html): All, Free agents, On waivers, Rostered, My team.
const AVAILABILITY_FILTERS = [
  { value: "all", label: "All" },
  { value: "free_agent", label: "Free agents" },
  { value: "waivers", label: "On waivers" },
  { value: "rostered", label: "Rostered" },
  { value: "my_team", label: "My team" },
];

/**
 * The player list: search, position chips, Watching toggle, sort, pager and
 * `player-row` in its row and card variants, over the one `/api/players` read
 * (`view=cards`) and the URL params those controls read and write (`page`,
 * `pos`, `q`, `sort`, `dir`, `availability`, `watching`).
 *
 * The caller owns everything that varies per surface. ADR 0020: widgets do not
 * import each other, so the page passes `player-row` in: `renderRow(player,
 * variant)` returns a row ("row" or "card") built with the page's own action,
 * Watch action and open handler, and `renderTableHead({ bestBall, currentWeek,
 * sx })` returns the desktop header, `columnCount` is its width. The caller also passes the filter-row
 * controls that are not the list's own (`leadingControl`, `afterAvailabilityControl`).
 * `onLoaded({ players, context, total })` reports every successful read so the caller
 * can build the Decision card context over the same page of players; `onError`
 * receives the refusal message, or null when a read starts. `ref.refresh()`
 * re-reads the list after a caller's action.
 *
 * `byeWeekFilter`: renders a Bye week control (`?bye=`, one week) that sends
 * `byeWeeks`, the read's include-only filter; off by default, so the Players
 * page is unchanged. `stickyHead` makes the desktop table head stick to the
 * viewport top from `lg` (default off). `cardsBelow` is the breakpoint under which rows render as
 * cards (default `md`, the Filters drawer's own breakpoint; the Waivers page
 * passes `sm`). `emptyCopy` replaces the default empty message.
 *
 * `availabilityLock`: when set, every read sends that Availability and no
 * Availability control renders; the `availability` URL param is ignored.
 *
 * ADR 0067 wave 3: the reads, params and callbacks are drawn on `ps-*` tokens by `PlayerPoolPlayselect`.
 */
const PlayerPool = forwardRef(function PlayerPool(
  {
    leagueId = "",
    bestBall = false,
    ready = true,
    availabilityLock,
    renderRow,
    renderTableHead,
    columnCount,
    onLoaded,
    onError,
    leadingControl,
    afterAvailabilityControl,
    byeWeekFilter = false,
    stickyHead = false,
    cardsBelow = "md",
    emptyCopy: emptyCopyOverride,
  },
  ref,
) {
  const [players, setPlayers] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const cardLayout = useMediaQuery(theme.breakpoints.down(cardsBelow));
  const [searchParams, setSearchParams] = useSearchParams();
  const pageNumber = Math.max(1, Number(searchParams.get("page")) || 1);
  const selectedLeague = leagueId ? String(leagueId) : "";
  const positionFilter = searchParams.get("pos") || "All";
  const availabilityFilter = availabilityLock || searchParams.get("availability") || "all";
  // #1312 Ruling: the Watching toggle filters client-side on the page already
  // fetched - never sent to the server, never a fifth Availability segment.
  const watchingOnly = searchParams.get("watching") === "true";
  const search = searchParams.get("q") || "";
  const byeParam = Number(searchParams.get("bye"));
  const byeWeek = byeWeekFilter && Number.isInteger(byeParam) && byeParam >= 1 && byeParam <= 18 ? byeParam : null;
  const dir = searchParams.get("dir") || "asc";

  // Callbacks held in refs so a caller passing fresh closures each render
  // never changes fetchPlayers' identity (and so never refetches).
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);
  onLoadedRef.current = onLoaded;
  onErrorRef.current = onError;

  // The selected league's own roster template, through the shared league hook
  // (#1419). No league selected reads as an absent template too.
  const { league: templateLeague, loading: templateLeagueLoading } = useLeague(
    selectedLeague || undefined,
  );
  // The template has never loaded only while BOTH are true - `loading` alone
  // also flags a stale-while-revalidate reload of an already-loaded row.
  const templateNeverLoaded = templateLeagueLoading && !templateLeague;
  // Keyed on the roster_slots FIELD, not the wrapper object: useLeague hands
  // back a new object on every reload, which would rebuild chips and refetch.
  const rosterSlots = useMemo(
    () => parseRosterSlots(templateLeague?.roster_slots),
    [templateLeague?.roster_slots],
  );
  const chips = useMemo(() => chipsForRosterSlots(rosterSlots), [rosterSlots]);
  const selectedChip = useMemo(
    () => chips.find((chip) => chip.key === positionFilter) || chips[0],
    [chips, positionFilter],
  );
  // The chip's request shape reduced to PRIMITIVES so fetchPlayers' identity
  // tracks only a real change in what would be sent.
  const positionParam = selectedChip.key !== "All" && !selectedChip.positions
    ? selectedChip.key
    : undefined;
  const positionsParam = selectedChip.positions ? selectedChip.positions.join(",") : undefined;
  // Upgrade is the default sort whenever a league is selected and it is not
  // best ball (the server gates `view=cards`/`sort=upgrade` on the same
  // condition) - an explicit `?sort=` still wins.
  const contextualDefaultSort = selectedLeague && !bestBall ? "upgrade" : DEFAULT_SORT_KEY;
  const sort = sortKeyFromParam(searchParams.get("sort")) || contextualDefaultSort;
  // Upgrade joins the Sort options only when it is a real, selectable sort.
  const sortOptions = selectedLeague && !bestBall
    ? [...SORT_OPTIONS, { key: "upgrade", label: "Upgrade" }]
    : SORT_OPTIONS;
  const [searchInput, setSearchInput] = useState(search);

  const updateParams = useCallback(
    (updates) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        Object.entries(updates).forEach(([key, value]) => {
          if (value === "" || value == null || value === false || value === "all") next.delete(key);
          else next.set(key, String(value));
        });
        return next;
      });
    },
    [setSearchParams],
  );

  // A chip that no longer exists in the selected league's template resets the
  // filter to "All". Waits for the template to finish loading first.
  useEffect(() => {
    if (templateLeagueLoading) return;
    if (positionFilter === "All") return;
    if (chips.some((chip) => chip.key === positionFilter)) return;
    updateParams({ pos: "" });
  }, [chips, positionFilter, templateLeagueLoading, updateParams]);

  const fetchPlayers = useCallback(async () => {
    if (!ready) return;
    // Holds the request while the SELECTED league's roster template has never
    // loaded, so a request under the fallback template can never race the
    // correctly-filtered one.
    if (selectedLeague && templateNeverLoaded) return;
    try {
      onErrorRef.current?.(null);
      const params = {
        page: pageNumber,
        sort: sort === "upgrade" ? "upgrade" : wireSortName(sort),
      };
      // "All" sends no position filter; a flex-type chip sends the union of its
      // slot's eligible positions to `positions`; any other chip sends `position`.
      if (positionsParam) params.positions = positionsParam;
      else if (positionParam) params.position = positionParam;
      // view=cards (#1309/#1310) requires leagueId.
      if (selectedLeague) {
        params.leagueId = Number(selectedLeague);
        params.view = "cards";
      }
      if (availabilityFilter !== "all") params.availability = availabilityFilter;
      if (dir === "desc") params.dir = "desc";
      if (search) params.search = search;
      if (byeWeek) params.byeWeeks = String(byeWeek);
      const response = await apiClient.get("/api/players", { params });
      const nextPlayers = response.data.players || [];
      setPlayers(nextPlayers);
      setTotalPages(response.data.totalPages || 1);
      setTotalPlayers(response.data.total ?? 0);
      onLoadedRef.current?.({
        players: nextPlayers,
        context: response.data.context || null,
        total: response.data.total ?? 0,
      });
    } catch (err) {
      onErrorRef.current?.(readHttpFailure(err).message || err.message);
    }
  }, [
    availabilityFilter,
    byeWeek,
    dir,
    pageNumber,
    positionParam,
    positionsParam,
    ready,
    search,
    selectedLeague,
    sort,
    templateNeverLoaded,
  ]);
  useEffect(() => {
    fetchPlayers();
  }, [fetchPlayers]);
  useImperativeHandle(ref, () => ({ refresh: fetchPlayers }), [fetchPlayers]);
  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = searchInput.trim();
      if (trimmed !== search) updateParams({ q: trimmed, page: 1 });
    }, 300);
    return () => clearTimeout(handle);
  }, [search, searchInput, updateParams]);
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const currentWeek = players.find((player) => player.projWeek)?.projWeek?.week;
    const visiblePlayers = watchingOnly ? players.filter((player) => player.watching) : players;
  const emptyCopy = emptyCopyOverride && !watchingOnly && !search && !byeWeek
    ? emptyCopyOverride
    : watchingOnly
    ? "No watched players on this page"
    : search
    ? `No players matching “${search}”`
    : "No players found";

  return (
    <PlayerPoolPlayselect
      isMobile={isMobile}
      cardLayout={cardLayout}
      filtersOpen={filtersOpen}
      setFiltersOpen={setFiltersOpen}
      searchInput={searchInput}
      setSearchInput={setSearchInput}
      chips={chips}
      positionKey={selectedChip.key}
      onPosition={(value) => updateParams({ pos: value === "All" ? "" : value, page: 1 })}
      byeWeekFilter={byeWeekFilter}
      byeWeek={byeWeek}
      onBye={(value) => updateParams({ bye: value, page: 1 })}
      sort={sort}
      sortOptions={sortOptions}
      onSort={(value) => updateParams({ sort: value === contextualDefaultSort ? "" : value, page: 1 })}
      dir={dir}
      onDir={() => updateParams({ dir: dir === "asc" ? "desc" : "", page: 1 })}
      watchingOnly={watchingOnly}
      onWatching={(checked) => updateParams({ watching: checked || "" })}
      availabilityLock={availabilityLock}
      availabilityFilter={availabilityFilter}
      availabilityOptions={AVAILABILITY_FILTERS}
      onAvailability={(value) => updateParams({ availability: value, page: 1 })}
      leadingControl={leadingControl}
      afterAvailabilityControl={afterAvailabilityControl}
      visiblePlayers={visiblePlayers}
      renderRow={renderRow}
      renderTableHead={renderTableHead}
      stickyHead={stickyHead}
      columnCount={columnCount}
      bestBall={bestBall}
      currentWeek={currentWeek}
      emptyCopy={emptyCopy}
      totalPages={totalPages}
      pageNumber={pageNumber}
      onPage={(value) => updateParams({ page: value })}
      totalPlayers={totalPlayers}
      search={search}
    />
  );
});

export default PlayerPool;
