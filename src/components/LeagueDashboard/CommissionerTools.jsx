import React, { useState, useEffect } from 'react';
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
import { deriveLeaguePhase, draftSettingsFrozen, LEAGUE_PHASE } from '../../lib/leaguePhase';
import { teamNameLabel } from '../../lib/teamIdentity';

const PLAYOFF_TEAM_OPTIONS = [4, 6, 8];
const PLAYOFF_START_WEEK_OPTIONS = [14, 15, 16, 17, 18];
const WEEK_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 1);
const WAIVER_PERIOD_OPTIONS = [
  { hours: 24, label: '24 hours after a drop' },
  { hours: 48, label: '48 hours after a drop' },
  { hours: 72, label: '72 hours after a drop' },
];

const fail = (notify) => (err) => notify(err.response?.data?.error || err.message, { severity: 'error' });

function TeamSelect({ label, teams, value, onChange, disabled }) {
  return (
    <FormControl size="small" disabled={disabled} sx={{ minWidth: 200 }}>
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
      sx={{ minWidth: 260 }}
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

  const grantedIds = new Set((league.co_commissioners || []).map((c) => c.user_id));
  // Each grant already names its own Team: listCoCommissioners LEFT JOINs it
  // and ships `teamId` / `teamName` (#112), which is what LeagueOfficials
  // renders. This used to rebuild that join client-side by matching
  // `c.user_id` against `teams[].owner_id`, re-deriving from account fields an
  // answer the payload carried (#188) - and overwriting the real `teamName`
  // with null whenever the rebuild missed.
  //
  // Since #324 the roster is DISPLAYED by Team here as well: the grant's
  // `user_id` reaches this card only because it is commissioner-conditional
  // payload, and only the revoke call is built from it. A team-less grant
  // therefore has no name of its own and reads as a former manager - the one
  // place it is still listed, because this card is the only place it can be
  // revoked and it leaves the member-visible roster entirely.
  //
  // Losing the username cost this card its guarantee that two rows read
  // differently, in TWO states and not one. A team-less grant has no name at
  // all, which is brief. Two co-commissioners whose Teams share a NAME is the
  // one that matters: `teams.name` has no unique constraint and CONTEXT.md
  // blesses duplicates ("a duplicate Team name is still valid identity"), so
  // that state is permanent and the league did nothing wrong to reach it.
  // revokeLabel above is what answers both; see its comment for why it carries
  // a date and an ordinal rather than the account that used to do the job.
  const coCommissioners = league.co_commissioners || [];
  // Sanctioned direct owner_id comparison: granting a co-commissioner is one
  // of the three owner-shaped actions leagueRole.service's header enumerates,
  // and the creator is already the commissioner, so they are never a
  // candidate. This stays account-id-shaped because the endpoint behind it is:
  // POST /api/league/:id/co-commissioners takes a `userId`, so the option's
  // value has to be one. Moving this pair onto Team identity is a client and
  // server change together, not a client-side rewrite.
  const eligible = teams.filter(
    (team) => team.owner_id != null && team.owner_id !== league.owner_id && !grantedIds.has(team.owner_id)
  );

  const handlePromote = async () => {
    setBusy(true);
    try {
      await apiClient.post(`/api/league/${leagueId}/co-commissioners`, { userId: Number(promoteId) });
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
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Co-commissioners</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Co-commissioners get every commissioner power except deleting the league
        and managing this list.
      </Typography>
      {coCommissioners.length > 0 ? (
        <List dense sx={{ bgcolor: 'background.default', borderRadius: 1, mb: 1 }}>
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
        <FormControl size="small" sx={{ minWidth: 220 }} disabled={eligible.length === 0}>
          <InputLabel id="promote-co-commissioner-label">Add a co-commissioner</InputLabel>
          <Select
            labelId="promote-co-commissioner-label"
            label="Add a co-commissioner"
            value={promoteId}
            onChange={(e) => setPromoteId(e.target.value)}
          >
            {eligible.map((team) => (
              <MenuItem key={team.owner_id} value={team.owner_id}>
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

function GeneralSettingsPanel({ leagueId, league, teams, viewerTeamId, isOwner, onRefresh, notify }) {
  const [sizeMin, setSizeMin] = useState(league.min_teams ?? '');
  const [sizeMax, setSizeMax] = useState(league.max_teams ?? '');
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

  const handleRollover = async () => {
    try {
      await apiClient.post(`/api/commissioner/league/${leagueId}/rollover`, {});
      notify('New season started!');
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  // "Which of these is me" is always a Team ID comparison against the
  // viewer-relative field (CONTEXT.md, Team identity), never a username or an
  // owner-user-ID: both leave league-shared payloads under #115, and a
  // username can change out from under a stale comparison anyway (#185).
  //
  // Read `teamId`, the contract name, and not the raw `teams.id` that league
  // detail still selects beside it (#188): every other "which of these is me"
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

      {!pickemOnly && seasonComplete && (
        <Box>
          <Button variant="contained" color="secondary" onClick={handleRollover}>
            Start New Season
          </Button>
        </Box>
      )}

      {limitsEditable && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {pickemOnly ? 'Team limit' : 'Team limits (editable until the draft starts)'}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            {!pickemOnly && (
              <TextField
                label="Min teams" type="number" size="small" inputProps={{ min: MIN_TEAMS, max: maxTeamsCap }}
                value={sizeMin} onChange={(e) => setSizeMin(e.target.value)} sx={{ width: 130 }}
              />
            )}
            <TextField
              label="Max teams" type="number" size="small" inputProps={{ min: MIN_TEAMS, max: maxTeamsCap }}
              value={sizeMax} onChange={(e) => setSizeMax(e.target.value)} sx={{ width: 130 }}
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
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Remove a team</Typography>
        {/* The server's own refusal, restated rather than reworded: removeTeam
            raises exactly this on a 409, and that 409 was the only place the
            rule was ever stated to a user. Keeping the wording identical means
            the person who hits it by another route reads the same sentence. */}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Your own team and the league creator&apos;s team can&apos;t be removed.
        </Typography>
        <List dense sx={{ bgcolor: 'background.default', borderRadius: 1 }}>
          {removableTeams.map((team) => (
            <ListItem
              key={team.teamId}
              secondaryAction={
                <IconButton
                  edge="end"
                  aria-label={`Remove ${team.name}`}
                  color="error"
                  onClick={() => setRemoveTarget(team)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemText primary={team.name} />
            </ListItem>
          ))}
        </List>
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
            <Typography variant="subtitle2">Join Requests</Typography>
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
    </Stack>
  );
}

// One-click lineup templates: known-good slot arrays a commissioner can stamp
// in instead of hand-building rows. Applying one only replaces the local form
// state — nothing is saved until Save Roster Settings.
const STANDARD_LINEUP = [
  { key: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];
const LINEUP_TEMPLATES = [
  { name: 'Standard', slots: STANDARD_LINEUP, dpEnabled: false },
  {
    name: 'Superflex',
    slots: [...STANDARD_LINEUP, { key: 'SFLX', count: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] }],
    dpEnabled: false,
  },
  {
    name: 'IDP starter',
    slots: [
      ...STANDARD_LINEUP,
      { key: 'DL', count: 1, eligiblePositions: ['DL'] },
      { key: 'LB', count: 1, eligiblePositions: ['LB'] },
      { key: 'DB', count: 1, eligiblePositions: ['DB'] },
    ],
    dpEnabled: true,
  },
];

function RosterSettingsPanel({ leagueId, league, onRefresh, notify }) {
  const [slots, setSlots] = useState(
    (league.roster_slots || []).map((s, i) => ({ ...s, _id: i }))
  );
  const [nextId, setNextId] = useState(slots.length);
  const [benchSlots, setBenchSlots] = useState(league.bench_slots ?? 5);
  const [irSlots, setIrSlots] = useState(league.ir_slots ?? 1);
  const [dpEnabled, setDpEnabled] = useState(!!league.dp_enabled);
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

  const updateSlot = (id, patch) => setSlots((prev) => prev.map((s) => (s._id === id ? { ...s, ...patch } : s)));
  const removeSlot = (id) => setSlots((prev) => prev.filter((s) => s._id !== id));
  const addSlot = () => {
    setSlots((prev) => [...prev, { _id: nextId, key: '', count: 1, eligiblePositions: [] }]);
    setNextId((n) => n + 1);
  };
  const addIdpFlexSlot = () => {
    setSlots((prev) => {
      // A second identical flex spot is the same slot with a higher count —
      // slot names are identifiers and must stay unique, so clicking again
      // bumps the existing row instead of duplicating it.
      const existing = prev.find((s) => String(s.key).trim().toUpperCase() === 'IDP FLEX');
      if (existing) {
        return prev.map((s) => (s === existing ? { ...s, count: (Number(s.count) || 0) + 1 } : s));
      }
      return [...prev, { _id: nextId, key: 'IDP FLEX', count: 1, eligiblePositions: [...DP_GROUP_KEYS] }];
    });
    setNextId((n) => n + 1);
    setDpEnabled(true);
  };

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
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Starting Lineup Slots</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            Templates:
          </Typography>
          {LINEUP_TEMPLATES.map((template) => (
            <Chip
              key={template.name} label={template.name} size="small" variant="outlined"
              disabled={frozen}
              onClick={() => {
                setSlots(template.slots.map((s, i) => ({ ...s, _id: nextId + i })));
                setNextId((n) => n + template.slots.length);
                if (template.dpEnabled) setDpEnabled(true);
              }}
            />
          ))}
        </Stack>
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
              <FormControl size="small" disabled={frozen} sx={{ minWidth: 260 }}>
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
          control={<Switch checked={dpEnabled} disabled={frozen} onChange={(e) => setDpEnabled(e.target.checked)} />}
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
          value={benchSlots} onChange={(e) => setBenchSlots(e.target.value)}
          sx={{ width: 130 }}
        />
        <TextField
          label="IR Slots" type="number" size="small" disabled={frozen}
          inputProps={{ min: 0, max: 5 }}
          value={irSlots} onChange={(e) => setIrSlots(e.target.value)}
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

function ScoringSettingsPanel({ leagueId, league, onRefresh, notify }) {
  const [defaults, setDefaults] = useState(null);
  const [rules, setRules] = useState(null);
  // Two-step reset guard: first click arms, second click actually resets.
  const [confirmReset, setConfirmReset] = useState(false);
  const report = fail(notify);
  const frozen = draftSettingsFrozen(league);

  useEffect(() => {
    let active = true;
    apiClient
      .get('/api/scoring/rules')
      .then((res) => {
        if (!active) return;
        setDefaults(res.data.defaults);
        setRules(buildInitialRules(res.data.defaults, league.scoring_rules));
      })
      .catch(() => active && notify('Failed to load scoring defaults', { severity: 'error' }));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  if (!rules) return <CircularProgress size={24} />;

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

  const handleReset = () => setRules(buildInitialRules(defaults, null));

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

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">Quick preset:</Typography>
        {RECEPTION_PRESETS.map(({ name, reception }) => (
          <Chip
            key={name} label={name} size="small" disabled={frozen}
            color={activeReception === reception ? 'primary' : 'default'}
            variant={activeReception === reception ? 'filled' : 'outlined'}
            onClick={() => applyReceptionPreset(reception)}
          />
        ))}
        <Typography variant="caption" color="text.secondary">
          Sets the reception rate; every other rule stays as configured.
        </Typography>
      </Stack>

      {categories.map((category) => {
        const idpLocked = category === 'idp' && !league.dp_enabled;
        const fieldsDisabled = frozen || idpLocked;
        const leaves = Object.entries(rules[category]).filter(([, v]) => !Array.isArray(v));
        const tiers = Object.entries(rules[category]).filter(([, v]) => Array.isArray(v));
        return (
          <Box key={category}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{CATEGORY_LABELS[category]}</Typography>
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

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
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

function PlayoffSchedulePanel({ leagueId, league, onRefresh, notify }) {
  const [playoffTeams, setPlayoffTeams] = useState(league.playoff_teams ?? 4);
  const [startWeek, setStartWeek] = useState((league.regular_season_weeks ?? 14) + 1);
  const [consolation, setConsolation] = useState(!!league.playoff_consolation);
  const [tradeDeadlineWeek, setTradeDeadlineWeek] = useState(league.trade_deadline_week ?? '');
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
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Playoff Structure</Typography>
        {frozen && (
          <Alert severity="info" sx={{ mb: 2 }}>
            The playoff structure locks once the draft starts, so the bracket stays consistent
            all season.
          </Alert>
        )}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
          <FormControl size="small" disabled={frozen} sx={{ minWidth: 160 }}>
            <InputLabel id="playoff-teams-label">Playoff Teams</InputLabel>
            <Select
              labelId="playoff-teams-label" label="Playoff Teams"
              value={playoffTeams} onChange={(e) => setPlayoffTeams(e.target.value)}
            >
              {PLAYOFF_TEAM_OPTIONS.map((n) => <MenuItem key={n} value={n}>{n} teams</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" disabled={frozen} sx={{ minWidth: 180 }}>
            <InputLabel id="playoff-start-label">Playoff Start Week</InputLabel>
            <Select
              labelId="playoff-start-label" label="Playoff Start Week"
              value={startWeek} onChange={(e) => setStartWeek(e.target.value)}
            >
              {PLAYOFF_START_WEEK_OPTIONS.map((w) => <MenuItem key={w} value={w}>Week {w}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <FormControlLabel
          disabled={frozen}
          control={<Switch checked={consolation} onChange={(e) => setConsolation(e.target.checked)} />}
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
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Trade Deadline</Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="trade-deadline-label">Trade Deadline</InputLabel>
            <Select
              labelId="trade-deadline-label" label="Trade Deadline"
              value={tradeDeadlineWeek} onChange={(e) => setTradeDeadlineWeek(e.target.value)}
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

function WaiverTradePanel({ leagueId, league, onRefresh, notify }) {
  const [waiverType, setWaiverType] = useState(league.waiver_type || 'priority');
  const [continuous, setContinuous] = useState((league.waiver_period_hours ?? 24) === 0);
  const [waiverPeriodHours, setWaiverPeriodHours] = useState(
    league.waiver_period_hours && league.waiver_period_hours > 0 ? league.waiver_period_hours : 24
  );
  const initialReviewMode = league.trade_review_hours === 0
    ? 'instant'
    : (league.trade_veto_votes ?? 0) === 0 ? 'commissioner' : 'vote';
  const [reviewMode, setReviewMode] = useState(initialReviewMode);
  const [voteThreshold, setVoteThreshold] = useState(league.trade_veto_votes > 0 ? league.trade_veto_votes : 3);
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
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Waiver System Type</Typography>
        <RadioGroup row value={waiverType} onChange={(e) => setWaiverType(e.target.value)}>
          <FormControlLabel value="faab" control={<Radio />} label="FAAB (Bidding)" />
          <FormControlLabel value="priority" control={<Radio />} label="Rolling Priority" />
        </RadioGroup>
      </Box>

      <Box>
        <FormControlLabel
          control={<Switch checked={continuous} onChange={(e) => setContinuous(e.target.checked)} />}
          label="Continuous waivers (players clear immediately, no waiting period)"
        />
        {!continuous && (
          <FormControl size="small" sx={{ mt: 1, ml: 4.5, minWidth: 240, display: 'block' }}>
            <InputLabel id="waiver-period-label">Waiver Clear Period</InputLabel>
            <Select
              labelId="waiver-period-label" label="Waiver Clear Period"
              value={waiverPeriodHours} onChange={(e) => setWaiverPeriodHours(e.target.value)}
            >
              {WAIVER_PERIOD_OPTIONS.map((o) => <MenuItem key={o.hours} value={o.hours}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
        )}
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Trade Review System</Typography>
        <RadioGroup value={reviewMode} onChange={(e) => setReviewMode(e.target.value)}>
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
            value={voteThreshold} onChange={(e) => setVoteThreshold(e.target.value)}
            sx={{ mt: 1, width: 200 }}
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
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Force Roster Move</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Add or drop a player on any manager's behalf. Bypasses waivers and roster locks.
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <TeamSelect label="Team" teams={teams} value={teamId} onChange={setTeamId} />
        <FormControl size="small" sx={{ minWidth: 130 }}>
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
      <Typography variant="subtitle2" sx={{ mb: 1 }}>FAAB Budget Editor</Typography>
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
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Manual Score Correction</Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
        <TeamSelect label="Team" teams={teams} value={teamId} onChange={setTeamId} />
        <FormControl size="small" sx={{ minWidth: 120 }}>
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
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Lock Specific Team</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Freezes one manager's adds, drops, waiver claims, and trades without locking the league.
      </Typography>
      <List dense sx={{ bgcolor: 'background.default', borderRadius: 1 }}>
        {teams.map((team) => (
          <ListItem
            key={team.id}
            secondaryAction={
              <Switch
                checked={!!team.locked}
                onChange={(e) => handleToggle(team, e.target.checked)}
                inputProps={{ 'aria-label': `Lock ${team.name}` }}
              />
            }
          >
            <ListItemText primary={team.name} />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

// Manual matchup scheduling/scoring, moved here from the retired standalone
// Matchups page. These are low-level commissioner controls: (re)generate a
// week's schedule and force-score a week for a given season.
function MatchupOpsCard({ leagueId, notify, onRefresh }) {
  const [season, setSeason] = useState('2025');
  const [week, setWeek] = useState('1');
  const [busy, setBusy] = useState(false);
  const report = fail(notify);

  const run = async (path, successMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/scoring/league/${leagueId}/${path}`, {
        season: parseInt(season, 10),
        week: parseInt(week, 10),
      });
      notify(successMsg);
      onRefresh();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  const invalid = !season || !week;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Matchup Scheduling &amp; Scoring</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Generate a week&apos;s matchups or force-score a completed week.
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <TextField
          label="Season" type="number" size="small" sx={{ width: 100 }}
          value={season} onChange={(e) => setSeason(e.target.value)}
        />
        <TextField
          label="Week Number" type="number" size="small" sx={{ width: 130 }}
          value={week} onChange={(e) => setWeek(e.target.value)}
        />
        <Button
          variant="outlined" size="small" disabled={invalid || busy}
          onClick={() => run('matchups', 'Matchups generated successfully!')}
        >
          Generate Matchups
        </Button>
        <Button
          variant="outlined" size="small" disabled={invalid || busy}
          onClick={() => run('score', 'Week scored successfully!')}
        >
          Score Week
        </Button>
      </Box>
    </Box>
  );
}

function SystemOverridesPanel({ leagueId, teams, notify, onRefresh }) {
  return (
    <Stack spacing={3} divider={<Divider />}>
      <ForceRosterMoveCard leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
      <FaabEditorCard leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
      <ScoreCorrectionCard leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
      <MatchupOpsCard leagueId={leagueId} notify={notify} onRefresh={onRefresh} />
      <TeamLockList leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
    </Stack>
  );
}

// The pick'em-only Season tab. The season runs itself (weeks follow the NFL
// calendar, completion after week 18 finalizes, champion awarded on
// completion), so the one commissioner action here is starting the next one.
function PickemSeasonPanel({ leagueId, league, onRefresh, notify }) {
  const report = fail(notify);
  const complete = deriveLeaguePhase(league) === LEAGUE_PHASE.COMPLETE;

  const handleRollover = async () => {
    try {
      await apiClient.post(`/api/commissioner/league/${leagueId}/rollover`, {});
      notify('New season started!');
      onRefresh();
    } catch (err) {
      report(err);
    }
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
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
        <Box>
          <Button variant="contained" color="secondary" onClick={handleRollover}>
            Start New Season
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Archives this season&apos;s standings to League History and opens next season&apos;s picks.
          </Typography>
        </Box>
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

// `isOwner` defaults to FALSE, not true (#188). It gates the two powers the
// creator cannot delegate - deleting the league, and managing this league's
// co-commissioners - so an unanswered role question has to mean "no". The old
// default handed both to any caller that forgot the prop.
function CommissionerTools({ leagueId, league, teams, viewerTeamId, isOwner = false, onRefresh }) {
  const notify = useSnackbar();
  const [selectedTab, setTab] = useState('general');
  // A pick'em-only league has no roster, scoring, schedule, waiver or matchup
  // settings to expose: only General plus its own Season tab. The active tab
  // is derived from the league's own tab set rather than trusted from state:
  // a hash-only hop between two leagues keeps this component mounted, and a
  // fantasy tab left selected must not render its panel inside a pick'em
  // league (or 'season' inside a fantasy one).
  const pickemOnly = isPickemOnly(league);
  const tabs = pickemOnly ? PICKEM_TABS : FANTASY_TABS;
  const tab = tabs.includes(selectedTab) ? selectedTab : 'general';

  return (
    <Paper sx={{ mt: 3 }}>
      <Box sx={{ p: 2, pb: 0 }}>
        <Typography variant="h6">Commissioner Tools</Typography>
      </Box>
      <Tabs
        value={tab}
        onChange={(e, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ px: 2, mt: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="General Settings" value="general" />
        {pickemOnly ? (
          <Tab label="Season" value="season" />
        ) : (
          [
            <Tab key="roster" label="Roster Settings" value="roster" />,
            <Tab key="scoring" label="Scoring Settings" value="scoring" />,
            <Tab key="playoffs" label="Playoffs & Schedule" value="playoffs" />,
            <Tab key="waivers" label="Waivers & Trades" value="waivers" />,
            <Tab key="overrides" label="System Overrides" value="overrides" />,
          ]
        )}
      </Tabs>
      <Box sx={{ p: 2 }}>
        {tab === 'general' && (
          <GeneralSettingsPanel
            leagueId={leagueId} league={league} teams={teams} viewerTeamId={viewerTeamId} isOwner={isOwner}
            onRefresh={onRefresh} notify={notify}
          />
        )}
        {tab === 'season' && pickemOnly && (
          <PickemSeasonPanel leagueId={leagueId} league={league} onRefresh={onRefresh} notify={notify} />
        )}
        {tab === 'roster' && (
          <RosterSettingsPanel leagueId={leagueId} league={league} onRefresh={onRefresh} notify={notify} />
        )}
        {tab === 'scoring' && (
          <ScoringSettingsPanel leagueId={leagueId} league={league} onRefresh={onRefresh} notify={notify} />
        )}
        {tab === 'playoffs' && (
          <PlayoffSchedulePanel leagueId={leagueId} league={league} onRefresh={onRefresh} notify={notify} />
        )}
        {tab === 'waivers' && (
          <WaiverTradePanel leagueId={leagueId} league={league} onRefresh={onRefresh} notify={notify} />
        )}
        {tab === 'overrides' && (
          <SystemOverridesPanel leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
        )}
      </Box>
    </Paper>
  );
}

export default CommissionerTools;
