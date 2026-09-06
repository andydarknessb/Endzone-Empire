import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  Paper,
  Box,
  Typography,
  Tabs,
  Tab,
  Divider,
  Stack,
  TextField,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  FormControlLabel,
  Switch,
  RadioGroup,
  Radio,
  Autocomplete,
  Button,
  IconButton,
  Chip,
  Tooltip,
  List,
  ListItem,
  ListItemText,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import apiClient from '../../api/apiClient';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import {
  ROSTER_POSITION_OPTIONS,
  DP_GROUP_KEYS,
  RULE_CATEGORIES,
  CATEGORY_LABELS,
  LEAF_LABELS,
  TIER_LABELS,
  perYardHelper,
  buildInitialRules,
} from '../../lib/leagueRulesFormat';
import { capForType, isPickemOnly, leagueTypeOf, MIN_TEAMS } from '../../lib/leagueType';
import {
  deriveLeaguePhase, draftSettingsFrozen, LEAGUE_PHASE, removability, removeRefusalMessage,
} from '../../lib/leaguePhase';
import { teamNameLabel } from '../../lib/teamIdentity';
import { DEFAULT_ROSTER_SLOTS } from '../../lib/draftSim/templates';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';
import { Badge, SegmentedControl } from '../../shared/ui';

const PLAYOFF_TEAM_OPTIONS = [4, 6, 8];
const PLAYOFF_START_WEEK_OPTIONS = [14, 15, 16, 17, 18];
const WEEK_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 1);
const WAIVER_PERIOD_OPTIONS = [
  { hours: 24, label: '24 hours after a drop' },
  { hours: 48, label: '48 hours after a drop' },
  { hours: 72, label: '72 hours after a drop' },
];

// A field that is the whole row on a phone and its designed width from sm up.
// Every fixed `minWidth` in this tree used to be unconditional, which on a
// 390px phone pushed a 260px select past the card it sits in.
const fieldWidth = (width) => ({ minWidth: { xs: '100%', sm: width } });

/**
 * The 44px touch floor (WCAG 2.5.5) for the whole tools tree, stated once here
 * rather than as a per-control `sx` on the sixty-odd controls below - a floor
 * the next control added to this file would have to remember. Every interactive
 * thing in here is either an MUI class or the segmented control's `role=radio`
 * segment, so the descendant selectors reach all of them; emotion emits these
 * at (0,2,0), which beats MUI's own `sizeSmall` rules at (0,1,0).
 *
 * The Switch is the one control whose geometry has to be rebuilt rather than
 * floored: its hit area is the switch base, so the base's padding is what grows
 * it to 44, and the root's padding and width grow with it to keep the thumb
 * centred on the track exactly as MUI's defaults do.
 */
const TOUCH_FLOOR_SX = {
  '& .MuiButton-root': { minHeight: MIN_TOUCH_TARGET_SX.minHeight },
  '& .MuiIconButton-root': MIN_TOUCH_TARGET_SX,
  '& .MuiInputBase-root': { minHeight: MIN_TOUCH_TARGET_SX.minHeight },
  '& .MuiRadio-root': { p: 1.25 },
  '& [role="radio"]': { minHeight: MIN_TOUCH_TARGET_SX.minHeight },
  '& .MuiSwitch-root': {
    width: 64,
    height: MIN_TOUCH_TARGET_SX.minHeight,
    p: '15px',
    '& .MuiSwitch-switchBase': { p: '12px' },
  },
};

const fail = (notify) => (err) => notify(err.response?.data?.error || err.message, { severity: 'error' });

/**
 * Unsaved commissioner edits, kept in ONE object owned by CommissionerTools so
 * that neither a tab change nor a collapse of the disclosure above throws them
 * away. Both used to: `CommissionerPanel` renders `{adminOpen && <Tools/>}` and
 * this file renders `{tab === 'roster' && <RosterSettingsPanel/>}`, so each
 * panel's `useState` sat below an unmounting boundary and a commissioner who
 * hand-tuned forty scoring leaves and then checked a roster slot lost all of
 * it, silently and with no dirty flag anywhere.
 *
 * A draft is `{ values, baseline }`: `values` is what the form shows, and
 * `baseline` is a stable serialisation of the values it was seeded with, which
 * is what makes "dirty" a comparison against the saved settings rather than a
 * flag someone has to remember to clear. Discarding is `JSON.parse(baseline)`,
 * so it needs no second copy of the seed.
 */
const stableKey = (values) => JSON.stringify(values);

// Seeds are pure functions of the league row, so a panel that has never been
// edited needs no stored draft at all - it reads its seed at render, and the
// first edit is what installs a draft. Scoring has no seed here: its rules are
// built from a `/api/scoring/rules` read, so that panel installs its own.
const DRAFT_SEEDS = {
  general: (league) => ({ sizeMin: league.min_teams ?? '', sizeMax: league.max_teams ?? '' }),
  roster: (league) => {
    const slots = (league.roster_slots || []).map((s, i) => ({ ...s, _id: i }));
    return {
      slots,
      nextId: slots.length,
      benchSlots: league.bench_slots ?? 5,
      irSlots: league.ir_slots ?? 1,
      dpEnabled: !!league.dp_enabled,
    };
  },
  scoring: () => ({ defaults: null, rules: null }),
  playoffs: (league) => ({
    playoffTeams: league.playoff_teams ?? 4,
    startWeek: (league.regular_season_weeks ?? 14) + 1,
    consolation: !!league.playoff_consolation,
    tradeDeadlineWeek: league.trade_deadline_week ?? '',
  }),
  waivers: (league) => ({
    waiverType: league.waiver_type || 'priority',
    continuous: (league.waiver_period_hours ?? 24) === 0,
    waiverPeriodHours:
      league.waiver_period_hours && league.waiver_period_hours > 0 ? league.waiver_period_hours : 24,
    reviewMode: league.trade_review_hours === 0
      ? 'instant'
      : (league.trade_veto_votes ?? 0) === 0 ? 'commissioner' : 'vote',
    voteThreshold: league.trade_veto_votes > 0 ? league.trade_veto_votes : 3,
  }),
};

/**
 * The drafts of the league currently open, handed across a single unmount.
 *
 * React state cannot survive an unmount it does not own, and collapsing the
 * disclosure in `CommissionerPanel` unmounts this whole tree with no warning,
 * so the drafts are mirrored here on every change and taken back on the next
 * mount of the SAME league. It holds one league's drafts and nothing else: a
 * handoff, not a cache. Exported so a test can clear it between cases.
 */
let draftStash = null;

export function clearCommissionerDrafts() {
  draftStash = null;
}

const takeStash = (leagueId) => (draftStash && draftStash.leagueId === leagueId ? draftStash.drafts : {});

