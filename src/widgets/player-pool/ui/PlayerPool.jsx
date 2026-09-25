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
import {
  Button,
  Checkbox,
  Drawer,
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import FilterListIcon from "@mui/icons-material/FilterList";
import SearchIcon from "@mui/icons-material/Search";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import apiClient from "../../../api/apiClient";
import { readHttpFailure } from "../../../lib/httpFailure";
import { useLeague } from "../../../hooks/useLeague";
import { wireSortName } from "../../../components/DraftBoard/sortFields";
import { SegmentedControl } from "../../../shared/ui";
import { parseRosterSlots, chipsForRosterSlots } from "../../../shared/lib";
import { SORT_OPTIONS, DEFAULT_SORT_KEY, sortKeyFromParam } from "../model/sortKeys";

// Order matches the segmented control's own left-to-right order (#1310,
// Players.dc.html): All, Free agents, On waivers, Rostered, My team.
const AVAILABILITY_FILTERS = [
  { value: "all", label: "All" },
  { value: "free_agent", label: "Free agents" },
  { value: "waivers", label: "On waivers" },
  { value: "rostered", label: "Rostered" },
  { value: "my_team", label: "My team" },
];
const BYE_WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);
const headCellSx = {
  fontWeight: 800,
  color: "primary.contrastText",
  bgcolor: "primary.main",
  borderColor: "var(--border-subtle)",
};
// The 44px floor for the small-size inputs, selects and pager items this
// widget renders (the Waivers page's layout guard measures every control).
const fieldSx = {
  "& .MuiInputBase-root": { minHeight: 44 },
  "& .MuiInputBase-input": { boxSizing: "border-box", minHeight: 44 },
  "& .MuiSelect-select.MuiSelect-select": { boxSizing: "border-box", minHeight: 44, display: "flex", alignItems: "center" },
};
const actionSx = {
  minHeight: 44,
  minWidth: 104,
  borderRadius: 2,
  fontWeight: 800,
};

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
 * page is unchanged. `cardsBelow` is the breakpoint under which rows render as
 * cards (default `md`, the Filters drawer's own breakpoint; the Waivers page
 * passes `sm`). `emptyCopy` replaces the default empty message.
 *
 * `availabilityLock`: when set, every read sends that Availability and no
 * Availability control renders; the `availability` URL param is ignored.
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

  // The same filters render twice: stacked inside the mobile Filters drawer,
  // and as one wrapping row on desktop. On desktop the segmented control keeps
  // its natural width and does not scroll; only the drawer, a touch surface,
  // gets `scrollable` and 44px segments.
  const renderControls = (layout) => {
    const row = layout === "row";
    return (
      <Stack
        direction={row ? "row" : "column"}
        spacing={1.5}
        useFlexGap
        flexWrap={row ? "wrap" : undefined}
        alignItems={row ? "center" : undefined}
      >
        {leadingControl?.(layout)}
        <FormControl size="small" fullWidth={!row} sx={row ? { ...fieldSx, minWidth: 130 } : fieldSx}>
          <InputLabel id="pm-pos-label">Position</InputLabel>
          <Select
            labelId="pm-pos-label"
            label="Position"
            value={selectedChip.key}
            onChange={(event) =>
              updateParams({
                pos: event.target.value === "All" ? "" : event.target.value,
                page: 1,
              })
            }
          >
            {chips.map((chip) => (
              <MenuItem key={chip.key} value={chip.key}>
                {chip.key}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {!availabilityLock && (
          <SegmentedControl
            aria-label="Availability"
            options={AVAILABILITY_FILTERS}
            value={availabilityFilter}
            onChange={(value) => updateParams({ availability: value, page: 1 })}
            scrollable={!row}
            // The drawer is a touch surface: its segments need the 44px minimum
            // every other action carries.
            sx={row ? undefined : { "& [role='radio']": { minHeight: 44 } }}
          />
        )}
        {afterAvailabilityControl?.(layout)}
        {byeWeekFilter && (
          <FormControl size="small" fullWidth={!row} sx={row ? { ...fieldSx, minWidth: 130 } : fieldSx}>
            <InputLabel id="pm-bye-label">Bye week</InputLabel>
            <Select
              labelId="pm-bye-label"
              label="Bye week"
              value={byeWeek ? String(byeWeek) : ""}
              onChange={(event) => updateParams({ bye: event.target.value, page: 1 })}
            >
              <MenuItem value="">Any</MenuItem>
              {BYE_WEEKS.map((week) => (
                <MenuItem key={week} value={String(week)}>
                  {`Wk ${week}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControlLabel
          control={
            <Checkbox
              checked={watchingOnly}
              onChange={(event) => updateParams({ watching: event.target.checked || "" })}
              sx={{ minWidth: 44, minHeight: 44 }}
            />
          }
          label="Watching"
        />
        <Stack direction="row" spacing={1} sx={row ? { ml: "auto" } : undefined}>
          <FormControl size="small" fullWidth={!row} sx={row ? { ...fieldSx, minWidth: 170 } : fieldSx}>
            <InputLabel id="pm-sort-label">Sort</InputLabel>
            <Select
              labelId="pm-sort-label"
              label="Sort"
              value={sort}
              onChange={(event) =>
                updateParams({
                  sort: event.target.value === contextualDefaultSort ? "" : event.target.value,
                  page: 1,
                })
              }
            >
              {sortOptions.map((option) => (
                <MenuItem key={option.key} value={option.key}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            aria-label={`Sort ${dir === "asc" ? "ascending" : "descending"}`}
            onClick={() => updateParams({ dir: dir === "asc" ? "desc" : "", page: 1 })}
            sx={{ minWidth: 44, minHeight: 44 }}
          >
            <SwapVertIcon />
          </Button>
        </Stack>
      </Stack>
    );
  };

  return (
    <>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
        <Stack spacing={1.25}>
          <TextField
            size="small"
            fullWidth
            // The search sits on its own line above the filter row on desktop.
            sx={isMobile ? fieldSx : { ...fieldSx, maxWidth: 360 }}
            label="Search players"
            placeholder="Search by name"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: searchInput ? (
                <InputAdornment position="end">
                  <Button
                    onClick={() => setSearchInput("")}
                    aria-label="Clear search"
                    sx={{ minWidth: 44, minHeight: 44, p: 0.5 }}
                  >
                    <CloseIcon fontSize="small" />
                  </Button>
                </InputAdornment>
              ) : null,
            }}
          />
          {isMobile ? (
            <Button
              variant="outlined"
              startIcon={<FilterListIcon />}
              onClick={() => setFiltersOpen(true)}
              sx={{ ...actionSx, whiteSpace: "nowrap" }}
            >
              Filters
            </Button>
          ) : (
            renderControls("row")
          )}
        </Stack>
      </Paper>
      <Drawer
        anchor="bottom"
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        PaperProps={{
          sx: { borderTopLeftRadius: 24, borderTopRightRadius: 24, p: 2.5 },
        }}
      >
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6" sx={{ fontWeight: 900 }}>
              Player filters
            </Typography>
            <Button onClick={() => setFiltersOpen(false)} sx={actionSx}>
              Done
            </Button>
          </Stack>
          {renderControls("column")}
        </Stack>
      </Drawer>
      {!cardLayout && (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
          {/* Cell padding at 10px a side rather than MUI's 16px: it is what lets
              the table fit a 1024px viewport instead of hiding the Action
              column behind a scrollbar (2026-09-15 report). */}
          <Table aria-label="Players" sx={{ minWidth: 960, "& th, & td": { px: 1.25 } }}>
            <TableHead>
              {renderTableHead({ bestBall, currentWeek, sx: headCellSx })}
            </TableHead>
            <TableBody>
              {visiblePlayers.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={columnCount}
                    align="center"
                    sx={{ py: 6, color: "text.secondary" }}
                  >
                    {emptyCopy}
                  </TableCell>
                </TableRow>
              )}
              {visiblePlayers.map((player) => (
                <React.Fragment key={player.id}>{renderRow(player, "row")}</React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {cardLayout && (
        <Stack spacing={1.25}>
          {visiblePlayers.length === 0 && (
            <Paper variant="outlined" sx={{ p: 4, textAlign: "center", borderRadius: 3 }}>
              <Typography color="text.secondary">{emptyCopy}</Typography>
            </Paper>
          )}
          {visiblePlayers.map((player) => (
            <React.Fragment key={player.id}>{renderRow(player, "card")}</React.Fragment>
          ))}
        </Stack>
      )}
      <Stack alignItems="center" spacing={0.75} sx={{ py: 3 }}>
        <Pagination
          count={totalPages}
          page={pageNumber}
          onChange={(event, value) => updateParams({ page: value })}
          shape="rounded"
          sx={{ "& .MuiPaginationItem-root": { minWidth: 44, height: 44 } }}
        />
        <Typography variant="caption" color="text.secondary">
          {totalPlayers} player{totalPlayers === 1 ? "" : "s"}
          {search ? ` matching “${search}”` : ""}
        </Typography>
      </Stack>
    </>
  );
});

export default PlayerPool;
