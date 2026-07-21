import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Autocomplete, Box, Button, FormControl, FormControlLabel, InputLabel, MenuItem, Radio, RadioGroup, Select, Stack, Switch, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import IconButton from '@mui/material/IconButton';
import apiClient from '../../api/apiClient';

const EMPTY_PLAYERS = [];

function PlayerPicker({ value, onChange, disabled, rosterPlayers }) {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState([]);
  useEffect(() => {
    if (rosterPlayers.length > 0) {
      setOptions(rosterPlayers);
      return undefined;
    }
    const query = input.trim();
    if (query.length < 2) { setOptions(value ? [value] : []); return undefined; }
    const timeout = setTimeout(async () => {
      try { const result = await apiClient.get('/api/players', { params: { search: query, page: 1 } }); setOptions(result.data.players || result.data || []); } catch (error) { setOptions(value ? [value] : []); }
    }, 250);
    return () => clearTimeout(timeout);
  }, [input, rosterPlayers, value]);
  return <Autocomplete size="small" disabled={disabled} options={options} value={value || null} filterOptions={rosterPlayers.length > 0 ? undefined : (items) => items} getOptionLabel={(player) => player?.name || ''} isOptionEqualToValue={(a, b) => a.id === b.id} onInputChange={(event, next, reason) => { if (reason !== 'reset') setInput(next); }} onChange={(event, next) => onChange(next)} renderInput={(params) => <TextField {...params} label="Player" placeholder={rosterPlayers.length > 0 ? 'Select rostered player' : 'Search players'} />} />;
}

