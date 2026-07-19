import React from 'react';
import { Paper, Typography, Stack, TextField, Button } from '@mui/material';

/** Commissioner-only pre-draft settings form (pick clock + autodraft delay). */
function DraftSettingsPanel({
  pickTimeSeconds,
  onPickTimeSecondsChange,
  autodraftDelaySeconds,
  onAutodraftDelaySecondsChange,
  onSubmit,
  saving,
}) {
  return (
    <Paper variant="outlined" component="form" onSubmit={onSubmit} sx={{ mt: 2, p: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold' }}>
        Draft Settings
      </Typography>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          label="Pick clock (sec)"
          helperText="0 = untimed"
          type="number"
          size="small"
          sx={{ width: 170 }}
          inputProps={{ min: 0, max: 3600 }}
          value={pickTimeSeconds}
          onChange={(e) => onPickTimeSecondsChange(e.target.value)}
        />
        <TextField
          label="Autodraft delay"
          helperText="seconds"
          type="number"
          size="small"
          sx={{ width: 170 }}
          inputProps={{ min: 1, max: 60 }}
          value={autodraftDelaySeconds}
          onChange={(e) => onAutodraftDelaySecondsChange(e.target.value)}
        />
        <Button type="submit" variant="contained" size="small" disabled={saving}>
          Save
        </Button>
      </Stack>
    </Paper>
  );
}

export default DraftSettingsPanel;
