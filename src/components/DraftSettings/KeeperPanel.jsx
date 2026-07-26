import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Alert, Autocomplete, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Radio, RadioGroup, Select, Stack, Switch, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import IconButton from '@mui/material/IconButton';
import apiClient from '../../api/apiClient';
import { integerRangeError } from './numericValidation';

const EMPTY_PLAYERS = [];
const localKeeperLock = (value) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const keeperRows = (keepers) => keepers.map((keeper) => ({ teamId: keeper.team_id, player: { id: keeper.player_id, name: keeper.name, position: keeper.position }, round: keeper.draft_round }));
const normalizedKeepers = (rows) => rows.map((row) => ({ teamId: Number(row.teamId), playerId: Number(row.player?.id), round: Number(row.round) }));

function keeperAssignmentErrors(rows, keeperCount, teams) {
  const errors = rows.map(() => []);
  const seenPlayers = new Set();
  const seenTeamRounds = new Set();
  const acceptedRowsByTeam = new Map();
  const teamNames = new Map(teams.map((team) => [Number(team.id), team.name || `Team ${team.id}`]));

  rows.forEach((row, index) => {
    const teamId = Number(row.teamId);
    const playerId = Number(row.player?.id);
    const round = Number(row.round);
    if (!Number.isInteger(teamId) || !Number.isInteger(playerId) || !Number.isInteger(round)) return;

    if (seenPlayers.has(playerId)) {
      errors[index].push(`${row.player?.name || 'Player'} is assigned more than once.`);
      return;
    }
    seenPlayers.add(playerId);

    const teamRound = `${teamId}:${round}`;
    if (seenTeamRounds.has(teamRound)) {
      errors[index].push(`${teamNames.get(teamId) || `Team ${teamId}`} already has a keeper in round ${round}.`);
      return;
    }
    seenTeamRounds.add(teamRound);
    acceptedRowsByTeam.set(teamId, [...(acceptedRowsByTeam.get(teamId) || []), index]);
  });

  for (const [teamId, indexes] of acceptedRowsByTeam) {
    indexes.slice(keeperCount).forEach((index) => {
      errors[index].push(`${teamNames.get(teamId) || `Team ${teamId}`} exceeds the ${keeperCount} keeper limit.`);
    });
  }
  return errors;
}

