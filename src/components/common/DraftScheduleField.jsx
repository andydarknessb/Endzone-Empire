import React from 'react';
import PropTypes from 'prop-types';
import { Autocomplete, Checkbox, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { listIanaTimeZones, zonedWallTimeToUtcIso } from '../../lib/draftTimezone';

const ZONE_OPTIONS = listIanaTimeZones();

/**
 * The wall-clock + IANA time zone pair behind a scheduled Draft (#116), shared
 * by every workflow that sets one: league create (UserPage, LeagueManagement)
 * and league settings (DraftSettings/SchedulePanel). Kept in one place so the
 * three cannot drift on the picker, the acknowledgement copy, or the
 * UTC-conversion path. See CONTEXT.md: Draft timezone.
 *
 * Controlled, presentational: `wallTime`/`timeZone`/`acknowledged` and their
 * setters are the caller's state. Editing the date or the zone always clears
 * a prior acknowledgement (AC3 — acknowledgement covers the value being
 * saved, not a stale one), so onWallTimeChange/onTimeZoneChange are wrapped
 * here rather than left for every caller to remember.
 */
export default function DraftScheduleField({
  wallTime, onWallTimeChange, timeZone, onTimeZoneChange,
  acknowledged, onAcknowledgedChange, disabled, minWallTime, error,
}) {
  const handleWallTimeChange = (event) => {
    onAcknowledgedChange(false);
    onWallTimeChange(event.target.value);
  };
  const handleTimeZoneChange = (event, next) => {
    onAcknowledgedChange(false);
    onTimeZoneChange(next || '');
  };
  const scheduled = Boolean(wallTime);
  const utcInstant = scheduled ? zonedWallTimeToUtcIso(wallTime, timeZone) : null;
  const utcPreview = scheduled
    ? (utcInstant ? utcInstant.replace('T', ' ').replace('.000Z', ' UTC') : 'Choose a time zone to see the UTC instant.')
    : 'No draft scheduled';

  return (
    <Stack spacing={1}>
      <TextField
        label="Draft date"
        type="datetime-local"
        InputLabelProps={{ shrink: true }}
        sx={(theme) => ({ colorScheme: theme.palette.mode })}
        value={wallTime}
        disabled={disabled}
        inputProps={minWallTime ? { min: minWallTime } : undefined}
        error={Boolean(error)}
        helperText={error}
        onChange={handleWallTimeChange}
      />
      <Typography variant="caption" color="text.secondary">{utcPreview}</Typography>
      {scheduled && (
        <>
          <Autocomplete
            size="small"
            disabled={disabled}
            options={ZONE_OPTIONS}
            value={timeZone || null}
            disableClearable
            onChange={handleTimeZoneChange}
            renderInput={(params) => <TextField {...params} label="Draft time zone" />}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={acknowledged}
                disabled={disabled}
                onChange={(event) => onAcknowledgedChange(event.target.checked)}
              />
            }
            label="I confirm this draft date and time are correct in the time zone shown above."
          />
        </>
      )}
    </Stack>
  );
}

DraftScheduleField.propTypes = {
  wallTime: PropTypes.string.isRequired,
  onWallTimeChange: PropTypes.func.isRequired,
  timeZone: PropTypes.string.isRequired,
  onTimeZoneChange: PropTypes.func.isRequired,
  acknowledged: PropTypes.bool.isRequired,
  onAcknowledgedChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  minWallTime: PropTypes.string,
  error: PropTypes.string,
};