function TeamSelect({ label, teams, value, onChange, disabled }) {
  return (
    <FormControl size="small" disabled={disabled} sx={fieldWidth(200)}>
      <InputLabel id={`${label}-label`}>{label}</InputLabel>
      <Select labelId={`${label}-label`} label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {teams.map((t) => (
          <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

// Debounced free-agent/roster search. Returns the raw player object via
// onSelect; the caller decides what an "add" vs "drop" selection means.
function PlayerSearchField({ label, helperText, disabled, onSelect }) {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState(null);

  useEffect(() => {
    const q = input.trim();
    if (!q) {
      setOptions([]);
      return undefined;
    }
    let active = true;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await apiClient.get('/api/players', { params: { search: q, page: 1 } });
        if (active) setOptions(res.data.players || []);
      } catch (err) {
        if (active) setOptions([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [input]);

  return (
    <Autocomplete
      size="small"
      disabled={disabled}
      options={options}
      loading={loading}
      value={value}
      filterOptions={(x) => x}
      getOptionLabel={(o) => o.name || ''}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      noOptionsText={input.trim() ? 'No players found' : 'Type to search players'}
      onInputChange={(e, v, reason) => {
        if (reason !== 'reset') setInput(v);
      }}
      onChange={(e, v) => {
        setValue(v);
        onSelect(v);
      }}
      sx={fieldWidth(260)}
      renderInput={(params) => (
        <TextField {...params} label={label} helperText={helperText} />
      )}
    />
  );
}

/** When a grant was made, for the roster's secondary line. Null when absent. */
function grantedLabel(grantedAt) {
  if (!grantedAt) return null;
  const date = new Date(grantedAt);
  return Number.isNaN(date.getTime()) ? null : `Co-commissioner since ${date.toLocaleDateString()}`;
}

/**
 * The accessible (and tooltip) name of one grant's revoke control.
 *
 * Team identity leads, and then two things widen it, because Team identity
 * alone does NOT identify a grant. `teams.name` has no unique constraint and
 * CONTEXT.md blesses duplicates outright, so two co-commissioners can share a
 * Team name permanently, and a grant that outlived its team has no name at
 * all; both leave a commissioner with two identical destructive buttons.
 *
 * The grant date is the meaningful half and is visible on the row beside this.
 * The ordinal is the guaranteed half: two grants made the same day would still
 * collide once the date is rendered to day precision, and a control that
 * destroys something must be identifiable in every case rather than in most.
 * `Remove ... tier ${i + 1}` further down this file already settles that an
 * ordinal is how this file disambiguates a list of destructive controls.
 *
 * Naming the grant by its ACCOUNT would be the obvious fix and is the one
 * thing forbidden here (#324); whether commissioner-only chrome may is #179.
 */
function revokeLabel(grant, index) {
  const since = grantedLabel(grant.grantedAt);
  const detail = since ? `${since.toLowerCase()}, ` : '';
  return `Remove ${teamNameLabel(grant.teamName)} (${detail}grant ${index + 1}) as co-commissioner`;
}

// Promote/demote co-commissioners. Owner-only: a co-commissioner can run the
// league but can't recruit more or unseat the ones the owner picked.
function CoCommissionerCard({ leagueId, league, teams, onRefresh, notify }) {
  const [promoteId, setPromoteId] = useState('');
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const report = fail(notify);

  // Team IDs whose manager already holds a grant, so they are not offered
  // again. Each grant already names its own Team: listCoCommissioners LEFT
  // JOINs it and ships `teamId` / `teamName` (#112, commissioner-conditional
  // since #324), which is what both LeagueOfficials and this card render.
  //
  // The grant's `user_id` still reaches this card as commissioner-conditional
  // payload, and only the revoke call is built from it - a team-less grant has
  // no teamId, so it can only be revoked by account id, and this card is the
  // one place it is still listed (it leaves the member-visible roster). The
  // grant/promote path is Team identity end to end: two co-commissioners whose
  // Teams share a NAME are told apart by revokeLabel's date and ordinal, since
  // `teams.name` carries no unique constraint (CONTEXT.md blesses duplicates).
  const grantedTeamIds = new Set(
    (league.co_commissioners || []).map((c) => c.teamId).filter((teamId) => teamId != null)
  );
  const coCommissioners = league.co_commissioners || [];
  // Grant a co-commissioner by Team: the creator already holds the role, so
  // their team is never a candidate, and the server resolves the account behind
  // the chosen team (#343). Compared by teamId against the creator's
  // `ownerTeamId`, not by account id, because teams[] is Team identity only
  // now. `ownerTeamId` is null only when the creator has left their own league,
  // and there is then no creator team to exclude.
  const eligible = teams.filter(
    (team) => team.teamId !== league.ownerTeamId && !grantedTeamIds.has(team.teamId)
  );

  const handlePromote = async () => {
    setBusy(true);
    try {
      await apiClient.post(`/api/league/${leagueId}/co-commissioners`, { teamId: Number(promoteId) });
      notify('Co-commissioner added');
      setPromoteId('');
      onRefresh();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    const target = revokeTarget;
    setRevokeTarget(null);
    try {
      await apiClient.delete(`/api/league/${leagueId}/co-commissioners/${target.user_id}`);
      notify('Co-commissioner removed');
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" component="h4" sx={{ mb: 0.5 }}>Co-commissioners</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Co-commissioners get every commissioner power except deleting the league
        and managing this list.
      </Typography>
      {coCommissioners.length > 0 ? (
        <List dense sx={{ bgcolor: 'var(--dash-surface2)', borderRadius: 1, mb: 1 }}>
          {coCommissioners.map((c, index) => (
            <ListItem
              key={c.user_id}
              secondaryAction={
                <Tooltip title={revokeLabel(c, index)}>
                  <IconButton
                    edge="end"
                    aria-label={revokeLabel(c, index)}
                    onClick={() => setRevokeTarget(c)}
                  >
                    {/* Not a delete: they keep their team, they just lose the
                        role — so this deliberately isn't the trash can used by
                        the destructive "Remove a team" list below. */}
                    <PersonRemoveIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              <ListItemText primary={teamNameLabel(c.teamName)} secondary={grantedLabel(c.grantedAt)} />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          No co-commissioners yet. You&apos;re running this league on your own.
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <FormControl size="small" sx={fieldWidth(220)} disabled={eligible.length === 0}>
          <InputLabel id="promote-co-commissioner-label">Add a co-commissioner</InputLabel>
          <Select
            labelId="promote-co-commissioner-label"
            label="Add a co-commissioner"
            value={promoteId}
            onChange={(e) => setPromoteId(e.target.value)}
          >
            {eligible.map((team) => (
              <MenuItem key={team.teamId} value={team.teamId}>
                {team.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="outlined" size="small" disabled={!promoteId || busy} onClick={handlePromote}>
          Promote
        </Button>
      </Box>
      {eligible.length === 0 && coCommissioners.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Other managers need to join the league before you can share commissioner duties.
        </Typography>
      )}

      <Dialog open={!!revokeTarget} onClose={() => setRevokeTarget(null)}>
        {/* Guarded on the TARGET, not just on its Team name. MUI keeps the
            dialog's children mounted through the exit transition and
            handleRevoke clears the target before awaiting, so an unguarded
            teamNameLabel(revokeTarget?.teamName) renders "Former manager" as
            the dialog fades - turning "nobody is selected" into a plausible
            identity, which is the one misuse src/lib/teamIdentity.js's
            docstring calls out by name. */}
        <DialogTitle>
          {revokeTarget
            ? `Remove ${teamNameLabel(revokeTarget.teamName)} as co-commissioner?`
            : 'Remove as co-commissioner?'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            They keep their team and stay in the league, but lose all commissioner powers.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleRevoke}>Remove</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/**
 * The region that holds a tab's irreversible action, always rendered last.
 *
 * Its chrome uses only registered pairings (ADR 0010): the danger signal is
 * `Badge variant="danger"`, whose danger-on-danger-tint over a card IS a
 * certified row, rather than danger ink on `dash-surface`, which is not. The
 * border is a hairline in `--dash-line`, a non-text graphic.
 */
function DangerZone({ children }) {
  const headingId = useId();
  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      data-testid="commissioner-danger-zone"
      sx={{
        display: 'grid',
        gap: 1,
        p: 1.5,
        border: '1px solid var(--dash-line)',
        borderRadius: 'var(--dash-radius-sm)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Badge variant="danger">Danger zone</Badge>
        <Typography id={headingId} variant="subtitle2" component="h4">
          Start a new season
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

/**
 * Season rollover, behind a confirmation that states what the server actually
 * does rather than what the old one-click button implied.
 *
 * `rolloverSeason` (server/services/commissioner.service.js) archives the
 * season's standings, rosters and awards into league_history and then, for a
 * fantasy league, DELETEs every `team_players` row, every `draft_picks` row and
 * the whole `waiver_players` wire, cancels pending waiver claims and pending or
 * accepted trades, resets every team's `faab_remaining` to the league budget,
 * and moves the league to the next season at week 1 with the draft reopened.
 * A pick'em-only league has none of the roster half (ADR 0002), so it gets its
 * own sentence rather than a list of things that do not exist in it.
 *
 * `aria-describedby` names the consequence sentence and not only the title:
 * MUI moves focus to the first action on open, so without it a screen reader
 * announces the dialog's name and the focused button but never the list of what
 * is about to be deleted. This is the same pairing AdvanceWeek carries, for the
 * same reason.
 */
function StartNewSeason({ leagueId, league, onRefresh, notify, caption }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const report = fail(notify);
  const titleId = useId();
  const descriptionId = useId();

  const pickemOnly = isPickemOnly(league);
  const season = league.current_season;
  const seasonLabel = season != null ? `the ${season} season` : 'this season';
  const nextLabel = season != null ? String(Number(season) + 1) : 'the next season';

  const consequence = pickemOnly
    ? `This archives ${seasonLabel} standings to League History and opens ${nextLabel} for picks at week 1. `
      + 'This cannot be undone.'
    : `This archives ${seasonLabel} to League History, then clears every team's roster, deletes all draft `
      + "picks, empties the waiver wire, cancels pending waiver claims and trades, and resets every team's "
      + `FAAB budget. The league moves to ${nextLabel} at week 1 with the draft reopened. This cannot be undone.`;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await apiClient.post(`/api/commissioner/league/${leagueId}/rollover`, {});
      setOpen(false);
      notify('New season started!');
      onRefresh();
    } catch (err) {
      setOpen(false);
      report(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {consequence}
      </Typography>
      {/* Outlined error, not the filled `color="secondary"` it used to be:
          secondary and success resolve to the same hex (tokens.js), so the
          irreversible button was indistinguishable in hue from Approve on the
          same tab. It stays on the app palette deliberately - repainting it
          onto the island would compose dash-on-accent over dash-danger, which
          is not a registered pairing. */}
      <Button variant="outlined" color="error" disabled={busy} onClick={() => setOpen(true)}>
        Start New Season
      </Button>
      {caption && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {caption}
        </Typography>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <DialogTitle id={titleId}>Start a new season?</DialogTitle>
        <DialogContent>
          <DialogContentText id={descriptionId}>{consequence}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={handleConfirm}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function GeneralSettingsPanel({
  leagueId, league, teams, viewerTeamId, isOwner, draft, setDraft, markSaved, onRefresh, notify,
}) {
  const { sizeMin, sizeMax } = draft;
  const [removeTarget, setRemoveTarget] = useState(null);
  const [joinRequests, setJoinRequests] = useState([]);
  const report = fail(notify);

  const showJoinQueue = league.is_public && league.join_approval;

  useEffect(() => {
    if (!showJoinQueue) return;
    apiClient
      .get(`/api/league/${leagueId}/join-requests`)
      .then((res) => setJoinRequests(Array.isArray(res.data) ? res.data : []))
      .catch(() => setJoinRequests([]));
  }, [leagueId, showJoinQueue]);

  const handleToggleTransactionsLock = async (e) => {
    const locked = e.target.checked;
    try {
      await apiClient.put(`/api/commissioner/league/${leagueId}/transactions-lock`, { locked });
      notify(locked ? 'Transactions locked' : 'Transactions unlocked');
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  const handleSaveLimits = async () => {
    try {
      // A pick'em-only league has no draft for a minimum to gate, so only the
      // cap is edited there (the create dialogs omit min the same way).
      const limits = isPickemOnly(league)
        ? { maxTeams: Number(sizeMax) }
        : { minTeams: Number(sizeMin), maxTeams: Number(sizeMax) };
      await apiClient.put(`/api/league/${leagueId}`, limits);
      notify('Team limits updated');
      markSaved();
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  const handleRemoveTeam = async () => {
    const team = removeTarget;
    setRemoveTarget(null);
    try {
      await apiClient.delete(`/api/commissioner/league/${leagueId}/teams/${team.id}`);
      notify('Team removed');
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  const handleDecideJoinRequest = async (requestId, approve) => {
    try {
      await apiClient.post(`/api/league/${leagueId}/join-requests/${requestId}/decide`, { approve });
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      notify(approve ? 'Join request approved' : 'Join request denied');
    } catch (err) {
      report(err);
    }
  };

  // "Which of these is me" is always a Team ID comparison against the
  // viewer-relative field (CONTEXT.md, Team identity), never a username or an
  // owner-user-ID: neither rides on the league-shared teams[] payload any more
  // (#115 child B / #343), and a username could change out from under a stale
  // comparison anyway (#185).
  //
  // Read `teamId`, the contract name, and not the raw `teams.id` that league
  // detail still carries beside it (#188): every other "which of these is me"
  // comparison in src/ reads `teamId`, and this one's failure direction is the
  // bad one - drop the legacy column and `undefined !== viewerTeamId` is true
  // for every row, which puts a Remove button on the viewer's own team.
  //
  // Both of the server's removal rules, not just the first. removeTeam refuses
  // a commissioner removing their OWN team, and refuses anyone removing the
  // CREATOR's (leagueRole.service's invariant; two 409s with separate
  // messages). Mirroring only the first offered a co-commissioner a button
  // that could never succeed. For the creator the two coincide, so a
  // co-commissioner is the viewer that tells them apart. `ownerTeamId` is null
  // for a creator who has left their own league, and there is then no team of
  // theirs to protect, so the null must not match every row.
  const removableTeams = teams.filter(
    (team) => team.teamId !== viewerTeamId
      && !(league.ownerTeamId != null && team.teamId === league.ownerTeamId)
  );
  // A pick'em-only league has no adds, drops, waivers or trades to lock, no
  // draft to freeze team limits behind, and its rollover lives on its own
  // Season tab. Phase comes from the league row alone: the same row every
  // panel here edits, refetched after each action.
  const pickemOnly = isPickemOnly(league);
  const seasonComplete = deriveLeaguePhase(league) === LEAGUE_PHASE.COMPLETE;
  // The Removable rule (CONTEXT.md), the same one the server enforces: a
  // fantasy league is removable only while pre-draft, a pick'em-only league
  // always. When false, the list of removable teams is replaced by the reason,
  // so the UI never offers a removal the server would refuse for phase reasons.
  // A stale client that still shows the buttons still gets the server's 409.
  const { removable: teamsRemovable, reason: removeReason } = removability(league);
  // Team limits are draft-frozen keys, so they are offered exactly while the
  // phase module's freeze rule says they are open (pre-draft, or always for a
  // pick'em-only league): the same rule the server's frozenSettingKeys states.
  const limitsEditable = !draftSettingsFrozen(league);
  const maxTeamsCap = capForType(leagueTypeOf(league));

  return (
    <Stack spacing={3}>
      {!pickemOnly && (
        <Box>
          <FormControlLabel
            control={<Switch checked={!!league.transactions_locked} onChange={handleToggleTransactionsLock} />}
            label="Lock Transactions"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4.5 }}>
            Applies immediately. Freezes adds, drops, waiver claims, and trades for the entire league.
          </Typography>
        </Box>
      )}

      {isOwner && (
        <CoCommissionerCard
          leagueId={leagueId}
          league={league}
          teams={teams}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}

      {limitsEditable && (
        <Box>
          <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>
            {pickemOnly ? 'Team limit' : 'Team limits (editable until the draft starts)'}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            {!pickemOnly && (
              <TextField
                label="Min teams" type="number" size="small" inputProps={{ min: MIN_TEAMS, max: maxTeamsCap }}
                value={sizeMin} onChange={(e) => setDraft({ sizeMin: e.target.value })} sx={{ width: 130 }}
              />
            )}
            <TextField
              label="Max teams" type="number" size="small" inputProps={{ min: MIN_TEAMS, max: maxTeamsCap }}
              value={sizeMax} onChange={(e) => setDraft({ sizeMax: e.target.value })} sx={{ width: 130 }}
            />
            <Button variant="outlined" size="small" onClick={handleSaveLimits}>Save Limits</Button>
          </Box>
        </Box>
      )}

      {/* Rendered whenever the viewer may remove teams at all, not only when
          the list has something in it (#188). Two rules keep a team off this
          list, and hiding the whole section when they empty it - a two-team
          league of the viewer's and the creator's does exactly that - took the
          overline, the subheading and the list out of the DOM together, so
          someone who used this section last week found no trace of it and no
          reason. The caption below states the rule the list cannot show. */}
      <Paper variant="outlined" sx={{ p: 2, borderColor: 'error.main' }}>
        <Typography variant="overline" color="error.main">Destructive actions</Typography>
        <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>Remove a team</Typography>
        {teamsRemovable ? (
          <>
            {/* The server's own refusal, restated rather than reworded:
                removeTeam raises exactly this on a 409, and that 409 was the
                only place the rule was ever stated to a user. Keeping the
                wording identical means the person who hits it by another route
                reads the same sentence. */}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Your own team and the league creator&apos;s team can&apos;t be removed.
            </Typography>
            {/* The trigger is a labelled Button, not the bare 36px trash glyph
                it used to be: this is the one control on the page that deletes
                a team permanently, and an unlabelled icon is the weakest
                affordance in the file for the strongest action in it. The row
                lays the button out as a flex child rather than through
                `secondaryAction`, whose absolutely-positioned slot reserves a
                fixed 48px inset that a text button overruns. */}
            <List dense sx={{ bgcolor: 'var(--dash-surface2)', borderRadius: 1 }}>
              {removableTeams.map((team) => (
                <ListItem key={team.teamId} sx={{ gap: 1, flexWrap: 'wrap' }}>
                  <ListItemText primary={team.name} sx={{ my: 0 }} />
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    aria-label={`Remove ${team.name}`}
                    onClick={() => setRemoveTarget(team)}
                    sx={{ flex: 'none' }}
                  >
                    Remove
                  </Button>
                </ListItem>
              ))}
            </List>
          </>
        ) : (
          /* Past pre-draft the whole list is gone, not just disabled: removing
             any team now would rewrite the draft, rosters and schedule (the
             Removable rule, #195). Only a fantasy league reaches this branch, a
             pick'em-only league being removable in every phase, so the reason is
             always the draft having started. The first line is the server's own
             refusal, rendered from the shared message so the person who hits the
             409 by another route reads the same sentence; the added context is
             visibly extra, in its own node. */
          <Box data-testid="remove-team-refused">
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {removeRefusalMessage(removeReason)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Removing one would rewrite the draft, rosters and schedule.
            </Typography>
          </Box>
        )}
      </Paper>

      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)}>
        <DialogTitle>Remove {removeTarget?.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {pickemOnly
              ? 'This permanently removes the manager from the league; their picks no longer count in the standings. '
              : 'This permanently removes the team, its roster, and its matchup history from the league. '}
            The owner will be notified. This can&apos;t be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleRemoveTeam}>Remove Team</Button>
        </DialogActions>
      </Dialog>

      {showJoinQueue && (
        <Box data-testid="join-requests-section">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" component="h4">Join Requests</Typography>
            <Chip size="small" label={joinRequests.length} color={joinRequests.length > 0 ? 'primary' : 'default'} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Approve and deny decisions apply immediately.
          </Typography>
          {joinRequests.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No pending join requests</Typography>
          ) : (
            <Stack spacing={1}>
              {joinRequests.map((request) => (
                <Box key={request.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  {/* Through teamNameLabel, not read raw: unlike `teams.name`
                      (a real CHECK constraint, teams_name_not_blank_check),
                      `join_requests.team_name` carries no NOT NULL and no
                      blank check — the require_team_names migration swept
                      existing blank-name pending rows to 'cancelled' rather
                      than constraining the column. The write path
                      (discovery.service.js's joinPublicLeague, the only
                      writer) validates a name before every insert/upsert
                      today, but nothing at the schema layer keeps that true
                      tomorrow, so this is exactly the case teamIdentity.js's
                      docstring reserves the label for: identity that can
                      genuinely be absent, not a data bug being papered over. */}
                  <Typography sx={{ flexGrow: 1 }}>
                    {teamNameLabel(request.team_name)} · {new Date(request.created_at).toLocaleString()}
                  </Typography>
                  <Button size="small" variant="contained" color="success" onClick={() => handleDecideJoinRequest(request.id, true)}>
                    Approve
                  </Button>
                  <Button size="small" variant="outlined" color="error" onClick={() => handleDecideJoinRequest(request.id, false)}>
                    Deny
                  </Button>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* Always last, and its own region: rollover is the only irreversible
          write on this tab that acts on the WHOLE league, and it used to sit
          third from the top in a green contained button that is pixel-identical
          in hue to the Approve button on this same tab. It is deliberately NOT
          nested in the Destructive-actions Paper above: that one is titled
          "Remove a team" and at season-complete its body is already the
          phase-refusal branch. */}
      {!pickemOnly && seasonComplete && (
        <DangerZone>
          <StartNewSeason leagueId={leagueId} league={league} onRefresh={onRefresh} notify={notify} />
        </DangerZone>
      )}
    </Stack>
  );
}

// One-click lineup templates: known-good slot arrays a commissioner can stamp
// in instead of hand-building rows. Applying one only replaces the local form
// state — nothing is saved until Save Roster Settings.
//
// The base seven starting slots are the pinned client copy of the standard
// roster shape (src/lib/draftSim/templates.js's DEFAULT_ROSTER_SLOTS, held
// equal whole-object to the server leaf server/services/rosterSlots.js by
// templates.parity.test.js), not a fourth hand-kept copy. Those slots carry a
// `label` field the roster form does not use: the rows read key/count/
// eligiblePositions and the save handler picks exactly those three before
// posting, so `label` rides along in form state but never reaches the API.
const LINEUP_TEMPLATES = [
  { name: 'Standard', slots: DEFAULT_ROSTER_SLOTS, dpEnabled: false },
  {
    name: 'Superflex',
    slots: [...DEFAULT_ROSTER_SLOTS, { key: 'SFLX', count: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] }],
    dpEnabled: false,
  },
  {
    name: 'IDP starter',
    slots: [
      ...DEFAULT_ROSTER_SLOTS,
      { key: 'DL', count: 1, eligiblePositions: ['DL'] },
      { key: 'LB', count: 1, eligiblePositions: ['LB'] },
      { key: 'DB', count: 1, eligiblePositions: ['DB'] },
    ],
    dpEnabled: true,
  },
];

// Which template the lineup on screen matches, so the segmented control below
// can show a real selection rather than remembering the last click: edit one
// row after stamping Standard and this is a hand-built lineup again, and no
// segment is checked. Order is part of the shape because a template stamps its
// rows in order.
const slotShapeKey = (slots) => (slots || [])
  .map((s) => `${String(s.key).trim().toUpperCase()}:${Number(s.count) || 0}:${(s.eligiblePositions || []).join('/')}`)
  .join('|');

function RosterSettingsPanel({ leagueId, league, draft, setDraft, markSaved, onRefresh, notify }) {
  const { slots, benchSlots, irSlots, dpEnabled } = draft;
  const report = fail(notify);

  const frozen = draftSettingsFrozen(league);

  const starters = slots.reduce((sum, s) => sum + (Number(s.count) || 0), 0);
  const dpStarters = slots
    .filter((s) => (s.eligiblePositions || []).length > 0 && s.eligiblePositions.every((p) => DP_GROUP_KEYS.includes(p)))
    .reduce((sum, s) => sum + (Number(s.count) || 0), 0);
  const totalRosterSize = starters + (Number(benchSlots) || 0) + (Number(irSlots) || 0);
  // Only starters + bench are drafted; the IR slot costs no draft round (#96).
  const irCount = Number(irSlots) || 0;
  const draftSpots = starters + (Number(benchSlots) || 0);

  const updateSlot = (id, patch) => setDraft((d) => ({
    slots: d.slots.map((s) => (s._id === id ? { ...s, ...patch } : s)),
  }));
  const removeSlot = (id) => setDraft((d) => ({ slots: d.slots.filter((s) => s._id !== id) }));
  const addSlot = () => setDraft((d) => ({
    slots: [...d.slots, { _id: d.nextId, key: '', count: 1, eligiblePositions: [] }],
    nextId: d.nextId + 1,
  }));
  const addIdpFlexSlot = () => setDraft((d) => {
    // A second identical flex spot is the same slot with a higher count —
    // slot names are identifiers and must stay unique, so clicking again
    // bumps the existing row instead of duplicating it.
    const existing = d.slots.find((s) => String(s.key).trim().toUpperCase() === 'IDP FLEX');
    return {
      slots: existing
        ? d.slots.map((s) => (s === existing ? { ...s, count: (Number(s.count) || 0) + 1 } : s))
        : [...d.slots, { _id: d.nextId, key: 'IDP FLEX', count: 1, eligiblePositions: [...DP_GROUP_KEYS] }],
      nextId: d.nextId + 1,
      dpEnabled: true,
    };
  });

  // Mirror of the server's slot rules so a typo gets a specific message
  // before the request instead of a generic 400 after it.
  const slotValidationError = (payload) => {
    for (const s of payload) {
      const label = s.key ? `"${s.key}"` : 'an unnamed slot';
      if (!/^[A-Za-z0-9_][A-Za-z0-9_ /-]{0,19}$/.test(s.key)) {
        return `${label}: slot names are 1-20 characters: letters, numbers, spaces, hyphens, slashes, underscores`;
      }
      if (['BENCH', 'IR'].includes(s.key.toUpperCase())) return `${label} is reserved for the bench/IR system`;
      if (!s.eligiblePositions.length) return `${label}: pick at least one eligible position`;
    }
    if (new Set(payload.map((s) => s.key)).size !== payload.length) {
      return 'Slot names must be unique. For two of the same slot, raise that slot\'s Count instead';
    }
    return null;
  };

  const handleSave = async () => {
    const payload = slots.map(({ key, count, eligiblePositions }) => ({
      key: String(key).trim().toUpperCase(),
      count: Number(count) || 0,
      eligiblePositions: eligiblePositions || [],
    }));
    const validationError = slotValidationError(payload);
    if (validationError) {
      notify(validationError, { severity: 'error' });
      return;
    }
    try {
      await apiClient.put(`/api/league/${leagueId}`, {
        rosterSlots: payload,
        benchSlots: Number(benchSlots),
        irSlots: Number(irSlots),
        dpEnabled,
      });
      notify('Roster settings saved');
      markSaved();
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  return (
    <Stack spacing={3}>
      {frozen && (
        <Alert severity="info">
          Roster construction locks once the draft starts, so every manager drafts against the
          same rules.
        </Alert>
      )}

      <Box>
        <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>Starting Lineup Slots</Typography>
        {/* Not rendered at all once the draft has started, rather than rendered
            disabled: SegmentedControl has no disabled state, and a radiogroup
            that looks interactive and answers nothing is worse than an absent
            shortcut. The freeze Alert above already says why, and every field
            the templates would write is disabled and still on screen. */}
        {!frozen && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">Templates:</Typography>
            <SegmentedControl
              aria-label="Starting lineup template"
              data-testid="lineup-template-control"
              options={LINEUP_TEMPLATES.map((t) => ({ value: t.name, label: t.name }))}
              value={LINEUP_TEMPLATES.find((t) => slotShapeKey(t.slots) === slotShapeKey(slots))?.name ?? ''}
              onChange={(name) => {
                const template = LINEUP_TEMPLATES.find((t) => t.name === name);
                setDraft((d) => ({
                  slots: template.slots.map((s, i) => ({ ...s, _id: d.nextId + i })),
                  nextId: d.nextId + template.slots.length,
                  dpEnabled: template.dpEnabled ? true : d.dpEnabled,
                }));
              }}
              scrollable
            />
          </Box>
        )}
        <Stack spacing={1.5}>
          {slots.map((slot) => (
            <Box key={slot._id} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                label="Slot Name" size="small" disabled={frozen}
                value={slot.key} onChange={(e) => updateSlot(slot._id, { key: e.target.value.toUpperCase() })}
                sx={{ width: 130 }}
              />
              <TextField
                label="Count" type="number" size="small" disabled={frozen}
                inputProps={{ min: 0, max: 10 }}
                value={slot.count} onChange={(e) => updateSlot(slot._id, { count: e.target.value })}
                sx={{ width: 90 }}
              />
              <FormControl size="small" disabled={frozen} sx={fieldWidth(260)}>
                <InputLabel id={`elig-${slot._id}`}>Eligible Positions</InputLabel>
                <Select
                  labelId={`elig-${slot._id}`} label="Eligible Positions" multiple
                  value={slot.eligiblePositions || []}
                  onChange={(e) => updateSlot(slot._id, { eligiblePositions: e.target.value })}
                  renderValue={(sel) => sel.join(', ')}
                >
                  {ROSTER_POSITION_OPTIONS.map((p) => (
                    <MenuItem key={p} value={p} disabled={!dpEnabled && DP_GROUP_KEYS.includes(p)}>
                      {p}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <IconButton
                aria-label={`Remove ${slot.key || 'slot'}`} disabled={frozen}
                onClick={() => removeSlot(slot._id)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Stack>
        <Button size="small" sx={{ mt: 1 }} disabled={frozen} onClick={addSlot}>+ Add Slot</Button>
        <Button size="small" sx={{ mt: 1 }} disabled={frozen} onClick={addIdpFlexSlot}>
          + IDP Flex Slot (DL/LB/DB)
        </Button>
      </Box>

      <Divider />

      <Box>
        <FormControlLabel
          control={<Switch checked={dpEnabled} disabled={frozen} onChange={(e) => setDraft({ dpEnabled: e.target.checked })} />}
          label="Enable Defensive Players (IDP)"
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4.5 }}>
          Lets slots target DL/LB/DB position groups (e.g. a "Flex IDP" slot). Combined
          DP-eligible starting slots are capped at 3 (base + up to 2 additional)
          {dpEnabled ? `, currently ${dpStarters}/3.` : '.'}
        </Typography>
      </Box>

      <Divider />

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          label="Bench Slots" type="number" size="small" disabled={frozen}
          inputProps={{ min: 0, max: 8 }}
          value={benchSlots} onChange={(e) => setDraft({ benchSlots: e.target.value })}
          sx={{ width: 130 }}
        />
        <TextField
          label="IR Slots" type="number" size="small" disabled={frozen}
          inputProps={{ min: 0, max: 5 }}
          value={irSlots} onChange={(e) => setDraft({ irSlots: e.target.value })}
          sx={{ width: 130 }}
        />
        <Typography variant="body2" color="text.secondary">
          {irCount > 0 ? (
            <>
              <strong>{draftSpots}</strong> roster spots + up to {irCount} IR ({starters} starters + {Number(benchSlots) || 0} bench)
            </>
          ) : (
            <>
              Total roster size: <strong>{totalRosterSize}</strong> ({starters} starters + {Number(benchSlots) || 0} bench + 0 IR)
            </>
          )}
        </Typography>
      </Box>

      <Box>
        <Button variant="outlined" size="small" disabled={frozen} onClick={handleSave}>
          Save Roster Settings
        </Button>
      </Box>
    </Stack>
  );
}

// The three PPR-ness presets differ only in the reception rate — mirroring
// the server's SCORING_PRESETS (scoring.service.js withReceptionRate).
const RECEPTION_PRESETS = [
  { name: 'Standard', reception: 0 },
  { name: 'Half PPR', reception: 0.5 },
  { name: 'Full PPR', reception: 1 },
];

function ScoringSettingsPanel({ leagueId, league, draft, setDraft, installDraft, markSaved, onRefresh, notify }) {
  const { defaults, rules } = draft;
  // Two-step reset guard: first click arms, second click actually resets.
  const [confirmReset, setConfirmReset] = useState(false);
  const report = fail(notify);
  const frozen = draftSettingsFrozen(league);

  useEffect(() => {
    // Already fetched: the lifted draft survived this panel's unmount, so a hop
    // to Roster Settings and back must not re-read the defaults and rebuild the
    // rules over the commissioner's edits. That rebuild WAS the data loss.
    if (rules) return undefined;
    let active = true;
    apiClient
      .get('/api/scoring/rules')
      .then((res) => {
        if (!active) return;
        // Installed, not patched: this is the seed, so it sets the baseline the
        // dirty marker compares against rather than counting as an edit.
        installDraft({
          defaults: res.data.defaults,
          rules: buildInitialRules(res.data.defaults, league.scoring_rules),
        });
      })
      .catch(() => active && notify('Failed to load scoring defaults', { severity: 'error' }));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  if (!rules) return <CircularProgress size={24} />;

  const setRules = (updater) => setDraft((d) => ({ rules: updater(d.rules) }));

  const setLeaf = (category, key, value) =>
    setRules((prev) => ({ ...prev, [category]: { ...prev[category], [key]: value } }));

  const setTier = (category, key, index, field, value) =>
    setRules((prev) => {
      const tiers = prev[category][key].map((t, i) => (i === index ? { ...t, [field]: value } : t));
      return { ...prev, [category]: { ...prev[category], [key]: tiers } };
    });

  // Tier arrays end with an open-ended "and up" row, so a naive append would
  // always overlap it (and be rejected on save). Instead, close the current
  // tail one bucket wide and make the new row the open-ended one — e.g.
  // adding to FG [.., 50+] yields [.., 50-59, 60+].
  const addTier = (category, key) =>
    setRules((prev) => {
      const tiers = prev[category][key];
      const last = tiers[tiers.length - 1];
      if (!last) {
        return { ...prev, [category]: { ...prev[category], [key]: [{ min: 0, max: null, points: 0 }] } };
      }
      if (last.max === null || last.max === '') {
        const closedLast = { ...last, max: Number(last.min) + 9 };
        const newTail = { min: Number(last.min) + 10, max: null, points: last.points };
        return {
          ...prev,
          [category]: { ...prev[category], [key]: [...tiers.slice(0, -1), closedLast, newTail] },
        };
      }
      return {
        ...prev,
        [category]: { ...prev[category], [key]: [...tiers, { min: Number(last.max) + 1, max: null, points: 0 }] },
      };
    });

  const removeTier = (category, key, index) =>
    setRules((prev) => ({
      ...prev,
      [category]: { ...prev[category], [key]: prev[category][key].filter((_, i) => i !== index) },
    }));

  const applyReceptionPreset = (rate) =>
    setRules((prev) => ({ ...prev, receiving: { ...prev.receiving, reception: rate } }));

  // A patch, not an install: the reset is itself an unsaved edit, so the
  // baseline stays where it was and the tab keeps its unsaved marker.
  const handleReset = () => setDraft({ rules: buildInitialRules(defaults, null) });

  const handleSave = async () => {
    const payload = {};
    for (const [category, leaves] of Object.entries(rules)) {
      payload[category] = {};
      for (const [key, value] of Object.entries(leaves)) {
        payload[category][key] = Array.isArray(value)
          ? value.map((t) => ({
              min: Number(t.min),
              max: t.max === '' || t.max === null ? null : Number(t.max),
              points: Number(t.points),
              ...(t.pointsPerYardOverMin === undefined
                ? {}
                : { pointsPerYardOverMin: Number(t.pointsPerYardOverMin) }),
            }))
          : Number(value);
      }
    }
    try {
      await apiClient.put(`/api/league/${leagueId}`, { scoringRules: payload });
      notify('Scoring settings saved');
      markSaved();
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  // IDP is always listed so the options are discoverable; its fields are
  // disabled (with an inline enable hint) until the league turns DP on in
  // Roster Settings.
  const categories = RULE_CATEGORIES.filter((c) => c in rules);
  const activeReception = Number(rules.receiving && rules.receiving.reception);

  return (
    <Stack spacing={3}>
      {frozen && (
        <Alert severity="info">
          Scoring rules lock once the draft starts, so every week is scored under the same rules.
        </Alert>
      )}

      {/* A real selection, so it is a radio group and not three chips: the
          three presets differ only in the reception rate, and exactly one of
          them (or none, for a custom rate) describes the rules on screen.
          Hidden rather than disabled once frozen, for the reason the lineup
          templates above are. */}
      {!frozen && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">Quick preset:</Typography>
          <SegmentedControl
            aria-label="Reception scoring preset"
            data-testid="reception-preset-control"
            options={RECEPTION_PRESETS.map(({ name, reception }) => ({ value: reception, label: name }))}
            value={activeReception}
            onChange={applyReceptionPreset}
            scrollable
          />
          <Typography variant="caption" color="text.secondary">
            Sets the reception rate; every other rule stays as configured.
          </Typography>
        </Stack>
      )}

      {categories.map((category) => {
        const idpLocked = category === 'idp' && !league.dp_enabled;
        const fieldsDisabled = frozen || idpLocked;
        const leaves = Object.entries(rules[category]).filter(([, v]) => !Array.isArray(v));
        const tiers = Object.entries(rules[category]).filter(([, v]) => Array.isArray(v));
        return (
          <Box key={category}>
            <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>{CATEGORY_LABELS[category]}</Typography>
            {idpLocked && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                Enable Defensive Players (IDP) in Roster Settings to score individual defenders.
                These values are saved either way and take effect once IDP is on.
              </Alert>
            )}
            {leaves.length > 0 && (
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: tiers.length > 0 ? 2 : 0 }}>
                {leaves.map(([key, value]) => (
                  <TextField
                    key={key} label={LEAF_LABELS[key] || key} type="number" size="small"
                    disabled={fieldsDisabled}
                    inputProps={{ step: 0.1, min: -50, max: 50 }}
                    helperText={perYardHelper(key, value)}
                    value={value} onChange={(e) => setLeaf(category, key, e.target.value)}
                    sx={{ width: 160 }}
                  />
                ))}
              </Box>
            )}
            {tiers.map(([key, tierArray]) => (
              <Box key={key} sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  {TIER_LABELS[key] || key}
                </Typography>
                <Stack spacing={1}>
                  {tierArray.map((tier, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <TextField
                        label="Min" type="number" size="small" disabled={fieldsDisabled}
                        value={tier.min} onChange={(e) => setTier(category, key, i, 'min', e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        label="Max" type="number" size="small" disabled={fieldsDisabled} placeholder="and up"
                        value={tier.max === null ? '' : tier.max}
                        onChange={(e) => setTier(category, key, i, 'max', e.target.value === '' ? null : e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        label="Points" type="number" size="small" disabled={fieldsDisabled}
                        value={tier.points} onChange={(e) => setTier(category, key, i, 'points', e.target.value)}
                        sx={{ width: 90 }}
                      />
                      {tier.pointsPerYardOverMin !== undefined && (
                        <TextField
                          label="Per Yard Over Min" type="number" size="small" disabled={fieldsDisabled}
                          inputProps={{ step: 0.1 }} value={tier.pointsPerYardOverMin}
                          onChange={(e) => setTier(category, key, i, 'pointsPerYardOverMin', e.target.value)}
                          sx={{ width: 150 }}
                        />
                      )}
                      <IconButton
                        aria-label={`Remove ${TIER_LABELS[key] || key} tier ${i + 1}`} size="small"
                        disabled={fieldsDisabled || tierArray.length <= 1}
                        onClick={() => removeTier(category, key, i)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Stack>
                <Button size="small" sx={{ mt: 0.5 }} disabled={fieldsDisabled} onClick={() => addTier(category, key)}>
                  + Add Tier
                </Button>
              </Box>
            ))}
          </Box>
        );
      })}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="outlined" size="small" disabled={frozen} onClick={handleSave}>
          Save Scoring Settings
        </Button>
        <Button
          size="small" disabled={frozen} color={confirmReset ? 'error' : 'primary'}
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              return;
            }
            handleReset();
            setConfirmReset(false);
          }}
        >
          {confirmReset ? 'Click again to confirm reset' : 'Reset Scoring Settings'}
        </Button>
      </Box>
    </Stack>
  );
}

function PlayoffSchedulePanel({ leagueId, league, draft, setDraft, markSaved, onRefresh, notify }) {
  const { playoffTeams, startWeek, consolation, tradeDeadlineWeek } = draft;
  const report = fail(notify);

  const frozen = draftSettingsFrozen(league);

  const handleSaveStructure = async () => {
    try {
      await apiClient.put(`/api/league/${leagueId}`, {
        playoffTeams: Number(playoffTeams),
        regularSeasonWeeks: Number(startWeek) - 1,
        playoffConsolation: consolation,
      });
      notify('Playoff settings saved');
      markSaved();
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  const handleSaveDeadline = async () => {
    try {
      await apiClient.put(`/api/league/${leagueId}`, {
        tradeDeadlineWeek: tradeDeadlineWeek === '' ? null : Number(tradeDeadlineWeek),
      });
      notify('Trade deadline saved');
      markSaved();
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>Playoff Structure</Typography>
        {frozen && (
          <Alert severity="info" sx={{ mb: 2 }}>
            The playoff structure locks once the draft starts, so the bracket stays consistent
            all season.
          </Alert>
        )}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
          <FormControl size="small" disabled={frozen} sx={fieldWidth(160)}>
            <InputLabel id="playoff-teams-label">Playoff Teams</InputLabel>
            <Select
              labelId="playoff-teams-label" label="Playoff Teams"
              value={playoffTeams} onChange={(e) => setDraft({ playoffTeams: e.target.value })}
            >
              {PLAYOFF_TEAM_OPTIONS.map((n) => <MenuItem key={n} value={n}>{n} teams</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" disabled={frozen} sx={fieldWidth(180)}>
            <InputLabel id="playoff-start-label">Playoff Start Week</InputLabel>
            <Select
              labelId="playoff-start-label" label="Playoff Start Week"
              value={startWeek} onChange={(e) => setDraft({ startWeek: e.target.value })}
            >
              {PLAYOFF_START_WEEK_OPTIONS.map((w) => <MenuItem key={w} value={w}>Week {w}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <FormControlLabel
          disabled={frozen}
          control={<Switch checked={consolation} onChange={(e) => setDraft({ consolation: e.target.checked })} />}
          label="Consolation bracket (a loser's bracket for non-playoff teams)"
        />
        <Box sx={{ mt: 1 }}>
          <Button variant="outlined" size="small" disabled={frozen} onClick={handleSaveStructure}>
            Save Playoff Settings
          </Button>
        </Box>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>Trade Deadline</Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={fieldWidth(180)}>
            <InputLabel id="trade-deadline-label">Trade Deadline</InputLabel>
            <Select
              labelId="trade-deadline-label" label="Trade Deadline"
              value={tradeDeadlineWeek} onChange={(e) => setDraft({ tradeDeadlineWeek: e.target.value })}
            >
              <MenuItem value="">No deadline</MenuItem>
              {WEEK_OPTIONS.map((w) => <MenuItem key={w} value={w}>Week {w}</MenuItem>)}
            </Select>
          </FormControl>
          <Button variant="outlined" size="small" onClick={handleSaveDeadline}>Save Trade Deadline</Button>
        </Box>
      </Box>
    </Stack>
  );
}

function WaiverTradePanel({ leagueId, draft, setDraft, markSaved, onRefresh, notify }) {
  const { waiverType, continuous, waiverPeriodHours, reviewMode, voteThreshold } = draft;
  const report = fail(notify);

  const handleSave = async () => {
    const payload = {
      waiverType,
      waiverPeriodHours: continuous ? 0 : Number(waiverPeriodHours),
    };
    if (reviewMode === 'instant') {
      payload.tradeReviewHours = 0;
      payload.tradeVetoVotes = 0;
    } else if (reviewMode === 'commissioner') {
      payload.tradeReviewHours = 24;
      payload.tradeVetoVotes = 0;
    } else {
      payload.tradeReviewHours = 24;
      payload.tradeVetoVotes = Number(voteThreshold);
    }
    try {
      await apiClient.put(`/api/league/${leagueId}`, payload);
      notify('Waiver rules saved');
      markSaved();
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle2" component="p" id="waiver-system-type-label" sx={{ mb: 1 }}>Waiver System Type</Typography>
        <RadioGroup row aria-labelledby="waiver-system-type-label" value={waiverType} onChange={(e) => setDraft({ waiverType: e.target.value })}>
          <FormControlLabel value="faab" control={<Radio />} label="FAAB (Bidding)" />
          <FormControlLabel value="priority" control={<Radio />} label="Rolling Priority" />
        </RadioGroup>
      </Box>

      <Box>
        <FormControlLabel
          control={<Switch checked={continuous} onChange={(e) => setDraft({ continuous: e.target.checked })} />}
          label="Continuous waivers (players clear immediately, no waiting period)"
        />
        {!continuous && (
          <FormControl size="small" sx={{ mt: 1, ml: { xs: 0, sm: 4.5 }, ...fieldWidth(240), display: 'block' }}>
            <InputLabel id="waiver-period-label">Waiver Clear Period</InputLabel>
            <Select
              labelId="waiver-period-label" label="Waiver Clear Period"
              value={waiverPeriodHours} onChange={(e) => setDraft({ waiverPeriodHours: e.target.value })}
            >
              {WAIVER_PERIOD_OPTIONS.map((o) => <MenuItem key={o.hours} value={o.hours}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
        )}
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" component="p" id="trade-review-system-label" sx={{ mb: 1 }}>Trade Review System</Typography>
        <RadioGroup aria-labelledby="trade-review-system-label" value={reviewMode} onChange={(e) => setDraft({ reviewMode: e.target.value })}>
          <FormControlLabel value="commissioner" control={<Radio />} label="Commissioner Veto" />
          <Typography variant="caption" color="text.secondary" sx={{ ml: 4, mb: 1 }}>
            Trades sit in a 24-hour review window; only you can step in and veto one.
          </Typography>
          <FormControlLabel value="vote" control={<Radio />} label="League Vote" />
          <Typography variant="caption" color="text.secondary" sx={{ ml: 4, mb: 1 }}>
            Any other team owner can vote to veto during the review window.
          </Typography>
          <FormControlLabel value="instant" control={<Radio />} label="Instant Process" />
          <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
            Trades execute immediately, with no review window and no vetoes.
          </Typography>
        </RadioGroup>
        {reviewMode === 'vote' && (
          <TextField
            label="Votes needed to veto" type="number" size="small"
            inputProps={{ min: 1, max: 20 }}
            value={voteThreshold} onChange={(e) => setDraft({ voteThreshold: e.target.value })}
            sx={{ mt: 1, width: { xs: '100%', sm: 200 } }}
          />
        )}
      </Box>

      <Box>
        <Button variant="outlined" size="small" onClick={handleSave}>Save Waiver Rules</Button>
      </Box>
    </Stack>
  );
}

function ForceRosterMoveCard({ leagueId, teams, notify, onRefresh }) {
  const [teamId, setTeamId] = useState('');
  const [action, setAction] = useState('add');
  const [player, setPlayer] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const report = fail(notify);

  const teamName = teams.find((t) => t.id === teamId)?.name;

  const handleConfirm = async () => {
    setConfirmOpen(false);
    try {
      await apiClient.post(`/api/commissioner/league/${leagueId}/force-transaction`, {
        teamId, action, playerId: player.id,
      });
      notify(`${action === 'add' ? 'Added' : 'Dropped'} ${player.name} for ${teamName}`);
      setPlayer(null);
      setResetKey((k) => k + 1);
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>Force Roster Move</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Add or drop a player on any manager's behalf. Bypasses waivers and roster locks.
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <TeamSelect label="Team" teams={teams} value={teamId} onChange={setTeamId} />
        <FormControl size="small" sx={fieldWidth(130)}>
          <InputLabel id="force-action-label">Action</InputLabel>
          <Select labelId="force-action-label" label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
            <MenuItem value="add">Add</MenuItem>
            <MenuItem value="drop">Drop</MenuItem>
          </Select>
        </FormControl>
        <PlayerSearchField
          key={resetKey}
          label="Player Search"
          helperText={action === 'drop' ? "Must be on that team's roster" : 'Any player not already rostered'}
          onSelect={setPlayer}
        />
        <Button
          variant="contained" color="warning" disabled={!teamId || !player}
          onClick={() => setConfirmOpen(true)}
        >
          Force Transaction
        </Button>
      </Box>
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Force {action === 'add' ? 'add' : 'drop'} {player?.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This immediately {action === 'add' ? 'adds' : 'drops'} {player?.name} {action === 'add' ? 'to' : 'from'}{' '}
            {teamName}&apos;s roster without their action. The owner will be notified.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="warning" variant="contained" onClick={handleConfirm}>Force Transaction</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function FaabEditorCard({ leagueId, teams, notify, onRefresh }) {
  const [teamId, setTeamId] = useState('');
  const [faabValue, setFaabValue] = useState('');
  const report = fail(notify);

  const handleTeamChange = (id) => {
    setTeamId(id);
    const team = teams.find((t) => t.id === id);
    setFaabValue(team && team.faab_remaining != null ? String(team.faab_remaining) : '');
  };

  const handleSave = async () => {
    try {
      await apiClient.put(`/api/commissioner/league/${leagueId}/teams/${teamId}/faab`, {
        faabRemaining: Number(faabValue),
      });
      notify('FAAB budget updated');
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>FAAB Budget Editor</Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TeamSelect label="Team" teams={teams} value={teamId} onChange={handleTeamChange} />
        <TextField
          label="Remaining FAAB" type="number" size="small" inputProps={{ min: 0, max: 1000 }}
          value={faabValue} onChange={(e) => setFaabValue(e.target.value)}
          disabled={!teamId} sx={{ width: 160 }}
        />
        <Button variant="outlined" size="small" disabled={!teamId || faabValue === ''} onClick={handleSave}>
          Save FAAB Budget
        </Button>
      </Box>
    </Box>
  );
}

function ScoreCorrectionCard({ leagueId, teams, notify, onRefresh }) {
  const [teamId, setTeamId] = useState('');
  const [week, setWeek] = useState('');
  const [matchup, setMatchup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [adjustment, setAdjustment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState('');
  const [correctionLocked, setCorrectionLocked] = useState(false);
  const report = fail(notify);

  useEffect(() => {
    if (!teamId || !week) {
      setMatchup(null);
      setChecked(false);
      setCorrectionError('');
      setCorrectionLocked(false);
      return;
    }
    let active = true;
    setLoading(true);
    setChecked(false);
    setCorrectionError('');
    setCorrectionLocked(false);
    apiClient
      .get(`/api/league/${leagueId}/matchups`, { params: { week } })
      .then((res) => {
        if (!active) return;
        const found = (res.data || []).find((m) => m.home_team_id === teamId || m.away_team_id === teamId);
        setMatchup(found || null);
      })
      .catch(() => active && setMatchup(null))
      .finally(() => {
        if (active) {
          setLoading(false);
          setChecked(true);
        }
      });
    return () => {
      active = false;
    };
  }, [leagueId, teamId, week]);

  const isHome = matchup && matchup.home_team_id === teamId;
  const currentScore = matchup ? Number(isHome ? matchup.home_score : matchup.away_score) : null;
  const opponentName = matchup ? (isHome ? matchup.away_team_name : matchup.home_team_name) : null;

  const handleApply = async () => {
    if (submitting || correctionLocked) return;
    const delta = Number(adjustment);
    const newScore = currentScore + delta;
    const homeScore = isHome ? newScore : Number(matchup.home_score);
    const awayScore = isHome ? Number(matchup.away_score) : newScore;
    setSubmitting(true);
    setCorrectionError('');
    try {
      const res = await apiClient.post(
        `/api/scoring/league/${leagueId}/correct-week`,
        {
          season: Number(matchup.season),
          week: Number(week),
          matchupId: matchup.id,
          homeScore,
          awayScore,
        }
      );
      // The correction endpoint returns the raw matchups row — it doesn't carry
      // the joined team names the GET does, so keep the ones already shown.
      setMatchup({ ...res.data, home_team_name: matchup.home_team_name, away_team_name: matchup.away_team_name });
      setAdjustment('');
      notify('Score correction applied');
      onRefresh();
    } catch (err) {
      const payload = err.response && err.response.data;
      if (err.response && err.response.status === 403 && payload && payload.error === 'CORRECTION_WINDOW_EXPIRED') {
        setCorrectionError(payload.message || 'Manual score modifications for this week are locked.');
        setCorrectionLocked(true);
      } else {
        report(err);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>Manual Score Correction</Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
        <TeamSelect label="Team" teams={teams} value={teamId} onChange={setTeamId} />
        <FormControl size="small" sx={fieldWidth(120)}>
          <InputLabel id="score-week-label">Week</InputLabel>
          <Select labelId="score-week-label" label="Week" value={week} onChange={(e) => setWeek(e.target.value)}>
            {WEEK_OPTIONS.map((w) => <MenuItem key={w} value={w}>Week {w}</MenuItem>)}
          </Select>
        </FormControl>
        {loading && <CircularProgress size={20} />}
      </Box>

      {checked && !loading && !matchup && (
        <Alert severity="warning" sx={{ mb: 1 }}>No matchup found for that team in week {week}.</Alert>
      )}

      {matchup && (
        <Box>
          {correctionError && <Alert severity="error" sx={{ mb: 1 }}>{correctionError}</Alert>}
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">
              Current score: <strong>{currentScore}</strong> vs {opponentName}
            </Typography>
            <TextField
              label="Adjustment (+/-)" type="number" size="small"
              value={adjustment} onChange={(e) => setAdjustment(e.target.value)}
              sx={{ width: 160 }}
            />
            <Button
              variant="outlined" size="small"
              disabled={adjustment === '' || submitting || correctionLocked}
              onClick={handleApply}
            >
              {submitting ? 'Submitting Correction…' : 'Apply Correction'}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function TeamLockList({ leagueId, teams, notify, onRefresh }) {
  const report = fail(notify);

  const handleToggle = async (team, locked) => {
    try {
      await apiClient.put(`/api/commissioner/league/${leagueId}/teams/${team.id}/lock`, { locked });
      notify(locked ? `${team.name} locked` : `${team.name} unlocked`);
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>Lock Specific Team</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Freezes one manager's adds, drops, waiver claims, and trades without locking the league.
      </Typography>
      {/* The switch is a flex child, not a `secondaryAction`: that slot is
          absolutely positioned against a fixed 48px row inset, and the switch
          is 64px wide once it carries a 44px touch target. As a child the row's
          own padding does the insetting and the two stay aligned. */}
      <List dense sx={{ bgcolor: 'var(--dash-surface2)', borderRadius: 1 }}>
        {teams.map((team) => (
          <ListItem key={team.id} sx={{ gap: 1 }}>
            <ListItemText primary={team.name} sx={{ my: 0 }} />
            <Switch
              checked={!!team.locked}
              onChange={(e) => handleToggle(team, e.target.checked)}
              inputProps={{ 'aria-label': `Lock ${team.name}` }}
              sx={{ flex: 'none' }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

// Manual matchup scheduling/scoring, moved here from the retired standalone
// Matchups page. These are low-level commissioner controls: (re)generate a
// week's schedule and force-score a week for a given season.
function MatchupOpsCard({ leagueId, league, notify, onRefresh }) {
  // Seeded from the league row, never from a literal. These fields used to be
  // useState('2025')/useState('1') with no `league` prop reaching this card at
  // all, so a 2026 commissioner who pressed Generate Matchups without editing
  // them inserted a 2025 week-1 schedule that no screen in the product can
  // delete. An empty seed (a league row with no current season) leaves the
  // buttons disabled rather than guessing a year.
  const [season, setSeason] = useState(league.current_season != null ? String(league.current_season) : '');
  const [week, setWeek] = useState(league.current_week != null ? String(league.current_week) : '');
  const [busy, setBusy] = useState(false);
  const report = fail(notify);

  const run = async (path, describe) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiClient.post(`/api/scoring/league/${leagueId}/${path}`, {
        season: parseInt(season, 10),
        week: parseInt(week, 10),
      });
      // The outcome, not an unconditional "success!". generateMatchups answers
      // 201 with `{ created: 0, reason }` when the week already has a schedule
      // or the league has fewer than two teams, and scoreMatchups answers 200
      // with an empty `scored` for a season/week that has no matchups - both of
      // which this card used to report as a job well done.
      const outcome = describe(res.data || {});
      notify(outcome.message, outcome.done ? undefined : { severity: 'warning' });
      if (outcome.done) onRefresh();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const invalid = !season || !week;

  const describeGenerate = ({ created = 0, reason }) => (created > 0
    ? { done: true, message: `Generated ${created} matchup${created === 1 ? '' : 's'} for week ${week}` }
    : { done: false, message: reason ? `No matchups generated · ${reason}` : 'No matchups generated' });

  const describeScore = ({ scored }) => {
    const count = Array.isArray(scored) ? scored.length : 0;
    return count > 0
      ? { done: true, message: `Scored ${count} matchup${count === 1 ? '' : 's'} in week ${week}` }
      : { done: false, message: `No matchups found for ${season} week ${week}` };
  };

  return (
    <Box>
      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>Matchup Scheduling &amp; Scoring</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Generate a week&apos;s matchups or force-score a completed week. Both default to this
        league&apos;s current season and week.
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <TextField
          label="Season" type="number" size="small" sx={{ width: 110 }}
          value={season} onChange={(e) => setSeason(e.target.value)}
        />
        <TextField
          label="Week Number" type="number" size="small" sx={{ width: 130 }}
          value={week} onChange={(e) => setWeek(e.target.value)}
        />
        <Button
          variant="outlined" size="small" disabled={invalid || busy}
          onClick={() => run('matchups', describeGenerate)}
        >
          Generate Matchups
        </Button>
        <Button
          variant="outlined" size="small" disabled={invalid || busy}
          onClick={() => run('score', describeScore)}
        >
          Score Week
        </Button>
      </Box>
    </Box>
  );
}

function SystemOverridesPanel({ leagueId, league, teams, notify, onRefresh }) {
  return (
    <Stack spacing={3} divider={<Divider />}>
      <ForceRosterMoveCard leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
      <FaabEditorCard leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
      <ScoreCorrectionCard leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
      <MatchupOpsCard leagueId={leagueId} league={league} notify={notify} onRefresh={onRefresh} />
      <TeamLockList leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
    </Stack>
  );
}

// The pick'em-only Season tab. The season runs itself (weeks follow the NFL
// calendar, completion after week 18 finalizes, champion awarded on
// completion), so the one commissioner action here is starting the next one.
function PickemSeasonPanel({ leagueId, league, onRefresh, notify }) {
  const complete = deriveLeaguePhase(league) === LEAGUE_PHASE.COMPLETE;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle2" component="h4" sx={{ mb: 0.5 }}>
          {league.current_season ? `${league.current_season} season` : 'Season'}
          {league.current_week != null && !complete ? ` · week ${league.current_week}` : ''}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          A pick&apos;em season runs on its own: weeks follow the NFL calendar, the season is
          complete once week 18&apos;s games are final, and the pick&apos;em champion is awarded
          then. There is no week to advance.
        </Typography>
      </Box>
      {complete ? (
        <DangerZone>
          <StartNewSeason
            leagueId={leagueId}
            league={league}
            onRefresh={onRefresh}
            notify={notify}
            caption="Archives this season's standings to League History and opens next season's picks."
          />
        </DangerZone>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Rollover to next season becomes available once this season is complete.
        </Typography>
      )}
    </Stack>
  );
}

const FANTASY_TABS = ['general', 'roster', 'scoring', 'playoffs', 'waivers', 'overrides'];
const PICKEM_TABS = ['general', 'season'];
const TAB_LABELS = {
  general: 'General Settings',
  season: 'Season',
  roster: 'Roster Settings',
  scoring: 'Scoring Settings',
  playoffs: 'Playoffs & Schedule',
  waivers: 'Waivers & Trades',
  overrides: 'System Overrides',
};

/**
 * A tab's label, plus its unsaved-edit marker when it has one.
 *
 * The marker is a dot AND the word "Unsaved" (WCAG 1.4.1): the dot alone would
 * carry the whole meaning in colour. The dot is `aria-hidden` and the word is
 * what the tab's accessible name gains, so a screen reader hears
 * "Scoring Settings, unsaved" rather than a decorative disc. The word inherits
 * the tab's own colour and composes no new pairing; the dot is a non-text
 * graphic in `--dash-warning`, which is a registered non-text pair over a card.
 */
function TabLabel({ label, dirty }) {
  if (!dirty) return label;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      {label}
      <Box
        component="span"
        aria-hidden="true"
        data-testid="tab-dirty-dot"
        sx={{
          width: 8,
          height: 8,
          borderRadius: 'var(--radius-pill)',
          backgroundColor: 'var(--dash-warning)',
          flex: 'none',
        }}
      />
      <Box component="span" sx={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.04em' }}>
        Unsaved
      </Box>
    </Box>
  );
}

// `isOwner` defaults to FALSE, not true (#188). It gates the two powers the
// creator cannot delegate - deleting the league, and managing this league's
// co-commissioners - so an unanswered role question has to mean "no". The old
// default handed both to any caller that forgot the prop.
function CommissionerTools({ leagueId, league, teams, viewerTeamId, isOwner = false, onRefresh }) {
  const notify = useSnackbar();
  const [selectedTab, setTab] = useState('general');
  const [drafts, setDrafts] = useState(() => takeStash(leagueId));
  const [discardTarget, setDiscardTarget] = useState(null);
  const discardTitleId = useId();
  const discardDescriptionId = useId();
  // A pick'em-only league has no roster, scoring, schedule, waiver or matchup
  // settings to expose: only General plus its own Season tab. The active tab
  // is derived from the league's own tab set rather than trusted from state:
  // a hash-only hop between two leagues keeps this component mounted, and a
  // fantasy tab left selected must not render its panel inside a pick'em
  // league (or 'season' inside a fantasy one).
  const pickemOnly = isPickemOnly(league);
  const tabs = pickemOnly ? PICKEM_TABS : FANTASY_TABS;
  const tab = tabs.includes(selectedTab) ? selectedTab : 'general';

  // The same hash-only hop the tab derivation above answers: this component
  // stays mounted across it, and one league's unsaved edits must never be
  // offered as another league's. Reset during render rather than in an effect,
  // because the panels below read `drafts` in THIS render.
  const [stashedLeagueId, setStashedLeagueId] = useState(leagueId);
  if (stashedLeagueId !== leagueId) {
    setStashedLeagueId(leagueId);
    setDrafts(takeStash(leagueId));
  }

  // Mirrored on every change rather than on unmount: collapsing the disclosure
  // above unmounts this tree without warning, so there is no teardown hook that
  // could be trusted to run first.
  //
  // Only the DIRTY drafts are stashed. A clean one has nothing to preserve, and
  // keeping it would shadow the league row on the next mount - so a setting a
  // co-commissioner changed while this panel was closed would come back showing
  // the value this browser last had rather than the one that is saved.
  useEffect(() => {
    const unsaved = Object.entries(drafts).filter(([, d]) => stableKey(d.values) !== d.baseline);
    draftStash = unsaved.length ? { leagueId, drafts: Object.fromEntries(unsaved) } : null;
  }, [leagueId, drafts]);

  const seedOf = useCallback((key) => {
    const values = DRAFT_SEEDS[key](league);
    return { values, baseline: stableKey(values) };
  }, [league]);

  const draftOf = (key) => (drafts[key] ?? seedOf(key)).values;

  // A patch, optionally derived from the values on screen. The baseline the
  // dirty marker compares against is installed with the seed and never moves
  // here, so an edit that puts a field back the way it was reads as clean.
  const patchDraft = useCallback((key, patch) => setDrafts((prev) => {
    const current = prev[key] ?? seedOf(key);
    const applied = typeof patch === 'function' ? patch(current.values) : patch;
    return { ...prev, [key]: { ...current, values: { ...current.values, ...applied } } };
  }), [seedOf]);

  // The seed itself, for a panel whose values are not a function of the league
  // row (Scoring builds its rules from a `/api/scoring/rules` read).
  const installDraft = useCallback((key, values) => setDrafts((prev) => ({
    ...prev,
    [key]: { values, baseline: stableKey(values) },
  })), []);

  // What was just saved IS the settings now, so the baseline moves to it. The
  // draft is kept rather than dropped: dropping it would re-seed the form from
  // the league row this component still holds, flashing the pre-save values
  // until the refetch behind `onRefresh` lands.
  const markSaved = useCallback((key) => setDrafts((prev) => (prev[key]
    ? { ...prev, [key]: { ...prev[key], baseline: stableKey(prev[key].values) } }
    : prev)), []);

  const isDirty = (key) => {
    const draft = drafts[key];
    return !!draft && stableKey(draft.values) !== draft.baseline;
  };

  const handleDiscard = () => {
    const key = discardTarget;
    setDiscardTarget(null);
    // The baseline is a serialisation of the seed, so it is also the way back
    // to it - no second copy of the seed has to be kept for this.
    setDrafts((prev) => (prev[key]
      ? { ...prev, [key]: { ...prev[key], values: JSON.parse(prev[key].baseline) } }
      : prev));
  };

  const panelProps = (key) => ({
    draft: draftOf(key),
    setDraft: (patch) => patchDraft(key, patch),
    markSaved: () => markSaved(key),
  });

  return (
    <Box sx={{ mt: 1.5, ...TOUCH_FLOOR_SX }}>
      <Box sx={{ p: { xs: 1.5, sm: 2 }, pb: 0 }}>
        {/* #682: this title sits directly under the commissioner-panel Card's
            <h2>. `component="h3"` sets its level explicitly while `variant="h6"`
            keeps its visual style unchanged. Per ADR 0021 (#695 ticket 1) the
            subtitle variants carry a type scale only, never a heading level, so
            each subtitle below now sets its own element (#695 ticket 2, this
            file's sweep): section subtitles use `component="h4"` for the level
            under this h3, and the two single-control-group labels ("Waiver
            System Type", "Trade Review System") render as <p> and name their
            RadioGroup via aria-labelledby. The panel's heading sequence is
            h2, h3, h4 with no level skipped. */}
        <Typography variant="h6" component="h3">Commissioner Tools</Typography>
      </Box>
      {/* `allowScrollButtonsMobile`, because MUI 5.16 defaults it to false and
          `scrollButtons="auto"` then resolves to `display: none` below sm: six
          tabs in a 288px strip showed one and a half of them with no affordance
          at all that the rest existed. The arrows also carry the tree's touch
          floor, which MUI's 40px default scroll button does not reach. */}
      <Tabs
        value={tab}
        onChange={(e, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label="Commissioner tools sections"
        data-testid="commissioner-tabs"
        sx={{
          px: { xs: 1.5, sm: 2 },
          mt: 1,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTabs-scrollButtons': { width: MIN_TOUCH_TARGET_SX.minWidth },
        }}
      >
        {tabs.map((key) => (
          <Tab key={key} value={key} label={<TabLabel label={TAB_LABELS[key]} dirty={isDirty(key)} />} />
        ))}
      </Tabs>

      {/* The unsaved edits are kept, so this is not a warning: it is the offer
          to throw them away, which is the only way to lose them now and is
          therefore the one thing that has to be confirmed. */}
      {isDirty(tab) && (
        <Box
          data-testid="commissioner-unsaved-bar"
          sx={{
            px: { xs: 1.5, sm: 2 },
            pt: 1.5,
            display: 'flex',
            gap: 1,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Unsaved changes on this tab. They are kept if you switch tabs or close this panel.
          </Typography>
          <Button size="small" color="error" onClick={() => setDiscardTarget(tab)}>
            Discard changes
          </Button>
        </Box>
      )}

      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        {tab === 'general' && (
          <GeneralSettingsPanel
            leagueId={leagueId} league={league} teams={teams} viewerTeamId={viewerTeamId} isOwner={isOwner}
            onRefresh={onRefresh} notify={notify} {...panelProps('general')}
          />
        )}
        {tab === 'season' && pickemOnly && (
          <PickemSeasonPanel leagueId={leagueId} league={league} onRefresh={onRefresh} notify={notify} />
        )}
        {tab === 'roster' && (
          <RosterSettingsPanel
            leagueId={leagueId} league={league} onRefresh={onRefresh} notify={notify} {...panelProps('roster')}
          />
        )}
        {tab === 'scoring' && (
          <ScoringSettingsPanel
            leagueId={leagueId} league={league} onRefresh={onRefresh} notify={notify}
            installDraft={(values) => installDraft('scoring', values)} {...panelProps('scoring')}
          />
        )}
        {tab === 'playoffs' && (
          <PlayoffSchedulePanel
            leagueId={leagueId} league={league} onRefresh={onRefresh} notify={notify} {...panelProps('playoffs')}
          />
        )}
        {tab === 'waivers' && (
          <WaiverTradePanel
            leagueId={leagueId} onRefresh={onRefresh} notify={notify} {...panelProps('waivers')}
          />
        )}
        {tab === 'overrides' && (
          <SystemOverridesPanel
            leagueId={leagueId} league={league} teams={teams} notify={notify} onRefresh={onRefresh}
          />
        )}
      </Box>

      <Dialog
        open={!!discardTarget}
        onClose={() => setDiscardTarget(null)}
        aria-labelledby={discardTitleId}
        aria-describedby={discardDescriptionId}
      >
        <DialogTitle id={discardTitleId}>Discard unsaved changes?</DialogTitle>
        <DialogContent>
          <DialogContentText id={discardDescriptionId}>
            {`The ${TAB_LABELS[discardTarget] || 'current'} tab goes back to the settings saved for this `
              + 'league. Nothing that is already saved changes.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiscardTarget(null)}>Keep editing</Button>
          <Button color="error" variant="contained" onClick={handleDiscard}>Discard</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default CommissionerTools;
