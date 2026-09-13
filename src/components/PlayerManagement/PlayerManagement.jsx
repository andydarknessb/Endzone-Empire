import React, { useCallback, useEffect, useState } from "react";
import {
  Link as RouterLink,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Drawer,
  FormControl,
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
  Chip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import FilterListIcon from "@mui/icons-material/FilterList";
import SearchIcon from "@mui/icons-material/Search";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import apiClient from "../../api/apiClient";
import { readHttpFailure } from "../../lib/httpFailure";
import PlayerDecisionCard from "../../widgets/player-decision-card";
import { toDecisionCardEntry } from "../../entities/player";
import PlayerRow from "../../widgets/player-row";
import SegmentedControl from "../../shared/ui/SegmentedControl";
import { useAddPlayer } from "../../features/add-player";
import { useClaimPlayer } from "../../features/claim-player";
import { proposeTradeHref } from "../../features/propose-trade";
import { rosterActionForPhase } from "../../lib/leaguePhase";
import { isPickemOnly } from "../../lib/leagueType";
import {
  SORT_FIELDS,
  SORT_FIELDS_BY_KEY,
  wireSortName,
} from "../DraftBoard/sortFields";

const POSITIONS = [
  "All",
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
  "DE",
  "DT",
  "LB",
  "CB",
  "S",
  "DB",
];
// Order matches the segmented control's own left-to-right order (#1310,
// Players.dc.html): All, Free agents, On waivers, Rostered, My team.
const AVAILABILITY_FILTERS = [
  { value: "all", label: "All" },
  { value: "free_agent", label: "Free agents" },
  { value: "waivers", label: "On waivers" },
  { value: "rostered", label: "Rostered" },
  { value: "my_team", label: "My team" },
];
// The Player Browser's sort options, derived from the Draft room's
// sortFields.js entries rather than from a second hand-maintained list of the
// same fields over the same endpoint (issue #1002). One vocabulary now crosses
// the module boundary: this surface's sort STATE holds sortFields KEYS, and the
// server's `?sort=` field name is produced once, at the fetch site, by
// wireSortName - exactly as the Draft room does it. Before this, the state held
// wire names directly, so the `proj` field's wire name was written out as a
// literal here, in the URL, and at four header call sites, free to drift from
// sortFields.js. No sort field's wire name is spelled anywhere in this file
// now; sortFields.js is the only place any of them appears.
//
// The visible option text is the one fact NOT taken from sortFields.js: the
// Player Browser's copy for three of these fields is its own and predates the
// Draft room's. #1002 reconciles the KEYS, not the copy - changing what either
// surface calls a column is out of scope - so the overrides below are keyed by
// the Draft room's label rather than by a sort key, which keeps this file free
// of sort-field identifiers entirely. A Draft room relabel drops its override
// and shows the shared label instead: visible, and correct either way.
const OPTION_LABEL_OVERRIDES = {
  "Pos rank": "Position rank",
  Bye: "Bye week",
  "17-game pace": "Pool projection",
};

const SORT_OPTIONS = SORT_FIELDS.map((field) => ({
  key: field.key,
  label: OPTION_LABEL_OVERRIDES[field.label] || field.label,
}));

// The Player Browser's default sort. Omitted from the URL rather than written
// into it (see updateParams' empty-value deletion), so `?sort=` absent means
// this key. It is the same default wireSortName falls back to.
//
// #1310 leaves the API's own `sort=upgrade` (view=cards' new default-sort
// candidate per the issue body) off this control: it requires a leagueId the
// URL-restored state can't always guarantee ahead of the league fetch, and
// no acceptance criterion here tests a default sort order - a dedicated
// "Sort by Upgrade" control is a follow-up, not this ticket's Ruling.
const DEFAULT_SORT_KEY = "adp";

// The `?sort=` URL param, resolved to a sortFields KEY.
//
// The param carried WIRE names before #1002, and one field's wire name differs
// from its key, so a bookmark or a shared link made before this change would
// otherwise resolve to the default and silently re-sort the page. A wire name
// is therefore still accepted on READ and mapped back to its key; only keys are
// ever WRITTEN into the URL. Anything else falls back to the default rather
// than reaching the API verbatim.
function sortKeyFromParam(value) {
  if (!value) return DEFAULT_SORT_KEY;
  if (SORT_FIELDS_BY_KEY[value]) return value;
  const legacy = SORT_FIELDS.find((field) => field.wire === value);
  return legacy ? legacy.key : DEFAULT_SORT_KEY;
}
const headCellSx = {
  fontWeight: 800,
  color: "primary.contrastText",
  bgcolor: "primary.main",
  borderColor: "var(--border-subtle)",
};
const actionSx = {
  minHeight: 44,
  minWidth: 104,
  borderRadius: 2,
  fontWeight: 800,
};

function availabilityOf(player) {
  return player.availability?.state || "free_agent";
}

// The Players list's own base column count (Player, Proj Wk, ROS, Ownership,
// Weeks, Status, Action) - Upgrade adds one more, hidden outright in a best
// ball league (#1310, ADR 0040 Lead correction item 5) rather than shown null.
const BASE_COLUMN_COUNT = 7;

function PlayerManagement() {
  const [leagues, setLeagues] = useState([]);
  const [leaguesLoaded, setLeaguesLoaded] = useState(false);
  const [players, setPlayers] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [context, setContext] = useState(null);
  const [error, setError] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Formal review round 1, f3: the Decision card's free-agent action bar
  // needs the caller's own roster for its at-capacity drop pick (the same
  // read WaiverWire already makes) - without it the required Select has no
  // options and Add never enables.
  const [roster, setRoster] = useState([]);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [searchParams, setSearchParams] = useSearchParams();
  const pageNumber = Math.max(1, Number(searchParams.get("page")) || 1);
  const selectedLeague = searchParams.get("league") || "";
  const positionFilter = searchParams.get("pos") || "All";
  const availabilityFilter = searchParams.get("availability") || "all";
  const search = searchParams.get("q") || "";
  const sort = sortKeyFromParam(searchParams.get("sort"));
  const dir = searchParams.get("dir") || "asc";
  const [searchInput, setSearchInput] = useState(search);
  const activeLeague = leagues.find(
    (league) => String(league.id) === selectedLeague,
  );
  const rosterAction = rosterActionForPhase(activeLeague);
  const bestBall = !!activeLeague?.best_ball;

  const updateParams = useCallback(
    (updates) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        Object.entries(updates).forEach(([key, value]) => {
          if (
            value === "" ||
            value == null ||
            value === false ||
            value === "all"
          )
            next.delete(key);
          else next.set(key, String(value));
        });
        return next;
      });
    },
    [setSearchParams],
  );
  const report = useCallback(
    (err) => setError(readHttpFailure(err).message || err.message),
    [],
  );

  useEffect(() => {
    (async () => {
      try {
        const response = await apiClient.get("/api/league");
        const rosterLeagues = response.data.filter(
          (league) => !isPickemOnly(league),
        );
        setLeagues(rosterLeagues);
        setLeaguesLoaded(true);
        if (
          rosterLeagues.length > 0 &&
          !rosterLeagues.some((league) => String(league.id) === selectedLeague)
        )
          updateParams({ league: rosterLeagues[0].id, page: 1 });
      } catch (err) {
        report(err);
      }
    })();
  }, [report, selectedLeague, updateParams]);

  const fetchRoster = useCallback(async () => {
    if (!selectedLeague) {
      setRoster([]);
      return;
    }
    try {
      const response = await apiClient.get(
        `/api/team/roster?leagueId=${Number(selectedLeague)}`,
      );
      setRoster(response.data || []);
    } catch (err) {
      // Best-effort, like WaiverWire's own upgrade suggestions: a failed
      // roster read only means the at-capacity drop pick has no options,
      // never a page-level error.
      setRoster([]);
    }
  }, [selectedLeague]);
  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const fetchPlayers = useCallback(async () => {
    if (!leaguesLoaded) return;
    try {
      setError(null);
      // The one translation from this surface's sort KEY to the server's
      // `?sort=` field name (issue #1002). Every request the Player Browser
      // sent before this change still carries the identical value; only the
      // place the wire name is produced moved, from six literals to here.
      const params = {
        page: pageNumber,
        position: positionFilter,
        sort: wireSortName(sort),
      };
      // view=cards (#1309/#1310) requires leagueId - without a selected
      // league (browsing with no fantasy league yet) the request stays the
      // plain shape it always was, and the row falls back to "Select league".
      if (selectedLeague) {
        params.leagueId = Number(selectedLeague);
        params.view = "cards";
      }
      if (availabilityFilter !== "all")
        params.availability = availabilityFilter;
      if (dir === "desc") params.dir = "desc";
      if (search) params.search = search;
      const response = await apiClient.get("/api/players", { params });
      setPlayers(response.data.players || []);
      setTotalPages(response.data.totalPages || 1);
      setTotalPlayers(response.data.total ?? 0);
      setContext(response.data.context || null);
    } catch (err) {
      report(err);
    }
  }, [
    availabilityFilter,
    dir,
    leaguesLoaded,
    pageNumber,
    positionFilter,
    report,
    search,
    selectedLeague,
    sort,
  ]);
  useEffect(() => {
    fetchPlayers();
  }, [fetchPlayers]);
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

  // Formal review round 2, f11: an add or a drop-and-add both change the
  // caller's own roster, so the drop pick a LATER at-capacity add offers
  // must be refreshed alongside the players list - WaiverWire's own
  // `fetchAll` already re-reads both for the identical reason.
  const refreshAfterAction = useCallback(
    () => Promise.all([fetchPlayers(), fetchRoster()]),
    [fetchPlayers, fetchRoster],
  );
  // Formal review round 1, f4: the row's own Add action now consumes the
  // SAME implementation the Decision card's free-agent bar does, rather than
  // a parallel POST that could drift from it (the lead correction's own
  // wording: "PlayerManagement then consumes the feature").
  const { addPlayer } = useAddPlayer({ leagueId: selectedLeague, onDone: refreshAfterAction });
  const addToRoster = useCallback(
    async (player) => {
      setError(null);
      const { ok, message } = await addPlayer({ playerId: player.id, playerName: player.name });
      if (!ok) setError(message);
    },
    [addPlayer],
  );
  // #1310, ADR 0040 Lead correction item 6: the row's Claim action goes
  // through the SAME claim-player feature WaiverWire's own claim dialog
  // submits with - a one-tap claim (no drop pick, no bid) straight from the
  // list, the row-level counterpart to Add's own direct call above. A
  // manager who needs a drop pick or a FAAB bid still reaches the fuller
  // Decision card action bar by opening the row's own Quick view.
  const { submitClaim } = useClaimPlayer({ leagueId: selectedLeague, onDone: refreshAfterAction });
  const claimFromRow = useCallback(
    async (player) => {
      setError(null);
      const { ok, message } = await submitClaim({ playerId: player.id, dropPlayerId: null, bid: 0 });
      if (!ok) setError(message);
    },
    [submitClaim],
  );
  const actionForPlayer = useCallback(
    (player) => {
      const state = availabilityOf(player);
      if (!selectedLeague)
        return {
          kind: "button",
          label: "Select league",
          disabled: true,
          helper: "Select a fantasy league to manage players.",
        };
      if (state === "waivers")
        return {
          kind: "button",
          label: "Claim",
          onClick: () => claimFromRow(player),
          helper: "Submit a waiver claim for this player.",
        };
      if (state === "my_team")
        return {
          kind: "link",
          to: `/league/${selectedLeague}/lineup`,
          label: "Lineup",
          variant: "text",
          helper: "Manage this player in Team Lineup.",
        };
      if (state === "rostered")
        return {
          kind: "link",
          to: proposeTradeHref({
            leagueId: selectedLeague,
            receivingTeamId: player.availability?.teamId,
            playerId: player.id,
          }),
          label: "Trade",
          variant: "outlined",
          helper: player.availability?.teamName
            ? `Propose a trade with ${player.availability.teamName}.`
            : "Propose a trade for this player.",
        };
      return {
        kind: "button",
        label: rosterAction.label,
        onClick: () => addToRoster(player),
        disabled: rosterAction.disabled,
        variant: "contained",
        helper: rosterAction.helper,
      };
    },
    [addToRoster, claimFromRow, rosterAction, selectedLeague],
  );
  const quickViewPlayer = players.find((player) => player.id === quickViewId);
  const marketContext =
    context ||
    (activeLeague
      ? {
          leagueName: activeLeague.name,
          waiverType: activeLeague.waiver_type,
          faabRemaining: activeLeague.my_team_faab_remaining,
          waiverPriority: activeLeague.my_team_waiver_priority,
        }
      : null);
  const quickViewContext = quickViewPlayer ? availabilityOf(quickViewPlayer) : "my_team";
  // #1307, ADR 0040: the availability action bar's own copy (roster count
  // for the drop-pick gate, priority/FAAB for a claim) - `rostered`'s team
  // name isn't on this route yet (ADR 0040's Plan, a later slice), so its
  // action bar renders the plain Propose-trade link with no team name line.
  const quickViewAvailability =
    quickViewContext === "free_agent"
      ? { rosterCount: marketContext?.rosterCount, rosterCapacity: marketContext?.rosterCapacity }
      : quickViewContext === "waivers"
      ? {
          waiverPriority: marketContext?.waiverType === "priority" ? marketContext?.waiverPriority : undefined,
          faabRemaining: marketContext?.waiverType === "faab" ? marketContext?.faabRemaining : undefined,
        }
      : undefined;
  const currentWeek = players.find((player) => player.projWeek)?.projWeek?.week;
  const columnCount = BASE_COLUMN_COUNT + (bestBall ? 0 : 1);
  const controls = (
    <Stack spacing={1.5}>
      <FormControl size="small" fullWidth>
        <InputLabel id="pm-league-label">League</InputLabel>
        <Select
          labelId="pm-league-label"
          label="League"
          value={
            leagues.some((league) => String(league.id) === selectedLeague)
              ? selectedLeague
              : ""
          }
          onChange={(event) =>
            updateParams({ league: event.target.value, page: 1 })
          }
        >
          {leagues.map((league) => (
            <MenuItem key={league.id} value={String(league.id)}>
              {league.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" fullWidth>
        <InputLabel id="pm-pos-label">Position</InputLabel>
        <Select
          labelId="pm-pos-label"
          label="Position"
          value={positionFilter}
          onChange={(event) =>
            updateParams({
              pos: event.target.value === "All" ? "" : event.target.value,
              page: 1,
            })
          }
        >
          {POSITIONS.map((position) => (
            <MenuItem key={position} value={position}>
              {position}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
          Availability
        </Typography>
        <SegmentedControl
          aria-label="Availability"
          options={AVAILABILITY_FILTERS}
          value={availabilityFilter}
          onChange={(value) => updateParams({ availability: value, page: 1 })}
          scrollable
        />
      </Box>
      <Stack direction="row" spacing={1}>
        <FormControl size="small" fullWidth>
          <InputLabel id="pm-sort-label">Sort</InputLabel>
          <Select
            labelId="pm-sort-label"
            label="Sort"
            value={sort}
            onChange={(event) =>
              updateParams({
                sort:
                  event.target.value === DEFAULT_SORT_KEY
                    ? ""
                    : event.target.value,
                page: 1,
              })
            }
          >
            {SORT_OPTIONS.map((option) => (
              <MenuItem key={option.key} value={option.key}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          aria-label={`Sort ${dir === "asc" ? "ascending" : "descending"}`}
          onClick={() =>
            updateParams({ dir: dir === "asc" ? "desc" : "", page: 1 })
          }
          sx={{ minWidth: 44, minHeight: 44 }}
        >
          <SwapVertIcon />
        </Button>
      </Stack>
    </Stack>
  );

  return (
    <Box
      component="main"
      sx={{
        width: "100%",
        maxWidth: 1280,
        mx: "auto",
        px: { xs: 1.5, sm: 3 },
        py: { xs: 2, md: 4 },
      }}
    >
      <Paper
        component="header"
        elevation={0}
        sx={{
          p: { xs: 2, sm: 3 },
          mb: 2,
          color: "var(--on-accent)",
          background: "var(--gradient-brand)",
          borderRadius: 4,
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          spacing={2}
          alignItems={{ sm: "center" }}
        >
          <Box>
            <Typography
              component="h1"
              variant="h4"
              sx={{ fontWeight: 900, letterSpacing: "-.03em" }}
            >
              Player Browser
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.82, mt: 0.5 }}>
              League-scoped player discovery and acquisition.
            </Typography>
          </Box>
          {selectedLeague && (
            <Button
              component={RouterLink}
              to={`/league/${selectedLeague}/lineup`}
              variant="outlined"
              color="inherit"
              sx={{ ...actionSx, borderColor: "var(--on-accent)" }}
            >
              Manage lineup
            </Button>
          )}
        </Stack>
      </Paper>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {leaguesLoaded && leagues.length === 0 && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button component={RouterLink} to="/league" color="inherit">
              Go to Leagues
            </Button>
          }
        >
          You&apos;re not in a fantasy league yet, so players can be browsed but
          not acquired.
        </Alert>
      )}
      {marketContext && (
        <Paper variant="outlined" sx={{ mb: 2, p: 1.5, borderRadius: 3 }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ sm: "center" }}
            justifyContent="space-between"
            spacing={1}
          >
            <Box>
              <Typography variant="subtitle2" component="p" sx={{ fontWeight: 800 }}>
                {marketContext.leagueName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Your player marketplace
              </Typography>
            </Box>
            <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75}>
              {marketContext.rosterCount != null && (
                <Chip
                  size="small"
                  label={`${marketContext.rosterCount} / ${marketContext.rosterCapacity ?? "-"} rostered`}
                />
              )}
              {marketContext.waiverType === "faab" && (
                <Chip
                  size="small"
                  color="secondary"
                  label={`FAAB $${marketContext.faabRemaining ?? "-"}`}
                />
              )}
              {marketContext.waiverType === "priority" && (
                <Chip
                  size="small"
                  color="secondary"
                  label={`Waiver priority ${marketContext.waiverPriority ?? "-"}`}
                />
              )}
            </Stack>
          </Stack>
        </Paper>
      )}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.25}
          alignItems={{ md: "center" }}
        >
          <TextField
            size="small"
            fullWidth
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
                    sx={{ minWidth: 36, minHeight: 36, p: 0.5 }}
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
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(170px, 1fr) minmax(130px, .7fr) minmax(220px, 1.1fr) minmax(170px, .8fr)",
                gap: 1,
                flex: 2,
              }}
            >
              {controls}
            </Box>
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
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6" sx={{ fontWeight: 900 }}>
              Player filters
            </Typography>
            <Button onClick={() => setFiltersOpen(false)} sx={actionSx}>
              Done
            </Button>
          </Stack>
          {controls}
        </Stack>
      </Drawer>
      {!isMobile && (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ borderRadius: 3 }}
        >
          <Table aria-label="Players" sx={{ minWidth: 960 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={headCellSx}>Player</TableCell>
                <TableCell sx={headCellSx} align="right">
                  {currentWeek != null ? `Proj Wk ${currentWeek}` : "Proj Wk"}
                </TableCell>
                <TableCell sx={headCellSx} align="right">
                  ROS
                </TableCell>
                <TableCell sx={headCellSx} align="right">
                  Ownership
                </TableCell>
                {!bestBall && (
                  <TableCell sx={headCellSx} align="right">
                    Upgrade
                  </TableCell>
                )}
                <TableCell sx={headCellSx}>
                  {currentWeek != null ? `Weeks ${currentWeek} to 18` : "Weeks"}
                </TableCell>
                <TableCell sx={headCellSx}>Status</TableCell>
                <TableCell sx={headCellSx} align="right">
                  Action
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {players.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={columnCount}
                    align="center"
                    sx={{ py: 6, color: "text.secondary" }}
                  >
                    {search
                      ? `No players matching “${search}”`
                      : "No players found"}
                  </TableCell>
                </TableRow>
              )}
              {players.map((player) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  action={actionForPlayer(player)}
                  bestBall={bestBall}
                  onOpenPlayer={setQuickViewId}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {isMobile && (
        <Stack spacing={1.25}>
          {players.length === 0 && (
            <Paper
              variant="outlined"
              sx={{ p: 4, textAlign: "center", borderRadius: 3 }}
            >
              <Typography color="text.secondary">
                {search
                  ? `No players matching “${search}”`
                  : "No players found"}
              </Typography>
            </Paper>
          )}
          {players.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              action={actionForPlayer(player)}
              bestBall={bestBall}
              variant="card"
              onOpenPlayer={setQuickViewId}
            />
          ))}
        </Stack>
      )}
      <Stack alignItems="center" spacing={0.75} sx={{ py: 3 }}>
        <Pagination
          count={totalPages}
          page={pageNumber}
          onChange={(event, value) => updateParams({ page: value })}
          shape="rounded"
        />
        <Typography variant="caption" color="text.secondary">
          {totalPlayers} player{totalPlayers === 1 ? "" : "s"}
          {search ? ` matching “${search}”` : ""}
        </Typography>
      </Stack>
      <PlayerDecisionCard
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        entry={toDecisionCardEntry(quickViewPlayer)}
        leagueId={selectedLeague ? Number(selectedLeague) : undefined}
        context={quickViewContext}
        availability={quickViewAvailability}
        roster={roster}
        onActionDone={refreshAfterAction}
        playerIds={players.map((player) => player.id)}
        onNavigate={setQuickViewId}
      />
    </Box>
  );
}

export default PlayerManagement;