function PlayerPicker({ value, onChange, disabled, rosterPlayers }) {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState([]);
  // idle | loading | error — lets a failed search read differently from a
  // search that simply found nothing.
  const [searchStatus, setSearchStatus] = useState('idle');
  useEffect(() => {
    if (rosterPlayers.length > 0) {
      setOptions(rosterPlayers);
      setSearchStatus('idle');
      return undefined;
    }
    const query = input.trim();
    if (query.length < 2) { setOptions(value ? [value] : []); setSearchStatus('idle'); return undefined; }
    // The cleanup below aborts this request whenever a newer search starts
    // (input/deps change) or the component unmounts, so a slow response can
    // never overwrite results from a search issued after it.
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearchStatus('loading');
      try {
        const result = await apiClient.get('/api/players', { params: { search: query, page: 1 }, signal: controller.signal });
        if (cancelled) return;
        setOptions(result.data.players || result.data || []);
        setSearchStatus('idle');
      } catch (error) {
        if (cancelled) return;
        setOptions(value ? [value] : []);
        setSearchStatus('error');
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [input, rosterPlayers, value]);
  const noOptionsText = searchStatus === 'error'
    ? 'Unable to search players right now.'
    : input.trim().length < 2
      ? 'Type at least 2 characters to search'
      : 'No matching players';
  return <Autocomplete
    size="small"
    disabled={disabled}
    options={options}
    value={value || null}
    loading={searchStatus === 'loading'}
    noOptionsText={rosterPlayers.length > 0 ? 'No rostered players' : noOptionsText}
    filterOptions={rosterPlayers.length > 0 ? undefined : (items) => items}
    getOptionLabel={(player) => player?.name || ''}
    isOptionEqualToValue={(a, b) => a.id === b.id}
    onInputChange={(event, next, reason) => { if (reason !== 'reset') setInput(next); }}
    onChange={(event, next) => onChange(next)}
    renderInput={(params) => <TextField
      {...params}
      label="Player"
      placeholder={rosterPlayers.length > 0 ? 'Select rostered player' : 'Search players'}
      error={searchStatus === 'error'}
      helperText={searchStatus === 'error' ? 'Unable to search players right now.' : undefined}
      InputProps={{
        ...params.InputProps,
        endAdornment: <>{searchStatus === 'loading' ? <CircularProgress color="inherit" size={16} /> : null}{params.InputProps.endAdornment}</>,
      }}
    />}
  />;
}

export default function KeeperPanel({ league, teams, keepers, keeperCandidates, frozen, onSaveLeague, onSaveKeepers, saving, onSettingsDirtyChange, onAssignmentsDirtyChange }) {
  const [enabled, setEnabled] = useState(!!league.keepers_enabled);
  const [count, setCount] = useState(league.keeper_count ?? 0);
  const [lockMode, setLockMode] = useState(league.keeper_lock_at ? 'custom' : 'draft');
  const [lockAt, setLockAt] = useState(localKeeperLock(league.keeper_lock_at));
  const [rows, setRows] = useState(() => keeperRows(keepers));
  const [confirmSettingsSave, setConfirmSettingsSave] = useState(false);
  useEffect(() => { setEnabled(!!league.keepers_enabled); setCount(league.keeper_count ?? 0); setLockMode(league.keeper_lock_at ? 'custom' : 'draft'); setLockAt(localKeeperLock(league.keeper_lock_at)); }, [league.keepers_enabled, league.keeper_count, league.keeper_lock_at]);
  useEffect(() => setRows(keeperRows(keepers)), [keepers]);
  const settingsChanged = enabled !== Boolean(league.keepers_enabled)
    || Number(count) !== (league.keeper_count ?? 0)
    || lockMode !== (league.keeper_lock_at ? 'custom' : 'draft')
    || (lockMode === 'custom' && lockAt !== localKeeperLock(league.keeper_lock_at));
  const assignmentsChanged = JSON.stringify(normalizedKeepers(rows)) !== JSON.stringify(normalizedKeepers(keeperRows(keepers)));
  useEffect(() => {
    onSettingsDirtyChange(settingsChanged);
  }, [onSettingsDirtyChange, settingsChanged]);
  useEffect(() => {
    onAssignmentsDirtyChange(assignmentsChanged);
  }, [assignmentsChanged, onAssignmentsDirtyChange]);
  const candidatesByTeam = useMemo(() => keeperCandidates.reduce((map, player) => {
    const key = String(player.team_id);
    map.set(key, [...(map.get(key) || []), player]);
    return map;
  }, new Map()), [keeperCandidates]);
  const playersForTeam = (teamId) => candidatesByTeam.get(String(teamId)) || EMPTY_PLAYERS;
  const changeRow = (index, patch) => setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  const allowedKeeperCount = Math.max(0, Number(league.keeper_count) || 0);
  const rowCountsByTeam = useMemo(() => rows.reduce((counts, row) => {
    const teamId = String(row.teamId);
    counts.set(teamId, (counts.get(teamId) || 0) + 1);
    return counts;
  }, new Map()), [rows]);
  const nextTeamWithCapacity = teams.find((team) => (rowCountsByTeam.get(String(team.id)) || 0) < allowedKeeperCount);
  const insufficientTeams = teams.length < 2;
  const addRow = () => {
    if (!nextTeamWithCapacity) return;
    setRows((current) => [...current, { teamId: nextTeamWithCapacity.id, player: null, round: 1 }]);
  };
  const assignmentErrors = useMemo(() => keeperAssignmentErrors(rows, allowedKeeperCount, teams), [allowedKeeperCount, rows, teams]);
  const hasAssignmentErrors = assignmentErrors.some((rowErrors) => rowErrors.length > 0);
  const preview = rows.reduce((map, row) => { if (row.player && row.teamId && row.round) map.set(`${row.round}-${row.teamId}`, row.player.name); return map; }, new Map());
  const keeperCountError = integerRangeError(count, { label: 'Keepers per team', min: 0, max: Number(league.roster_limit) });
  const saveSettings = async () => {
    const result = await onSaveLeague({ keepersEnabled: enabled, keeperCount: Number(count), keeperLockAt: lockMode === 'custom' && lockAt ? new Date(lockAt).toISOString() : null }, 'Keeper settings saved');
    if (result?.success !== false) setConfirmSettingsSave(false);
  };
  const requestSettingsSave = () => {
    if (assignmentsChanged) setConfirmSettingsSave(true);
    else saveSettings();
  };
  return <Stack spacing={2}>
    <FormControlLabel control={<Switch checked={enabled} disabled={frozen} onChange={(event) => setEnabled(event.target.checked)} />} label="Enable keepers" />
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start"><TextField label="Keepers per team" type="number" disabled={frozen || !enabled} value={count} inputProps={{ min: 0, max: league.roster_limit }} error={Boolean(keeperCountError)} helperText={keeperCountError} onChange={(event) => setCount(event.target.value)} /><Box><Typography variant="subtitle2">Keeper lock</Typography><RadioGroup row value={lockMode} onChange={(event) => setLockMode(event.target.value)}><FormControlLabel value="draft" disabled={frozen || !enabled} control={<Radio />} label="Draft date" /><FormControlLabel value="custom" disabled={frozen || !enabled} control={<Radio />} label="Custom" /></RadioGroup>{lockMode === 'custom' && <TextField label="Keeper lock date and time" type="datetime-local" size="small" InputLabelProps={{ shrink: true }} sx={(theme) => ({ mt: 1, colorScheme: theme.palette.mode })} value={lockAt} disabled={frozen || !enabled} onChange={(event) => setLockAt(event.target.value)} />}</Box></Stack>
    <Box><Button variant="contained" disabled={frozen || saving || Boolean(keeperCountError)} onClick={requestSettingsSave}>Save keeper settings</Button></Box>
    <Dialog open={confirmSettingsSave} onClose={() => !saving && setConfirmSettingsSave(false)}><DialogTitle>Save keeper settings?</DialogTitle><DialogContent><DialogContentText>You have unsaved keeper assignment changes. Saving these settings will keep those assignment edits in place so you can save them separately.</DialogContentText></DialogContent><DialogActions><Button disabled={saving} onClick={() => setConfirmSettingsSave(false)}>Cancel</Button><Button variant="contained" disabled={saving} onClick={saveSettings}>Save settings and keep edits</Button></DialogActions></Dialog>
    {enabled && <><Typography variant="subtitle2">Keeper assignments</Typography><Typography variant="caption" color="text.secondary">Select from a team&apos;s roster. Empty pre-season rosters allow player search; the server re-validates every assignment when saved.</Typography>{insufficientTeams && <Alert severity="info">Add at least 2 teams to assign keepers.</Alert>}<Stack spacing={1}>{rows.map((row, index) => <Box key={`${row.teamId}-${row.player?.id || index}-${index}`}><Box aria-invalid={assignmentErrors[index].length > 0} aria-describedby={assignmentErrors[index].length > 0 ? `keeper-row-${index}-errors` : undefined} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px 1fr 120px auto' }, gap: 1, alignItems: 'center' }}><FormControl size="small" disabled={frozen}><InputLabel id={`keeper-team-${index}`}>Team</InputLabel><Select labelId={`keeper-team-${index}`} label="Team" value={row.teamId} onChange={(event) => changeRow(index, { teamId: event.target.value, player: null })}>{teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</Select></FormControl><PlayerPicker value={row.player} onChange={(player) => changeRow(index, { player })} disabled={frozen} rosterPlayers={playersForTeam(row.teamId)} /><FormControl size="small" disabled={frozen}><InputLabel id={`keeper-round-${index}`}>Round</InputLabel><Select labelId={`keeper-round-${index}`} label="Round" value={row.round} onChange={(event) => changeRow(index, { round: Number(event.target.value) })}>{Array.from({ length: Number(league.roster_limit) || 0 }, (_, i) => <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>)}</Select></FormControl><IconButton aria-label="Remove keeper" disabled={frozen} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}><DeleteIcon /></IconButton></Box>{assignmentErrors[index].length > 0 && <FormHelperText id={`keeper-row-${index}-errors`} error>{assignmentErrors[index].join(' ')}</FormHelperText>}</Box>)}</Stack><Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}><Button variant="outlined" disabled={frozen || insufficientTeams || !nextTeamWithCapacity} onClick={addRow}>Add keeper</Button><Button variant="contained" disabled={frozen || saving || hasAssignmentErrors || rows.some((row) => !row.player || !row.teamId || !row.round)} onClick={() => onSaveKeepers(rows.map((row) => ({ teamId: Number(row.teamId), playerId: Number(row.player.id), round: Number(row.round) })))}>Save assignments</Button></Box>
    <Box><Typography variant="subtitle2" sx={{ mb: 1 }}>Keeper board preview</Typography><Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, teams.length)}, minmax(120px, 1fr))`, gap: 1, overflowX: 'auto' }}>{teams.map((team) => <Box key={team.id} sx={{ minWidth: 120 }}><Typography variant="caption">{team.name}</Typography>{Array.from({ length: Math.min(6, Number(league.roster_limit) || 0) }, (_, index) => <Box key={index + 1} sx={{ border: '1px solid', borderColor: preview.has(`${index + 1}-${team.id}`) ? 'success.main' : 'divider', borderRadius: 0.5, p: 0.5, mt: 0.5, minHeight: 28 }}><Typography variant="caption">R{index + 1}: {preview.get(`${index + 1}-${team.id}`) || '-'}</Typography></Box>)}</Box>)}</Box></Box></>}
  </Stack>;
}

KeeperPanel.propTypes = { league: PropTypes.object.isRequired, teams: PropTypes.array.isRequired, keepers: PropTypes.array.isRequired, keeperCandidates: PropTypes.array.isRequired, frozen: PropTypes.bool.isRequired, onSaveLeague: PropTypes.func.isRequired, onSaveKeepers: PropTypes.func.isRequired, saving: PropTypes.bool, onSettingsDirtyChange: PropTypes.func.isRequired, onAssignmentsDirtyChange: PropTypes.func.isRequired };
