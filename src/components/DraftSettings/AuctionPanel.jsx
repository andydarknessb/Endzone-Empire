import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Box, Button, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import SortableTeamList from './SortableTeamList';

export default function AuctionPanel({ league, teams, frozen, onSave, saving }) {
  const initial = league.auction_settings || {};
  const [budget, setBudget] = useState(initial.budget ?? 200);
  const [nominationSeconds, setNominationSeconds] = useState(initial.nominationSeconds ?? 30);
  const [bidSeconds, setBidSeconds] = useState(initial.bidSeconds ?? 15);
  const [nominationOrder, setNominationOrder] = useState(initial.nominationOrder || 'random');
  const [customOrder, setCustomOrder] = useState(initial.nominationCustomOrder || teams.map((team) => team.id));
  useEffect(() => { const next = league.auction_settings || {}; setBudget(next.budget ?? 200); setNominationSeconds(next.nominationSeconds ?? 30); setBidSeconds(next.bidSeconds ?? 15); setNominationOrder(next.nominationOrder || 'random'); setCustomOrder(next.nominationCustomOrder || teams.map((team) => team.id)); }, [league.auction_settings, teams]);
  const rows = customOrder.map((id) => teams.find((team) => String(team.id) === String(id))).filter(Boolean).map((team) => ({ id: team.id, label: team.name || `Team ${team.id}`, secondary: team.owner }));
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">These settings are stored now for the future salary-cap draft engine.</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField label="Budget" type="number" value={budget} disabled={frozen} inputProps={{ min: 1, max: 10000 }} onChange={(event) => setBudget(event.target.value)} /><TextField label="Nomination seconds" type="number" value={nominationSeconds} disabled={frozen} inputProps={{ min: 10, max: 300 }} onChange={(event) => setNominationSeconds(event.target.value)} /><TextField label="Bid seconds" type="number" value={bidSeconds} disabled={frozen} inputProps={{ min: 5, max: 60 }} onChange={(event) => setBidSeconds(event.target.value)} /></Stack>
      <RadioGroup value={nominationOrder} onChange={(event) => setNominationOrder(event.target.value)}><FormControlLabel value="random" disabled={frozen} control={<Radio />} label="Random nomination order" /><FormControlLabel value="custom" disabled={frozen} control={<Radio />} label="Custom nomination order" /></RadioGroup>
      {nominationOrder === 'custom' && <SortableTeamList items={rows} onChange={(next) => setCustomOrder(next.map((row) => Number(row.id)))} disabled={frozen} />}
      <Box><Button variant="contained" disabled={frozen || saving} onClick={() => onSave({ auctionSettings: { budget: Number(budget), nominationSeconds: Number(nominationSeconds), bidSeconds: Number(bidSeconds), nominationOrder, nominationCustomOrder: nominationOrder === 'custom' ? customOrder.map(Number) : null } }, 'Auction settings saved')}>Save auction settings</Button></Box>
    </Stack>
  );
}

AuctionPanel.propTypes = { league: PropTypes.object.isRequired, teams: PropTypes.array.isRequired, frozen: PropTypes.bool.isRequired, onSave: PropTypes.func.isRequired, saving: PropTypes.bool };
