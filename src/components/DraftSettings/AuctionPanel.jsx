import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Alert, Box, Button, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import SortableTeamList from './SortableTeamList';
import { integerRangeError } from './numericValidation';

function reconcileCustomOrder(savedOrder, teams) {
  const liveTeams = new Map(teams.map((team) => [String(team.id), team.id]));
  const seen = new Set();
  const retained = (savedOrder || []).reduce((order, id) => {
    const key = String(id);
    if (liveTeams.has(key) && !seen.has(key)) {
      seen.add(key);
      order.push(liveTeams.get(key));
    }
    return order;
  }, []);
  return [...retained, ...teams.filter((team) => !seen.has(String(team.id))).map((team) => team.id)];
}

export default function AuctionPanel({ league, teams, frozen, onSave, saving, onDirtyChange }) {
  const initial = league.auction_settings || {};
  const [budget, setBudget] = useState(initial.budget ?? 200);
  const [nominationSeconds, setNominationSeconds] = useState(initial.nominationSeconds ?? 30);
  const [bidSeconds, setBidSeconds] = useState(initial.bidSeconds ?? 15);
  const [nominationOrder, setNominationOrder] = useState(initial.nominationOrder || 'random');
  const [customOrder, setCustomOrder] = useState(() => reconcileCustomOrder(initial.nominationCustomOrder, teams));
  useEffect(() => { const next = league.auction_settings || {}; setBudget(next.budget ?? 200); setNominationSeconds(next.nominationSeconds ?? 30); setBidSeconds(next.bidSeconds ?? 15); setNominationOrder(next.nominationOrder || 'random'); setCustomOrder(reconcileCustomOrder(next.nominationCustomOrder, teams)); }, [league.auction_settings, teams]);
  useEffect(() => {
    const saved = league.auction_settings || {};
    const valuesChanged = Number(budget) !== (saved.budget ?? 200)
      || Number(nominationSeconds) !== (saved.nominationSeconds ?? 30)
      || Number(bidSeconds) !== (saved.bidSeconds ?? 15)
      || nominationOrder !== (saved.nominationOrder || 'random');
    const customOrderChanged = nominationOrder === 'custom'
      && JSON.stringify(customOrder.map(Number)) !== JSON.stringify((saved.nominationCustomOrder || []).map(Number));
    onDirtyChange(valuesChanged || customOrderChanged);
  }, [bidSeconds, budget, customOrder, league.auction_settings, nominationOrder, nominationSeconds, onDirtyChange]);
  const budgetError = integerRangeError(budget, { label: 'Budget', min: 1, max: 10000 });
  const nominationSecondsError = integerRangeError(nominationSeconds, { label: 'Nomination seconds', min: 10, max: 300 });
  const bidSecondsError = integerRangeError(bidSeconds, { label: 'Bid seconds', min: 5, max: 60 });
  const hasInvalidNumber = Boolean(budgetError || nominationSecondsError || bidSecondsError);
  const customOrderIsCurrent = customOrder.length === teams.length && customOrder.every((id) => teams.some((team) => String(team.id) === String(id)));
  const rows = customOrder.map((id) => teams.find((team) => String(team.id) === String(id))).filter(Boolean).map((team) => ({ id: team.id, label: team.name || `Team ${team.id}`, secondary: team.owner }));
  const insufficientTeams = teams.length < 2;
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">These settings are stored now for the future salary-cap draft engine.</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField label="Budget" type="number" value={budget} disabled={frozen} inputProps={{ min: 1, max: 10000 }} error={Boolean(budgetError)} helperText={budgetError} onChange={(event) => setBudget(event.target.value)} /><TextField label="Nomination seconds" type="number" value={nominationSeconds} disabled={frozen} inputProps={{ min: 10, max: 300 }} error={Boolean(nominationSecondsError)} helperText={nominationSecondsError} onChange={(event) => setNominationSeconds(event.target.value)} /><TextField label="Bid seconds" type="number" value={bidSeconds} disabled={frozen} inputProps={{ min: 5, max: 60 }} error={Boolean(bidSecondsError)} helperText={bidSecondsError} onChange={(event) => setBidSeconds(event.target.value)} /></Stack>
      <RadioGroup value={nominationOrder} onChange={(event) => setNominationOrder(event.target.value)}><FormControlLabel value="random" disabled={frozen} control={<Radio />} label="Random nomination order" /><FormControlLabel value="custom" disabled={frozen || insufficientTeams} control={<Radio />} label="Custom nomination order" /></RadioGroup>
      {insufficientTeams && <Alert severity="info">Add at least 2 teams to set a custom nomination order.</Alert>}
      {nominationOrder === 'custom' && !insufficientTeams && <SortableTeamList items={rows} onChange={(next) => setCustomOrder(next.map((row) => Number(row.id)))} disabled={frozen} />}
      <Box><Button variant="contained" disabled={frozen || saving || hasInvalidNumber || (nominationOrder === 'custom' && (insufficientTeams || !customOrderIsCurrent))} onClick={() => onSave({ auctionSettings: { budget: Number(budget), nominationSeconds: Number(nominationSeconds), bidSeconds: Number(bidSeconds), nominationOrder, nominationCustomOrder: nominationOrder === 'custom' ? customOrder.map(Number) : null } }, 'Auction settings saved')}>Save auction settings</Button></Box>
    </Stack>
  );
}

AuctionPanel.propTypes = { league: PropTypes.object.isRequired, teams: PropTypes.array.isRequired, frozen: PropTypes.bool.isRequired, onSave: PropTypes.func.isRequired, saving: PropTypes.bool, onDirtyChange: PropTypes.func.isRequired };
