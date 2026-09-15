import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link as RouterLink,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Box,
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
import PlayerRow, { PlayerRowTableHead, playerRowColumnCount } from "../../widgets/player-row";
import SegmentedControl from "../../shared/ui/SegmentedControl";
import { useAddPlayer } from "../../features/add-player";
import { useClaimPlayer } from "../../features/claim-player";
import { useWatchPlayer } from "../../features/watch-player";
import { proposeTradeHref } from "../../features/propose-trade";
import { rosterActionForPhase } from "../../shared/lib/leaguePhase";
import { isRosterAtCapacity } from "../../shared/lib/rosterCapacity";
import { isPickemOnly } from "../../shared/lib/leagueType";
import { parseRosterSlots } from "../../shared/lib";
import { useLeague } from "../../hooks/useLeague";
import { DEFAULT_ROSTER_SLOTS, expandEligibility, templateFor } from "../../lib/draftSim/templates";
import {
  SORT_FIELDS,
  wireSortName,
} from "../DraftBoard/sortFields";

// The chip vocabulary this page offers, in the order the manager sees them
// (#1419): "All" first, then this canonical order with any key absent from
// the selected league's roster template dropped. There is no position-group
// table here - expandEligibility (src/lib/draftSim/templates.js) is the
// only one, reused rather than re-declared, the same table the Draft Sim
// mirrors from the server's lineup.service.js. The only new list is this
// order itself (formal review f4): whether a chip is flex-type is read from
// the slot, not a second hand-kept list.
const CANONICAL_CHIP_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "SFLX",
  "K",
  "DEF",
  "DL",
  "LB",
  "DB",
];

// No league selected, or a template with no slots at all, falls back to the
// FULL canonical set - every chip a league could ever offer, FLEX meaning
// RB/WR/TE (#1419, #1416 story 16, the Rosterable position glossary entry,
// ADR 0044: such a request has no server-side gate, so the page must offer
// every chip that could narrow it). Built from templates.js's own slot
// definitions (formal review f2) - DEFAULT_ROSTER_SLOTS plus the SFLX slot
// the 'superflex' LEAGUE_TEMPLATES entry carries and the DL/LB/DB slots the
// 'idp' entry carries - never a re-declared eligibility list.
const FULL_CANONICAL_SLOTS = [
  ...DEFAULT_ROSTER_SLOTS,
  ...templateFor("superflex").slots.filter((slot) => slot.key === "SFLX"),
  ...templateFor("idp").slots.filter((slot) => ["DL", "LB", "DB"].includes(slot.key)),
];

// A chip is flex-type when its slot's expanded eligibility is anything other
// than exactly its own key (formal review f4): FLEX and SFLX expand to a
// literal position list that never contains their own key, and LB, DL and DB
// are themselves POSITION_GROUPS keys, so expanding a single-entry
// `['LB']`/`['DL']`/`['DB']` still yields the whole group. QB, K and DEF
// expand to nothing but themselves and stay plain position chips.
function isFlexSlot(slot) {
  const expanded = expandEligibility(slot.eligiblePositions);
  return expanded.size !== 1 || !expanded.has(slot.key);
}

// One chip per distinct starting slot key the template carries, canonical
// order, absent keys dropped.
function chipsForRosterSlots(rosterSlots) {
  const slots = rosterSlots.length > 0 ? rosterSlots : FULL_CANONICAL_SLOTS;
  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));
  const chips = [{ key: "All" }];
  CANONICAL_CHIP_ORDER.forEach((key) => {
    const slot = slotByKey.get(key);
    if (!slot) return;
    chips.push(
      isFlexSlot(slot)
        ? { key, positions: Array.from(expandEligibility(slot.eligiblePositions)) }
        : { key },
    );
  });
  return chips;
}
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

// The absolute fallback sort - used whenever no league is selected (or the
// league is best ball, where Upgrade is never a real ranking) and whenever an
// unrecognized, non-empty `?sort=` value reaches sortKeyFromParam. It is the
// same default wireSortName falls back to.
const DEFAULT_SORT_KEY = "adp";

