import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Alert, Box, Button, FormControl, FormControlLabel, Radio, RadioGroup, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

const TYPES = [
  ['snake', 'Snake draft', 'Teams pick in a reversing order each round.'],
  ['auction', 'Salary-cap auction', 'Settings are saved now; live auctions are coming soon.'],
  ['autopick', 'Autopick', 'Every team is drafted automatically.'],
  ['offline', 'Offline', 'The commissioner records picks after an offline draft.'],
];

export default function DraftTypePanel({ league, frozen, onSave, saving, onDirtyChange }) {
  const [draftType, setDraftType] = useState(league.draft_type || 'snake');
  const [draftRotation, setDraftRotation] = useState(league.draft_rotation || 'snake');
  useEffect(() => { setDraftType(league.draft_type || 'snake'); setDraftRotation(league.draft_rotation || 'snake'); }, [league.draft_type, league.draft_rotation]);
  useEffect(() => {
    const typeChanged = draftType !== (league.draft_type || 'snake');
    const rotationChanged = draftType !== 'auction' && draftRotation !== (league.draft_rotation || 'snake');
    onDirtyChange(typeChanged || rotationChanged);
  }, [draftRotation, draftType, league.draft_rotation, league.draft_type, onDirtyChange]);
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">Choose how this draft is conducted. The order format is available for snake, autopick, and offline drafts.</Typography>
      {frozen && <Alert severity="info">Draft format is locked once the draft starts.</Alert>}
      <FormControl disabled={frozen}>
        <RadioGroup value={draftType} onChange={(event) => setDraftType(event.target.value)}>
          {TYPES.map(([value, label, description]) => (
            <Box key={value} sx={{ border: '1px solid', borderColor: draftType === value ? 'primary.main' : 'divider', borderRadius: 1, px: 1, mb: 1 }}>
              <FormControlLabel value={value} control={<Radio />} label={<><Typography>{label}</Typography><Typography variant="caption" color="text.secondary">{description}</Typography></>} />
            </Box>
          ))}
        </RadioGroup>
      </FormControl>
      {draftType === 'auction' && <Alert severity="info">Settings only. Live salary-cap drafts are coming soon. Scheduling and immediate start are unavailable.</Alert>}
      {draftType !== 'auction' && <Box>
        <Typography variant="subtitle2" component="p" id="draft-rotation-label" sx={{ mb: 1 }}>Draft rotation</Typography>
        <ToggleButtonGroup exclusive value={draftRotation} disabled={frozen} onChange={(event, value) => value && setDraftRotation(value)} size="small" aria-labelledby="draft-rotation-label">
          <ToggleButton value="snake">Snake</ToggleButton><ToggleButton value="linear">Linear</ToggleButton>
        </ToggleButtonGroup>
      </Box>}
      <Box><Button variant="contained" disabled={frozen || saving} onClick={() => onSave(draftType === 'auction' ? { draftType } : { draftType, draftRotation }, 'Draft type saved')}>Save draft type</Button></Box>
    </Stack>
  );
}

DraftTypePanel.propTypes = { league: PropTypes.object.isRequired, frozen: PropTypes.bool.isRequired, onSave: PropTypes.func.isRequired, saving: PropTypes.bool, onDirtyChange: PropTypes.func.isRequired };
