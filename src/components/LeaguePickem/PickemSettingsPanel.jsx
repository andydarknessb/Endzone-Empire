import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Typography,
} from '@mui/material';

/**
 * Commissioner controls. The scoring mode is a one-way door for the season:
 * once anyone has made a pick, the server returns 409 PICKEM_MODE_LOCKED
 * rather than retroactively reinterpreting every stored confidence — so the
 * radio is left enabled and the refusal is surfaced as an error, which is the
 * only honest way to show a rule the client can't evaluate on its own.
 *
 * `embedded` drops the Paper shell and heading for use inside the page's
 * collapsible "Commissioner settings" accordion; standalone (the disabled-state
 * CTA) keeps them.
 */
export default function PickemSettingsPanel({ settings, saving, error, onSave, embedded = false }) {
  const [mode, setMode] = useState(settings.mode);

  // Another commissioner (or another tab) may have changed the mode since this
  // panel mounted — follow the server whenever it reports a new value.
  useEffect(() => {
    setMode(settings.mode);
  }, [settings.mode]);

  const Shell = embedded ? Box : Paper;
  const shellSx = embedded ? {} : { p: { xs: 2, sm: 3 }, mb: 3 };

  return (
    <Shell sx={shellSx}>
      {!embedded && <Typography variant="h6" sx={{ mb: 0.5 }}>Commissioner settings</Typography>}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Pick&apos;em is a side game for the whole league: everyone picks the winner of
        every NFL game, picks lock at kickoff, and a tied game credits nobody.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Stack spacing={2}>
        <FormControlLabel
          control={
            <Switch
              checked={Boolean(settings.enabled)}
              disabled={saving}
              onChange={(event) => onSave({ enabled: event.target.checked })}
            />
          }
          label="Enable Pick'em for this league"
        />

        <FormControl>
          <FormLabel id="pickem-mode-label">Scoring</FormLabel>
          <RadioGroup
            aria-labelledby="pickem-mode-label"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <FormControlLabel
              value="straight"
              control={<Radio />}
              label="Straight up: 1 point per correct pick"
            />
            <FormControlLabel
              value="confidence"
              control={<Radio />}
              label="Confidence: rank every game, earn the rank you assigned"
            />
          </RadioGroup>
        </FormControl>

        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            disabled={saving || mode === settings.mode}
            onClick={() => onSave({ mode })}
          >
            Save scoring mode
          </Button>
          <Typography variant="caption" color="text.secondary">
            The mode can only change before the season&apos;s first pick.
          </Typography>
        </Stack>
      </Stack>
    </Shell>
  );
}