// Formal review formal-1310-f1: the issue body's "Upgrade (default sort...)"
// is a real default, not a follow-up - the server gates `view=cards` and
// `sort=upgrade` on the identical `leagueId` condition (player.router.js),
// which fetchPlayers below already tests before sending either. So the
// CONTEXTUAL default (computed in the component, where selectedLeague and
// bestBall are known) is "upgrade" whenever a league is selected and it is
// not best ball, else DEFAULT_SORT_KEY - never a fixed constant.
const PAGE_SORT_KEYS = new Set([...SORT_FIELDS.map((field) => field.key), "upgrade"]);

// The `?sort=` URL param, resolved to a sortFields KEY (or "upgrade", the one
// page-local sort key that isn't a sortFields.js entry). Returns null when the
// param is absent, so the caller can fall back to its own CONTEXTUAL default
// instead of a fixed one.
//
// The param carried WIRE names before #1002, and one field's wire name differs
// from its key, so a bookmark or a shared link made before this change would
// otherwise resolve to the default and silently re-sort the page. A wire name
// is therefore still accepted on READ and mapped back to its key; only keys are
// ever WRITTEN into the URL. Anything unrecognized falls back to DEFAULT_SORT_KEY
// rather than reaching the API verbatim.
function sortKeyFromParam(value) {
  if (!value) return null;
  if (PAGE_SORT_KEYS.has(value)) return value;
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
  // #1312 Ruling: "The Players list gains a Watching toggle that filters
  // client-side on that flag" - not a fifth Availability segment (ADR 0040),
  // and never sent to the server: `fetchPlayers` below has no `watching`
  // param, so toggling this never triggers a refetch, only a re-filter of
  // the page already on hand.
  const watchingOnly = searchParams.get("watching") === "true";
  const search = searchParams.get("q") || "";
  const dir = searchParams.get("dir") || "asc";
  const activeLeague = leagues.find(
    (league) => String(league.id) === selectedLeague,
  );
  const rosterAction = rosterActionForPhase(activeLeague);
  const bestBall = !!activeLeague?.best_ball;
  // The selected league's own roster template, through the shared league
  // hook (#1419) - not the `/api/league` list row `activeLeague` above,
  // which carries no `roster_slots`. No league selected reads as an absent
  // template too (the hook takes no key and never fetches), so both "no
  // league" and "a league with an empty template" land on the same
  // FULL_CANONICAL_SLOTS fallback inside chipsForRosterSlots.
  const { league: templateLeague, loading: templateLeagueLoading } = useLeague(
    selectedLeague || undefined,
  );
  // Formal review f2 (round 2): the template has never loaded only while
  // BOTH are true - `loading` alone also flags a stale-while-revalidate
  // reload of an already-loaded row (useResource.js's `load()`, reached
  // from `subscribe` on an invalidation), which keeps `templateLeague` set
  // the whole time. Gating fetchPlayers on `loading` alone held it, and
  // depending on it, on every such reload too - one extra /api/players call
  // per invalidation, even with an unchanged template.
  const templateNeverLoaded = templateLeagueLoading && !templateLeague;
  // Keyed on the roster_slots FIELD, not the templateLeague wrapper object
  // (formal review f3): useResource/useLeague hands back a new `league`
  // object on every load or reload, including a stale-while-revalidate
  // reload whose content never changed, so keying on the whole object would
  // rebuild chips - and, downstream, refetch the players list - every time.
  const rosterSlots = useMemo(
    () => parseRosterSlots(templateLeague?.roster_slots),
    [templateLeague?.roster_slots],
  );
  const chips = useMemo(() => chipsForRosterSlots(rosterSlots), [rosterSlots]);
  const selectedChip = useMemo(
    () => chips.find((chip) => chip.key === positionFilter) || chips[0],
    [chips, positionFilter],
  );
  // The chip's own request shape, reduced to PRIMITIVES (formal review f3):
  // chips (and so selectedChip) is a freshly built array/object on every
  // roster-template reload even when its VALUES are unchanged, so a
  // fetchPlayers dependent on selectedChip itself would refetch on every
  // reload. A string primitive compares by value, so fetchPlayers' identity
  // - and therefore whether it actually refetches - now tracks only a real
  // change in what would be sent.
  const positionParam = selectedChip.key !== "All" && !selectedChip.positions
    ? selectedChip.key
    : undefined;
  const positionsParam = selectedChip.positions ? selectedChip.positions.join(",") : undefined;
  // Formal review formal-1310-f1: Upgrade is the default sort whenever a
  // league is selected and it is not best ball (the same condition the
  // server gates `view=cards`/`sort=upgrade` on) - an explicit `?sort=`
  // still wins over it.
  const contextualDefaultSort = selectedLeague && !bestBall ? "upgrade" : DEFAULT_SORT_KEY;
  const sort = sortKeyFromParam(searchParams.get("sort")) || contextualDefaultSort;
  // The Sort dropdown's own options: Upgrade joins the list only when it is a
  // real, selectable sort (a league is selected and it is not best ball) -
  // otherwise the Select's controlled `value` could hold "upgrade" with no
  // matching MenuItem, which MUI renders blank.
  const sortOptions = selectedLeague && !bestBall
    ? [...SORT_OPTIONS, { key: "upgrade", label: "Upgrade" }]
    : SORT_OPTIONS;
  const [searchInput, setSearchInput] = useState(search);

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

  // A chip that no longer exists in the selected league's template - most
  // often a switch away from the IDP or Superflex league that offered it -
  // resets the filter to "All" rather than keep sending a code the new
  // league's server-side gate would refuse. Waits for the league's own
  // template to finish loading first: resolving against the DEFAULT_ROSTER_SLOTS
  // fallback while the real one is still in flight would reset a still-valid
  // chip the instant a league loads.
  useEffect(() => {
    if (templateLeagueLoading) return;
    if (positionFilter === "All") return;
    if (chips.some((chip) => chip.key === positionFilter)) return;
    updateParams({ pos: "" });
  }, [chips, positionFilter, templateLeagueLoading, updateParams]);

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
    // Holds the request while the SELECTED league's own roster template has
    // never loaded at all (formal review f3, tightened by f2 round 2):
    // without this, a league whose row isn't cached yet sends one request
    // under the FULL_CANONICAL_SLOTS fallback (or unfiltered, for a chip the
    // fallback lacks) and a second, correctly-filtered one once the real
    // template lands - and since neither response is guarded against
    // arriving out of order, the slower one can win and show the wrong
    // list. `templateNeverLoaded` - not `loading` alone - so a
    // stale-while-revalidate reload of an ALREADY-loaded row (which keeps
    // `templateLeague` set while `loading` flips true) never holds or
    // refetches: nothing about the template actually became unknown.
    if (selectedLeague && templateNeverLoaded) return;
    try {
      setError(null);
      // The one translation from this surface's sort KEY to the server's
      // `?sort=` field name (issue #1002). Every request the Player Browser
      // sent before this change still carries the identical value; only the
      // place the wire name is produced moved, from six literals to here.
      // "upgrade" is the one sort key that isn't a sortFields.js entry (it
      // has no wire-name translation to make - the server's own `?sort=`
      // value is the literal key).
      const params = {
        page: pageNumber,
        sort: sort === "upgrade" ? "upgrade" : wireSortName(sort),
      };
      // The chip's own request shape (#1419): "All" sends no position filter
      // at all and relies on the server's league-scoped gate; a flex-type
      // chip (FLEX, SFLX, DL, LB, DB) sends the union of its slot's eligible
      // positions to `positions`; any other chip sends its own code to
      // `position`, unchanged from before this ticket.
      if (positionsParam) params.positions = positionsParam;
      else if (positionParam) params.position = positionParam;
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
    positionParam,
    positionsParam,
    report,
    search,
    selectedLeague,
    sort,
    templateNeverLoaded,
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
  // Formal review formal-1310-f3: `useAddPlayer`/`useClaimPlayer` each hold
  // ONE page-wide `pending` boolean, so applying it to every row's action
  // (the original risk-review fix for the double-submit gap) relabeled and
  // disabled every waivers/free-agent row at once - a screen-reader user on
  // player B heard a claim in progress for a player they never touched.
  // Tracked here instead, by the ONE player id whose request is in flight,
  // so only that row's button goes busy.
  const [pendingPlayerId, setPendingPlayerId] = useState(null);
  // Formal review round 1, f4: the row's own Add action now consumes the
  // SAME implementation the Decision card's free-agent bar does, rather than
  // a parallel POST that could drift from it (the lead correction's own
  // wording: "PlayerManagement then consumes the feature").
  const { addPlayer } = useAddPlayer({ leagueId: selectedLeague, onDone: refreshAfterAction });
  const addToRoster = useCallback(
    async (player) => {
      setError(null);
      setPendingPlayerId(player.id);
      const { ok, message } = await addPlayer({ playerId: player.id, playerName: player.name });
      setPendingPlayerId(null);
      if (!ok) setError(message);
    },
    [addPlayer],
  );
  // #1310, ADR 0040 Lead correction item 6: the row's Claim action goes
  // through the SAME claim-player feature WaiverWire's own claim dialog
  // submits with - a one-tap claim (no drop pick, no bid) straight from the
  // list, the row-level counterpart to Add's own direct call above. A
  // manager who wants a FAAB bid still reaches the fuller Decision card
  // action bar by opening the row's own Quick view.
  //
  // At roster capacity the one-tap claim cannot succeed: the server 409s
  // with "choose a player to drop" and the row had nowhere to choose one.
  // `actionForPlayer` below routes that case to the Decision card's claim
  // bar, whose drop pick is required there, the same gate `AddPlayerAction`
  // gives a free-agent add.
  const rosterAtCapacity = isRosterAtCapacity(context);
  const { submitClaim } = useClaimPlayer({ leagueId: selectedLeague, onDone: refreshAfterAction });
  const claimFromRow = useCallback(
    async (player) => {
      setError(null);
      setPendingPlayerId(player.id);
      const { ok, message } = await submitClaim({ playerId: player.id, dropPlayerId: null, bid: 0 });
      setPendingPlayerId(null);
      if (!ok) setError(message);
    },
    [submitClaim],
  );
  // #1312, ADR 0040 follow-up (grill ruling Q6): the row's own Watch toggle,
  // the same one-tap shape `claimFromRow` already gives the row - its own
  // per-row busy id, scoped separately from `pendingPlayerId` (Claim/Add's
  // own tracker) since the two actions are independent and a manager may
  // watch a row while an unrelated claim is still in flight.
  const { toggleWatch } = useWatchPlayer({ leagueId: selectedLeague, onDone: refreshAfterAction });
  const [pendingWatchPlayerId, setPendingWatchPlayerId] = useState(null);
  const watchActionForPlayer = useCallback(
    (player) => {
      if (!selectedLeague) return null;
      return {
        watching: Boolean(player.watching),
        pending: pendingWatchPlayerId === player.id,
        onClick: async () => {
          setPendingWatchPlayerId(player.id);
          await toggleWatch({ playerId: player.id, watching: Boolean(player.watching) });
          setPendingWatchPlayerId(null);
        },
      };
    },
    [pendingWatchPlayerId, selectedLeague, toggleWatch],
  );
  const actionForPlayer = useCallback(
    (player) => {
      const state = availabilityOf(player);
      // Formal review formal-1310-f3: busy state is scoped to THIS row's own
      // player id, never the page-wide pending booleans the hooks return.
      const rowPending = pendingPlayerId === player.id;
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
          // Risk-review finding: a one-tap claim with no busy state let a
          // repeated Enter/click fire the same waiver claim twice before the
          // first request's snackbar ever appeared - disabling for the
          // request's own duration is the same guard Add already gets below
          // from `rosterAction.disabled`. At capacity the tap opens the
          // Decision card's claim bar instead (see `rosterAtCapacity`).
          label: rowPending ? "Claiming…" : "Claim",
          onClick: rosterAtCapacity ? () => setQuickViewId(player.id) : () => claimFromRow(player),
          disabled: rowPending,
          helper: rosterAtCapacity
            ? "Your roster is full. Choose a player to drop in the claim card."
            : "Submit a waiver claim for this player.",
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
        label: rowPending ? "Adding…" : rosterAction.label,
        onClick: () => addToRoster(player),
        disabled: rosterAction.disabled || rowPending,
        variant: "contained",
        helper: rosterAction.helper,
      };
    },
    [addToRoster, claimFromRow, pendingPlayerId, rosterAction, rosterAtCapacity, selectedLeague],
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
          rosterCount: marketContext?.rosterCount,
          rosterCapacity: marketContext?.rosterCapacity,
          waiverPriority: marketContext?.waiverType === "priority" ? marketContext?.waiverPriority : undefined,
          faabRemaining: marketContext?.waiverType === "faab" ? marketContext?.faabRemaining : undefined,
        }
      : undefined;
  const currentWeek = players.find((player) => player.projWeek)?.projWeek?.week;
  const columnCount = playerRowColumnCount(bestBall);
  // #1312 Ruling: the Watching toggle's own client-side filter, applied to
  // the page already fetched - never a second server read, never a fifth
  // Availability segment.
  const visiblePlayers = watchingOnly ? players.filter((player) => player.watching) : players;
  // The same five filters render twice: stacked inside the mobile Filters
  // drawer, and as one wrapping row on desktop (Players.dc.html, #1310). The
  // row is the fix for the desktop defect where every filter landed in a
  // 170px column and the five Availability segments became a hidden-scrollbar
  // strip a mouse could not scroll ("Rostered" and "My team" unreachable).
  // On desktop the segmented control keeps its natural width and does not
  // scroll; only the drawer, a touch surface, gets `scrollable` and 44px
  // segments.
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
      <FormControl size="small" fullWidth={!row} sx={row ? { minWidth: 170 } : undefined}>
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
      <FormControl size="small" fullWidth={!row} sx={row ? { minWidth: 130 } : undefined}>
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
      <SegmentedControl
        aria-label="Availability"
        options={AVAILABILITY_FILTERS}
        value={availabilityFilter}
        onChange={(value) => updateParams({ availability: value, page: 1 })}
        scrollable={!row}
        // Risk-review finding (accessibility): SegmentedControl's own
        // segments are 30px tall - fine at its other (pointer-driven)
        // call sites, but this control also renders inside the mobile
        // Filters drawer, a touch surface, so its segments need the same
        // 44px minimum every other action on this page carries.
        sx={row ? undefined : { "& [role='radio']": { minHeight: 44 } }}
      />
      {/* #1312 Ruling: the Watching toggle - client-side only, never a
          fifth Availability segment (ADR 0040's ownership axis stays
          exactly those four states). */}
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
        <FormControl size="small" fullWidth={!row} sx={row ? { minWidth: 170 } : undefined}>
          <InputLabel id="pm-sort-label">Sort</InputLabel>
          <Select
            labelId="pm-sort-label"
            label="Sort"
            value={sort}
            onChange={(event) =>
              updateParams({
                sort:
                  event.target.value === contextualDefaultSort
                    ? ""
                    : event.target.value,
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
  };

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
        <Stack spacing={1.25}>
          <TextField
            size="small"
            fullWidth
            // Players.dc.html: the search sits on its own line above the
            // filter row on desktop, so it does not fight the row for width.
            sx={isMobile ? undefined : { maxWidth: 360 }}
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
          {renderControls("column")}
        </Stack>
      </Drawer>
      {!isMobile && (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ borderRadius: 3 }}
        >
          {/* Cell padding at 10px a side rather than MUI's 16px: eight
              columns' worth of the default came to 256px and, with the dense
              weekly strip, is what lets the table fit a 1024px viewport
              instead of hiding the Action column behind a scrollbar at the
              foot of the table (2026-09-15 report). */}
          <Table aria-label="Players" sx={{ minWidth: 960, "& th, & td": { px: 1.25 } }}>
            <TableHead>
              <PlayerRowTableHead bestBall={bestBall} currentWeek={currentWeek} sx={headCellSx} />
            </TableHead>
            <TableBody>
              {visiblePlayers.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={columnCount}
                    align="center"
                    sx={{ py: 6, color: "text.secondary" }}
                  >
                    {watchingOnly
                      ? "No watched players on this page"
                      : search
                      ? `No players matching “${search}”`
                      : "No players found"}
                  </TableCell>
                </TableRow>
              )}
              {visiblePlayers.map((player) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  action={actionForPlayer(player)}
                  watchAction={watchActionForPlayer(player)}
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
          {visiblePlayers.length === 0 && (
            <Paper
              variant="outlined"
              sx={{ p: 4, textAlign: "center", borderRadius: 3 }}
            >
              <Typography color="text.secondary">
                {watchingOnly
                  ? "No watched players on this page"
                  : search
                  ? `No players matching “${search}”`
                  : "No players found"}
              </Typography>
            </Paper>
          )}
          {visiblePlayers.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              action={actionForPlayer(player)}
              watchAction={watchActionForPlayer(player)}
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