export default function KeeperPanel({ league, teams, keepers, keeperCandidates, frozen, onSaveLeague, onSaveKeepers, saving }) {
  const [enabled, setEnabled] = useState(!!league.keepers_enabled);
  const [count, setCount] = useState(league.keeper_count ?? 0);
  const [lockMode, setLockMode] = useState(league.keeper_lock_at ? 'custom' : 'draft');
  const [lockAt, setLockAt] = useState(league.keeper_lock_at ? new Date(new Date(league.keeper_lock_at).getTime() - new Date(league.keeper_lock_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const [rows, setRows] = useState([]);
  useEffect(() => { setEnabled(!!league.keepers_enabled); setCount(league.keeper_count ?? 0); setLockMode(league.keeper_lock_at ? 'custom' : 'draft'); setLockAt(league.keeper_lock_at ? new Date(new Date(league.keeper_lock_at).getTime() - new Date(league.keeper_lock_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''); }, [league.keepers_enabled, league.keeper_count, league.keeper_lock_at]);
  useEffect(() => setRows(keepers.map((keeper) => ({ teamId: keeper.team_id, player: { id: keeper.player_id, name: keeper.name, position: keeper.position }, round: keeper.draft_round }))), [keepers]);
  const candidatesByTeam = useMemo(() => keeperCandidates.reduce((map, player) => {
    const key = String(player.team_id);
    map.set(key, [...(map.get(key) || []), player]);
    return map;
  }, new Map()), [keeperCandidates]);
  const playersForTeam = (teamId) => candidatesByTeam.get(String(teamId)) || EMPTY_PLAYERS;
  const changeRow = (index, patch) => setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  const addRow = () => setRows((current) => [...current, { teamId: teams[0]?.id || '', player: null, round: 1 }]);
  const preview = rows.reduce((map, row) => { if (row.player && row.teamId && row.round) map.set(`${row.round}-${row.teamId}`, row.player.name); return map; }, new Map());
  return <Stack spacing={2}>
    <FormControlLabel control={<Switch checked={enabled} disabled={frozen} onChange={(event) => setEnabled(event.target.checked)} />} label="Enable keepers" />
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start"><TextField label="Keepers per team" type="number" disabled={frozen || !enabled} value={count} inputProps={{ min: 0, max: league.roster_limit }} onChange={(event) => setCount(event.target.value)} /><Box><Typography variant="subtitle2">Keeper lock</Typography><RadioGroup row value={lockMode} onChange={(event) => setLockMode(event.target.value)}><FormControlLabel value="draft" disabled={frozen || !enabled} control={<Radio />} label="Draft date" /><FormControlLabel value="custom" disabled={frozen || !enabled} control={<Radio />} label="Custom" /></RadioGroup>{lockMode === 'custom' && <TextField type="datetime-local" size="small" InputLabelProps={{ shrink: true }} sx={(theme) => ({ mt: 1, colorScheme: theme.palette.mode })} value={lockAt} disabled={frozen || !enabled} onChange={(event) => setLockAt(event.target.value)} />}</Box></Stack>
    <Box><Button variant="contained" disabled={frozen || saving} onClick={() => onSaveLeague({ keepersEnabled: enabled, keeperCount: Number(count), keeperLockAt: lockMode === 'custom' && lockAt ? new Date(lockAt).toISOString() : null }, 'Keeper settings saved')}>Save keeper settings</Button></Box>
    {enabled && <><Typography variant="subtitle2">Keeper assignments</Typography><Typography variant="caption" color="text.secondary">Select from a team&apos;s roster. Empty pre-season rosters allow player search; the server confirms duplicate slots when saved.</Typography><Stack spacing={1}>{rows.map((row, index) => <Box key={`${row.teamId}-${row.player?.id || index}-${index}`} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px 1fr 120px auto' }, gap: 1, alignItems: 'center' }}><FormControl size="small" disabled={frozen}><InputLabel id={`keeper-team-${index}`}>Team</InputLabel><Select labelId={`keeper-team-${index}`} label="Team" value={row.teamId} onChange={(event) => changeRow(index, { teamId: event.target.value, player: null })}>{teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</Select></FormControl><PlayerPicker value={row.player} onChange={(player) => changeRow(index, { player })} disabled={frozen} rosterPlayers={playersForTeam(row.teamId)} /><FormControl size="small" disabled={frozen}><InputLabel id={`keeper-round-${index}`}>Round</InputLabel><Select labelId={`keeper-round-${index}`} label="Round" value={row.round} onChange={(event) => changeRow(index, { round: Number(event.target.value) })}>{Array.from({ length: Number(league.roster_limit) || 0 }, (_, i) => <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>)}</Select></FormControl><IconButton aria-label="Remove keeper" disabled={frozen} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}><DeleteIcon /></IconButton></Box>)}</Stack><Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}><Button variant="outlined" disabled={frozen || rows.length >= Number(count) * teams.length} onClick={addRow}>Add keeper</Button><Button variant="contained" disabled={frozen || saving || rows.some((row) => !row.player || !row.teamId || !row.round)} onClick={() => onSaveKeepers(rows.map((row) => ({ teamId: Number(row.teamId), playerId: Number(row.player.id), round: Number(row.round) })))}>Save assignments</Button></Box>
    <Box><Typography variant="subtitle2" sx={{ mb: 1 }}>Keeper board preview</Typography><Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, teams.length)}, minmax(120px, 1fr))`, gap: 1, overflowX: 'auto' }}>{teams.map((team) => <Box key={team.id} sx={{ minWidth: 120 }}><Typography variant="caption">{team.name}</Typography>{Array.from({ length: Math.min(6, Number(league.roster_limit) || 0) }, (_, index) => <Box key={index + 1} sx={{ border: '1px solid', borderColor: preview.has(`${index + 1}-${team.id}`) ? 'success.main' : 'divider', borderRadius: 0.5, p: 0.5, mt: 0.5, minHeight: 28 }}><Typography variant="caption">R{index + 1}: {preview.get(`${index + 1}-${team.id}`) || '—'}</Typography></Box>)}</Box>)}</Box></Box></>}
  </Stack>;
}

KeeperPanel.propTypes = { league: PropTypes.object.isRequired, teams: PropTypes.array.isRequired, keepers: PropTypes.array.isRequired, keeperCandidates: PropTypes.array.isRequired, frozen: PropTypes.bool.isRequired, onSaveLeague: PropTypes.func.isRequired, onSaveKeepers: PropTypes.func.isRequired, saving: PropTypes.bool };
