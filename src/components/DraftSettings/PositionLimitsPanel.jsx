import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { positionCapsFeasible } from '../../lib/positionCapsFeasibility';
import { integerRangeError } from './numericValidation';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
export default function PositionLimitsPanel({ league, frozen, onSave, saving, onDirtyChange }) {
  const [caps, setCaps] = useState(league.position_caps || {});
  useEffect(() => setCaps(league.position_caps || {}), [league.position_caps]);
  useEffect(() => {
    const savedCaps = league.position_caps || {};
    onDirtyChange(POSITIONS.some((position) => String(caps[position] ?? '') !== String(savedCaps[position] ?? '')));
  }, [caps, league.position_caps, onDirtyChange]);
  const capErrors = useMemo(() => Object.fromEntries(POSITIONS.map((position) => [position, integerRangeError(caps[position], { label: position, min: 0, max: 10, optional: true })])), [caps]);
  const hasInvalidCap = Object.values(capErrors).some(Boolean);
  const capsForSave = useMemo(() => Object.fromEntries(POSITIONS.filter((position) => caps[position] !== '' && caps[position] !== undefined && caps[position] !== null).map((position) => [position, Number(caps[position])])), [caps]);
  const feasibility = useMemo(() => positionCapsFeasible({ rosterSlots: league.roster_slots || [], benchSlots: league.bench_slots, irSlots: league.ir_slots, positionCaps: capsForSave }), [league, capsForSave]);
  return <Stack spacing={2}><Typography variant="body2" color="text.secondary">Limits apply only while drafting; rosters can change freely afterward.</Typography>{!feasibility.feasible && <Alert severity="warning">{feasibility.errors.join(' ')}</Alert>}<Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 1 }}>{POSITIONS.map((position) => <TextField key={position} label={position} type="number" size="small" disabled={frozen} inputProps={{ min: 0, max: 10 }} value={caps[position] ?? ''} error={Boolean(capErrors[position])} helperText={capErrors[position]} onChange={(event) => setCaps((current) => ({ ...current, [position]: event.target.value }))} />)}</Box><Box><Button variant="contained" disabled={frozen || saving || hasInvalidCap || !feasibility.feasible} onClick={() => onSave({ positionCaps: capsForSave }, 'Position limits saved')}>Save position limits</Button></Box></Stack>;
}

PositionLimitsPanel.propTypes = { league: PropTypes.object.isRequired, frozen: PropTypes.bool.isRequired, onSave: PropTypes.func.isRequired, saving: PropTypes.bool, onDirtyChange: PropTypes.func.isRequired };
