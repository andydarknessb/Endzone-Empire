import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SortableTeamList from './SortableTeamList';

const effectiveOrder = (teams, rotation, round) => rotation === 'snake' && round % 2 === 0 ? [...teams].reverse() : [...teams];

export default function DraftOrderPanel({ league, teams, frozen, onSave, onSetOrder, onRandomize, saving, onDirtyChange }) {
  const [order, setOrder] = useState([]);
  const [overrides, setOverrides] = useState(league.draft_order_overrides || {});
  useEffect(() => { setOrder([...teams].sort((a, b) => (a.draft_position || 999) - (b.draft_position || 999))); }, [teams]);
  useEffect(() => setOverrides(league.draft_order_overrides || {}), [league.draft_order_overrides]);
  useEffect(() => {
    const savedOrder = [...teams].sort((a, b) => (a.draft_position || 999) - (b.draft_position || 999)).map((team) => team.id);
    const orderChanged = JSON.stringify(order.map((team) => team.id)) !== JSON.stringify(savedOrder);
    const overridesChanged = JSON.stringify(overrides) !== JSON.stringify(league.draft_order_overrides || {});
    onDirtyChange(orderChanged || overridesChanged);
  }, [league.draft_order_overrides, onDirtyChange, order, overrides, teams]);
  const teamMap = useMemo(() => new Map(teams.map((team) => [String(team.id), team])), [teams]);
  const labels = (ids) => ids.map((id) => teamMap.get(String(id))).filter(Boolean).map((team) => ({ id: team.id, label: team.name || `Team ${team.id}`, secondary: team.owner }));
  const saveOverrides = () => onSave({ draftOrderOverrides: Object.keys(overrides).length ? overrides : null }, 'Round overrides saved');
  const setRound = (round, rows) => setOverrides((current) => ({ ...current, [round]: rows.map((row) => Number(row.id)) }));
  return (
    <Stack spacing={2}>
      {frozen && <Alert severity="info">Draft order is locked once the draft starts.</Alert>}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}><Button variant="outlined" disabled={frozen || saving} onClick={onRandomize}>Randomize order</Button><Button variant="contained" disabled={frozen || saving} onClick={() => onSetOrder(order.map((team) => team.id))}>Save order</Button></Box>
      <Typography variant="subtitle2">Round 1 order</Typography>
      <SortableTeamList items={labels(order.map((team) => team.id))} onChange={(rows) => setOrder(rows.map((row) => teamMap.get(String(row.id))))} disabled={frozen} />
      <Typography variant="subtitle2">Rotation preview</Typography>
      {[1, 2, 3].map((round) => <Typography key={round} variant="body2">Round {round}: {labels(overrides[round] || effectiveOrder(order, league.draft_rotation || 'snake', round).map((team) => team.id)).map((team) => team.label).join(' · ') || 'Set the round 1 order first'}</Typography>)}
      <Typography variant="subtitle2">Round overrides</Typography>
      {Array.from({ length: Math.min(Number(league.roster_limit) || 0, 18) }, (_, index) => index + 1).map((round) => {
        const rows = labels(overrides[round] || effectiveOrder(order, league.draft_rotation || 'snake', round).map((team) => team.id));
        return <Accordion key={round} disabled={frozen}><AccordionSummary expandIcon={<ExpandMoreIcon />}>Round {round}{overrides[round] ? ' — custom' : ''}</AccordionSummary><AccordionDetails><Stack spacing={1}><SortableTeamList items={rows} onChange={(next) => setRound(round, next)} disabled={frozen} /><Box><Button size="small" disabled={!overrides[round]} onClick={() => setOverrides((current) => { const next = { ...current }; delete next[round]; return next; })}>Clear round override</Button></Box></Stack></AccordionDetails></Accordion>;
      })}
      <Box><Button variant="contained" disabled={frozen || saving} onClick={saveOverrides}>Save round overrides</Button></Box>
    </Stack>
  );
}

DraftOrderPanel.propTypes = { league: PropTypes.object.isRequired, teams: PropTypes.array.isRequired, frozen: PropTypes.bool.isRequired, onSave: PropTypes.func.isRequired, onSetOrder: PropTypes.func.isRequired, onRandomize: PropTypes.func.isRequired, saving: PropTypes.bool, onDirtyChange: PropTypes.func.isRequired };
