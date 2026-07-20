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
import apiClient from '../../api/apiClient';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

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

function GeneralSettingsPanel({ leagueId, league, teams, user, standingsLeague, onRefresh, notify }) {
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
      await apiClient.put(`/api/league/${leagueId}`, {
        minTeams: Number(sizeMin),
        maxTeams: Number(sizeMax),
      });
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

  const removableTeams = teams.filter((team) => team.owner !== user.username);

  return (
    <Stack spacing={3}>
      <Box>
        <FormControlLabel
          control={<Switch checked={!!league.transactions_locked} onChange={handleToggleTransactionsLock} />}
          label="Lock Transactions"
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4.5 }}>
          Freezes adds, drops, waiver claims, and trades for the entire league.
        </Typography>
      </Box>

      {standingsLeague && standingsLeague.season_status === 'complete' && (
        <Box>
          <Button variant="contained" color="secondary" onClick={handleRollover}>
            Start New Season
          </Button>
        </Box>
      )}

      {league.draft_status === 'pending' && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Team limits (editable until the draft starts)
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="Min teams" type="number" size="small" inputProps={{ min: 2, max: 20 }}
              value={sizeMin} onChange={(e) => setSizeMin(e.target.value)} sx={{ width: 130 }}
            />
            <TextField
              label="Max teams" type="number" size="small" inputProps={{ min: 2, max: 20 }}
              value={sizeMax} onChange={(e) => setSizeMax(e.target.value)} sx={{ width: 130 }}
            />
            <Button variant="outlined" size="small" onClick={handleSaveLimits}>Save Limits</Button>
          </Box>
        </Box>
      )}

      {removableTeams.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Remove a team</Typography>
          <List dense sx={{ bgcolor: 'background.default', borderRadius: 1 }}>
            {removableTeams.map((team) => (
              <ListItem
                key={team.id}
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
                <ListItemText primary={team.name} secondary={team.owner} />
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)}>
        <DialogTitle>Remove {removeTarget?.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently removes the team, its roster, and its matchup history from the
            league. The owner will be notified. This can&apos;t be undone.
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
          {joinRequests.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No pending join requests</Typography>
          ) : (
            <Stack spacing={1}>
              {joinRequests.map((request) => (
                <Box key={request.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Typography sx={{ flexGrow: 1 }}>
                    {request.username} — {request.team_name} — {new Date(request.created_at).toLocaleString()}
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

const ROSTER_POSITION_OPTIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
const DP_GROUP_KEYS = ['DL', 'LB', 'DB'];

function RosterSettingsPanel({ leagueId, league, onRefresh, notify }) {
  const [slots, setSlots] = useState(
    (league.roster_slots || []).map((s, i) => ({ ...s, _id: i }))
  );
  const [nextId, setNextId] = useState(slots.length);
  const [benchSlots, setBenchSlots] = useState(league.bench_slots ?? 5);
  const [irSlots, setIrSlots] = useState(league.ir_slots ?? 1);
  const [dpEnabled, setDpEnabled] = useState(!!league.dp_enabled);
  const report = fail(notify);

  const frozen = league.draft_status !== 'pending';

  const starters = slots.reduce((sum, s) => sum + (Number(s.count) || 0), 0);
  const dpStarters = slots
    .filter((s) => (s.eligiblePositions || []).length > 0 && s.eligiblePositions.every((p) => DP_GROUP_KEYS.includes(p)))
    .reduce((sum, s) => sum + (Number(s.count) || 0), 0);
  const totalRosterSize = starters + (Number(benchSlots) || 0) + (Number(irSlots) || 0);

  const updateSlot = (id, patch) => setSlots((prev) => prev.map((s) => (s._id === id ? { ...s, ...patch } : s)));
  const removeSlot = (id) => setSlots((prev) => prev.filter((s) => s._id !== id));
  const addSlot = () => {
    setSlots((prev) => [...prev, { _id: nextId, key: '', count: 1, eligiblePositions: [] }]);
    setNextId((n) => n + 1);
  };

  const handleSave = async () => {
    const payload = slots.map(({ key, count, eligiblePositions }) => ({
      key: String(key).trim().toUpperCase(),
      count: Number(count) || 0,
      eligiblePositions: eligiblePositions || [],
    }));
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
          {dpEnabled ? ` — currently ${dpStarters}/3.` : '.'}
        </Typography>
      </Box>

      <Divider />

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          label="Bench Slots" type="number" size="small" disabled={frozen}
          inputProps={{ min: 0, max: 5 }}
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
          Total roster size: <strong>{totalRosterSize}</strong> ({starters} starters + {Number(benchSlots) || 0} bench + {Number(irSlots) || 0} IR)
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

const RULE_CATEGORIES = ['passing', 'rushing', 'receiving', 'misc', 'kicking', 'teamDefense', 'idp'];
const CATEGORY_LABELS = {
  passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', misc: 'Misc',
  kicking: 'Kicking', teamDefense: 'Team Defense', idp: 'Individual Defense (IDP)',
};
const LEAF_LABELS = {
  yards: 'Per Yard', touchdowns: 'Touchdown', interceptions: 'Interception',
  twoPointConversions: '2-Pt Conversion', reception: 'Reception', fumblesLost: 'Fumble Lost',
  extraPoint: 'Extra Point', sack: 'Sack', interception: 'Interception',
  fumbleRecovery: 'Fumble Recovery', defensiveTD: 'Defensive TD', safety: 'Safety',
  blockedKick: 'Blocked Kick', soloTackle: 'Solo Tackle', assistedTackle: 'Assisted Tackle',
  forcedFumble: 'Forced Fumble', passDeflection: 'Pass Deflection', qbHit: 'QB Hit',
  tacklesForLoss: 'Tackle For Loss', twoPointReturn: '2-Pt Return',
};
const TIER_LABELS = {
  fieldGoal: 'Field Goal (by distance)', pointsAllowed: 'Points Allowed', yardsAllowed: 'Yards Allowed',
};

// Client-side mirror of scoring.service.js's mergeRuleCategory — only used
// to seed the editor's initial values from a league's stored (possibly
// partial) scoring_rules; the server re-validates and re-merges on save.
function mergeCategoryClient(defaults, custom) {
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(custom || {})) {
    if (!(key in defaults)) continue;
    if (Array.isArray(defaults[key])) {
      if (Array.isArray(value) && value.length > 0) {
        merged[key] = value.map((t) => ({
          min: Number(t.min),
          max: t.max === null || t.max === undefined ? null : Number(t.max),
          points: Number(t.points),
        }));
      }
    } else if (Number.isFinite(Number(value))) {
      merged[key] = Number(value);
    }
  }
  return merged;
}

function buildInitialRules(defaults, custom) {
  const rules = {};
  for (const [category, catDefaults] of Object.entries(defaults)) {
    const customCategory = custom && typeof custom === 'object' ? custom[category] : null;
    rules[category] = customCategory && typeof customCategory === 'object' && !Array.isArray(customCategory)
      ? mergeCategoryClient(catDefaults, customCategory)
      : { ...catDefaults };
  }
  return rules;
}

function ScoringSettingsPanel({ leagueId, league, onRefresh, notify }) {
  const [defaults, setDefaults] = useState(null);
  const [rules, setRules] = useState(null);
  const report = fail(notify);
  const frozen = league.draft_status !== 'pending';

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

  const categories = RULE_CATEGORIES.filter((c) => c in rules && (c !== 'idp' || league.dp_enabled));

  return (
    <Stack spacing={3}>
      {frozen && (
        <Alert severity="info">
          Scoring rules lock once the draft starts, so every week is scored under the same rules.
        </Alert>
      )}

      {categories.map((category) => {
        const leaves = Object.entries(rules[category]).filter(([, v]) => !Array.isArray(v));
        const tiers = Object.entries(rules[category]).filter(([, v]) => Array.isArray(v));
        return (
          <Box key={category}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{CATEGORY_LABELS[category]}</Typography>
            {leaves.length > 0 && (
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: tiers.length > 0 ? 2 : 0 }}>
                {leaves.map(([key, value]) => (
                  <TextField
                    key={key} label={LEAF_LABELS[key] || key} type="number" size="small" disabled={frozen}
                    inputProps={{ step: 0.1, min: -50, max: 50 }}
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
                    <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField
                        label="Min" type="number" size="small" disabled={frozen}
                        value={tier.min} onChange={(e) => setTier(category, key, i, 'min', e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        label="Max" type="number" size="small" disabled={frozen} placeholder="and up"
                        value={tier.max === null ? '' : tier.max}
                        onChange={(e) => setTier(category, key, i, 'max', e.target.value === '' ? null : e.target.value)}
                        sx={{ width: 90 }}
                      />
                      <TextField
                        label="Points" type="number" size="small" disabled={frozen}
                        value={tier.points} onChange={(e) => setTier(category, key, i, 'points', e.target.value)}
                        sx={{ width: 90 }}
                      />
                    </Box>
                  ))}
                </Stack>
              </Box>
            ))}
          </Box>
        );
      })}

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button variant="outlined" size="small" disabled={frozen} onClick={handleSave}>
          Save Scoring Settings
        </Button>
        <Button size="small" disabled={frozen} onClick={handleReset}>
          Reset Scoring Settings
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

  const frozen = league.draft_status !== 'pending';

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
            Trades execute immediately — no review window, no vetoes.
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
        Add or drop a player on any manager's behalf — bypasses waivers and roster locks.
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
  const report = fail(notify);

  useEffect(() => {
    if (!teamId || !week) {
      setMatchup(null);
      setChecked(false);
      return;
    }
    let active = true;
    setLoading(true);
    setChecked(false);
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
    const delta = Number(adjustment);
    const newScore = currentScore + delta;
    const homeScore = isHome ? newScore : Number(matchup.home_score);
    const awayScore = isHome ? Number(matchup.away_score) : newScore;
    try {
      const res = await apiClient.put(
        `/api/commissioner/league/${leagueId}/matchups/${matchup.id}`,
        { homeScore, awayScore }
      );
      // The commissioner PUT returns the raw matchups row — it doesn't carry
      // the joined team names the GET does, so keep the ones already shown.
      setMatchup({ ...res.data, home_team_name: matchup.home_team_name, away_team_name: matchup.away_team_name });
      setAdjustment('');
      notify('Score correction applied');
      onRefresh();
    } catch (err) {
      report(err);
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
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">
            Current score: <strong>{currentScore}</strong> vs {opponentName}
          </Typography>
          <TextField
            label="Adjustment (+/-)" type="number" size="small"
            value={adjustment} onChange={(e) => setAdjustment(e.target.value)}
            sx={{ width: 160 }}
          />
          <Button variant="outlined" size="small" disabled={adjustment === ''} onClick={handleApply}>
            Apply Correction
          </Button>
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
            <ListItemText primary={team.name} secondary={team.owner} />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

function SystemOverridesPanel({ leagueId, teams, notify, onRefresh }) {
  return (
    <Stack spacing={3} divider={<Divider />}>
      <ForceRosterMoveCard leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
      <FaabEditorCard leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
      <ScoreCorrectionCard leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
      <TeamLockList leagueId={leagueId} teams={teams} notify={notify} onRefresh={onRefresh} />
    </Stack>
  );
}

function CommissionerTools({ leagueId, league, teams, user, standingsLeague, onRefresh }) {
  const notify = useSnackbar();
  const [tab, setTab] = useState('general');

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
        <Tab label="Roster Settings" value="roster" />
        <Tab label="Scoring Settings" value="scoring" />
        <Tab label="Playoffs & Schedule" value="playoffs" />
        <Tab label="Waivers & Trades" value="waivers" />
        <Tab label="System Overrides" value="overrides" />
      </Tabs>
      <Box sx={{ p: 2 }}>
        {tab === 'general' && (
          <GeneralSettingsPanel
            leagueId={leagueId} league={league} teams={teams} user={user}
            standingsLeague={standingsLeague} onRefresh={onRefresh} notify={notify}
          />
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
