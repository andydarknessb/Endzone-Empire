import React, { useCallback, useEffect, useState } from "react";
import {
  Link as RouterLink,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
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
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import FilterListIcon from "@mui/icons-material/FilterList";
import SearchIcon from "@mui/icons-material/Search";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import apiClient from "../../api/apiClient";
import PlayerQuickView from "../PlayerQuickView/PlayerQuickView";
import PlayerAvatar from "../PlayerQuickView/PlayerAvatar";
import PositionChip from "../PlayerQuickView/PositionChip";
import { useSnackbar } from "../Snackbar/SnackbarProvider";
import AbbreviationTooltip from "../common/AbbreviationTooltip";
import { rosterActionForPhase } from "../../lib/leaguePhase";
import { isPickemOnly } from "../../lib/leagueType";

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
const AVAILABILITY_FILTERS = [
  { value: "all", label: "All players" },
  { value: "free_agent", label: "Free agents" },
  { value: "waivers", label: "On waivers" },
  { value: "my_team", label: "On my Team" },
  { value: "rostered", label: "Rostered" },
];
const SORTS = [
  { value: "adp", label: "ADP" },
  { value: "name", label: "Name" },
  { value: "position_rank", label: "Position rank" },
  { value: "nfl_team", label: "NFL Team" },
  { value: "bye_week", label: "Bye week" },
  { value: "projected_points", label: "Pool projection" },
];
const headCellSx = {
  fontWeight: 800,
  color: "primary.contrastText",
  bgcolor: "primary.main",
  borderColor: "var(--border-subtle)",
};
const sortLabelSx = {
  color: "primary.contrastText",
  "&.Mui-active, &:hover": { color: "primary.contrastText" },
  "& .MuiTableSortLabel-icon": { color: "primary.contrastText !important" },
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

function AvailabilityChip({ state }) {
  const props = {
    free_agent: { label: "Free agent", color: "success" },
    waivers: { label: "On waivers", color: "warning" },
    my_team: { label: "On your Team", color: "info" },
    rostered: { label: "Rostered", color: "default" },
  }[state] || { label: "Unavailable", color: "default" };
  return (
    <Chip
      size="small"
      variant={state === "rostered" ? "outlined" : "filled"}
      {...props}
    />
  );
}

function PlayerFacts({ player, compact = false }) {
  return (
    <Stack
      direction="row"
      spacing={0.75}
      useFlexGap
      flexWrap="wrap"
      alignItems="center"
    >
      <PositionChip position={player.position} size="small" />
      <Typography variant="caption" color="text.secondary">
        {player.nfl_team || "NFL team unavailable"}
      </Typography>
      {!compact && (
        <Typography variant="caption" color="text.secondary">
          ADP {player.adp ?? "-"}
        </Typography>
      )}
      {player.bye_week != null && (
        <Chip
          size="small"
          variant="outlined"
          label={`Bye ${player.bye_week}`}
        />
      )}
      {player.injury_status ? (
        <Chip size="small" color="warning" label={player.injury_status} />
      ) : (
        <Chip size="small" variant="outlined" label="Healthy" />
      )}
    </Stack>
  );
}

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
  const notify = useSnackbar();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [searchParams, setSearchParams] = useSearchParams();
  const pageNumber = Math.max(1, Number(searchParams.get("page")) || 1);
  const selectedLeague = searchParams.get("league") || "";
  const positionFilter = searchParams.get("pos") || "All";
  const availabilityFilter = searchParams.get("availability") || "all";
  const search = searchParams.get("q") || "";
  const sort = searchParams.get("sort") || "adp";
  const dir = searchParams.get("dir") || "asc";
  const [searchInput, setSearchInput] = useState(search);
  const activeLeague = leagues.find(
    (league) => String(league.id) === selectedLeague,
  );
  const rosterAction = rosterActionForPhase(activeLeague);

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
    (err) => setError(err.response?.data?.error || err.message),
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

  const fetchPlayers = useCallback(async () => {
    if (!leaguesLoaded) return;
    try {
      setError(null);
      const params = { page: pageNumber, position: positionFilter, sort };
      if (selectedLeague) params.leagueId = Number(selectedLeague);
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

  const handleSort = (key) => {
    const nextDesc = sort === key && dir === "asc";
    updateParams({
      sort: key === "adp" ? "" : key,
      dir: nextDesc ? "desc" : "",
      page: 1,
    });
  };
  const addToRoster = useCallback(
    async (player) => {
      try {
        setError(null);
        await apiClient.post(`/api/team/roster/${player.id}`, {
          leagueId: Number(selectedLeague),
        });
        notify(`Added ${player.name} to your roster`);
        await fetchPlayers();
      } catch (err) {
        report(err);
        notify(err.response?.data?.error || err.message, { severity: "error" });
      }
    },
    [fetchPlayers, notify, report, selectedLeague],
  );
  const actionForPlayer = useCallback(
    (player) => {
      const state = availabilityOf(player);
      if (!selectedLeague)
        return {
          label: "Select league",
          disabled: true,
          helper: "Select a fantasy league to manage players.",
        };
      if (state === "waivers")
        return {
          label: "Claim",
          onClick: () => navigate(`/league/${selectedLeague}/waivers?playerId=${player.id}`),
          helper: "Build this claim in Waiver Wire.",
        };
      if (state === "my_team")
        return {
          label: "In lineup",
          onClick: () => navigate(`/league/${selectedLeague}/lineup`),
          helper: "Manage this player in Team Lineup.",
        };
      if (state === "rostered")
        return {
          label: "Rostered",
          disabled: true,
          helper: "This player is rostered in this league.",
        };
      return {
        label: rosterAction.label,
        onClick: () => addToRoster(player),
        disabled: rosterAction.disabled,
        helper: rosterAction.helper,
      };
    },
    [addToRoster, navigate, rosterAction, selectedLeague],
  );
  const quickViewPlayer = players.find((player) => player.id === quickViewId);
  const quickViewActions = quickViewPlayer
    ? [actionForPlayer(quickViewPlayer)]
    : [];
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
      <FormControl size="small" fullWidth>
        <InputLabel id="pm-availability-label">Availability</InputLabel>
        <Select
          labelId="pm-availability-label"
          label="Availability"
          value={availabilityFilter}
          onChange={(event) =>
            updateParams({ availability: event.target.value, page: 1 })
          }
        >
          {AVAILABILITY_FILTERS.map((filter) => (
            <MenuItem key={filter.value} value={filter.value}>
              {filter.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Stack direction="row" spacing={1}>
        <FormControl size="small" fullWidth>
          <InputLabel id="pm-sort-label">Sort</InputLabel>
          <Select
            labelId="pm-sort-label"
            label="Sort"
            value={sort}
            onChange={(event) =>
              updateParams({
                sort: event.target.value === "adp" ? "" : event.target.value,
                page: 1,
              })
            }
          >
            {SORTS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
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
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
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
                  "minmax(170px, 1fr) minmax(130px, .7fr) minmax(145px, .8fr) minmax(170px, .8fr)",
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
          <Table aria-label="Players" sx={{ minWidth: 940 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={headCellSx}>
                  <TableSortLabel
                    active={sort === "name"}
                    direction={sort === "name" ? dir : "asc"}
                    onClick={() => handleSort("name")}
                    sx={sortLabelSx}
                  >
                    Player
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={headCellSx}>NFL</TableCell>
                <TableCell sx={headCellSx} align="right">
                  <TableSortLabel
                    active={sort === "position_rank"}
                    direction={sort === "position_rank" ? dir : "asc"}
                    onClick={() => handleSort("position_rank")}
                    sx={sortLabelSx}
                  >
                    <AbbreviationTooltip term="Pos rank" />
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={headCellSx} align="right">
                  <TableSortLabel
                    active={sort === "adp"}
                    direction={sort === "adp" ? dir : "asc"}
                    onClick={() => handleSort("adp")}
                    sx={sortLabelSx}
                  >
                    <AbbreviationTooltip term="ADP" />
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={headCellSx} align="right">
                  <TableSortLabel
                    active={sort === "projected_points"}
                    direction={sort === "projected_points" ? dir : "asc"}
                    onClick={() => handleSort("projected_points")}
                    sx={sortLabelSx}
                  >
                    Pool projection
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={headCellSx}>Availability</TableCell>
                <TableCell sx={headCellSx} align="right">
                  Action
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {players.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    align="center"
                    sx={{ py: 6, color: "text.secondary" }}
                  >
                    {search
                      ? `No players matching “${search}”`
                      : "No players found"}
                  </TableCell>
                </TableRow>
              )}
              {players.map((player) => {
                const action = actionForPlayer(player);
                return (
                  <TableRow key={player.id} hover>
                    <TableCell component="th" scope="row">
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <PlayerAvatar
                          name={player.name}
                          position={player.position}
                          photoUrl={player.photo_url}
                        />
                        <Button
                          variant="text"
                          onClick={() => setQuickViewId(player.id)}
                          sx={{
                            p: 0,
                            minWidth: 0,
                            textTransform: "none",
                            fontWeight: 800,
                            justifyContent: "flex-start",
                          }}
                        >
                          {player.name}
                        </Button>
                        <PositionChip position={player.position} size="small" />
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <PlayerFacts player={player} compact />
                    </TableCell>
                    <TableCell align="right">
                      {player.position_rank != null
                        ? `#${player.position_rank}`
                        : "-"}
                    </TableCell>
                    <TableCell align="right">{player.adp ?? "-"}</TableCell>
                    <TableCell align="right">
                      {player.projected_points != null
                        ? Number(player.projected_points).toFixed(1)
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <AvailabilityChip state={availabilityOf(player)} />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={action.helper || ""}>
                        <span>
                          <Button
                            variant={
                              availabilityOf(player) === "free_agent"
                                ? "contained"
                                : "outlined"
                            }
                            onClick={action.onClick}
                            disabled={action.disabled}
                            sx={actionSx}
                          >
                            {action.label}
                          </Button>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
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
          {players.map((player) => {
            const action = actionForPlayer(player);
            return (
              <Card
                key={player.id}
                variant="outlined"
                sx={{ borderRadius: 3, overflow: "hidden" }}
              >
                <CardActionArea
                  onClick={() => setQuickViewId(player.id)}
                  sx={{ textAlign: "left" }}
                >
                  <CardContent sx={{ pb: 1.25 }}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <PlayerAvatar
                        name={player.name}
                        position={player.position}
                        photoUrl={player.photo_url}
                      />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          variant="subtitle1"
                          sx={{ fontWeight: 900 }}
                          noWrap
                        >
                          {player.name}
                        </Typography>
                        <PlayerFacts player={player} />
                      </Box>
                      <AvailabilityChip state={availabilityOf(player)} />
                    </Stack>
                  </CardContent>
                </CardActionArea>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ px: 2, pb: 1.5 }}
                >
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Pool projection
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                      {player.projected_points != null
                        ? Number(player.projected_points).toFixed(1)
                        : "-"}{" "}
                      pts
                    </Typography>
                  </Box>
                  <Tooltip title={action.helper || ""}>
                    <span>
                      <Button
                        variant={
                          availabilityOf(player) === "free_agent"
                            ? "contained"
                            : "outlined"
                        }
                        onClick={action.onClick}
                        disabled={action.disabled}
                        sx={actionSx}
                      >
                        {action.label}
                      </Button>
                    </span>
                  </Tooltip>
                </Stack>
              </Card>
            );
          })}
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
      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
        leagueId={selectedLeague ? Number(selectedLeague) : undefined}
        playerIds={players.map((player) => player.id)}
        onNavigate={setQuickViewId}
        actions={quickViewActions}
      />
    </Box>
  );
}

export default PlayerManagement;
