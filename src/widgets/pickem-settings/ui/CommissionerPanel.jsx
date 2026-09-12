import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Switch,
  Typography,
} from '@mui/material';
import { Card } from '../../../shared/ui';

// The two scoring modes, worded once and shared with the create dialogs' mode
// picker (src/components/common/LeagueTypeFields.jsx) and the read-only
// League Rules view (src/components/LeagueRules/PickemRulesView.jsx) so a
// league reads the same rule at creation, in its settings, and in its rules.
export const PICKEM_MODE_OPTIONS = Object.freeze([
  { value: 'straight', label: 'Straight up: 1 point per correct pick' },
  { value: 'confidence', label: 'Confidence: rank every game, earn the rank you assigned' },
]);

/**
 * Commissioner controls (#1267, ADR 0038: moved from
 * `src/components/LeaguePickem/PickemSettingsPanel`, island styling, same
 * props contract). The scoring mode is a one-way door for the season: once
 * anyone has made a pick, the server returns 409 PICKEM_MODE_LOCKED rather
 * than retroactively reinterpreting every stored confidence, so the radio is
 * left enabled and the refusal is surfaced as an error, which is the only
 * honest way to show a rule the client can't evaluate on its own.
 *
 * `embedded` drops the Card shell for use inside the page's own
 * "Commissioner settings" section; standalone (the disabled-state CTA) keeps
 * it, titled to match every other island Card (h2, shared/ui).
 *
 * `lockedOn` is the pick'em-only league: pick'em is the league's only game, so
 * the enable switch is replaced by a static line and only the mode is
 * editable.
 */
export default function CommissionerPanel({ settings, saving, error, onSave, embedded = false, lockedOn = false }) {
  const [mode, setMode] = useState(settings.mode);

  // Another commissioner (or another tab) may have changed the mode since this
  // panel mounted - follow the server whenever it reports a new value.
  useEffect(() => {
    setMode(settings.mode);
  }, [settings.mode]);

  const body = (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography sx={{ fontSize: '13px', color: 'var(--dash-dim)' }}>
        {lockedOn
          ? 'Everyone picks the winner of every NFL game, picks lock at kickoff, and a tied game credits nobody.'
          : "Pick'em is a side game for the whole league: everyone picks the winner of every NFL game, picks lock at kickoff, and a tied game credits nobody."}
      </Typography>

      {error && (
        <Typography role="alert" sx={{ fontSize: '13px', color: 'var(--dash-danger)' }}>
          {error}
        </Typography>
      )}

      {lockedOn ? (
        <Typography sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}>
          Pick&apos;em is always on in this league.
        </Typography>
      ) : (
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
      )}

      <FormControl>
        <FormLabel id="pickem-mode-label" sx={{ color: 'var(--dash-dim)' }}>Scoring</FormLabel>
        <RadioGroup
          aria-labelledby="pickem-mode-label"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          {PICKEM_MODE_OPTIONS.map((option) => (
            <FormControlLabel
              key={option.value}
              value={option.value}
              control={<Radio />}
              label={option.label}
            />
          ))}
        </RadioGroup>
      </FormControl>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          disabled={saving || mode === settings.mode}
          onClick={() => onSave({ mode })}
        >
          Save scoring mode
        </Button>
        <Typography sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}>
          The mode can only change before the season&apos;s first pick.
        </Typography>
      </Box>
    </Box>
  );

  if (embedded) return <Box data-testid="pickem-settings">{body}</Box>;

  return (
    <Card title="Commissioner settings" data-testid="pickem-settings">
      <Box sx={{ p: 2.25 }}>{body}</Box>
    </Card>
  );
}
