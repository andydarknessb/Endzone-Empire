import React, { useId } from 'react';
import PropTypes from 'prop-types';
import {
  Autocomplete, Checkbox, FormControlLabel, FormHelperText, Stack, TextField, Typography,
} from '@mui/material';
import { listIanaTimeZones, zonedWallTimeToUtcIso } from '../../lib/draftTimezone';
import { FIELD_SX, FieldLabel, HINT_SX, MENU_PAPER } from '../../shared/ui/playselect/CardControls';

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
 *
 * `error` sits under the date field and `acknowledgeError` under the
 * acknowledgement checkbox, each tied to its control (aria-invalid plus
 * aria-describedby), for callers that validate on submit instead of
 * disabling their submit button (the stepped create flow).
 *
 * `look` is `'default'` (the legacy look, unchanged) or `'playselect'` (the kit field: label above a 44px
 * square field, Dim preview line). Draft settings passes `'playselect'`; Create league passes it in spec #2453.
 * A caller may pass `menuPaperSx` to add sx to the playselect menu paper (Home passes its panel remap, #2652).
 */
export default function DraftScheduleField({
  wallTime, onWallTimeChange, timeZone, onTimeZoneChange,
  acknowledged, onAcknowledgedChange, disabled, minWallTime, error, acknowledgeError, look = 'default', menuPaperSx,
}) {
  const ps = look === 'playselect';
  // An id on the date TextField is what makes MUI link its helper text (the
  // `error`) to the input via aria-describedby.
  const fieldId = useId();
  const acknowledgeErrorId = `${fieldId}-acknowledge-error`;
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
      {ps && <FieldLabel htmlFor={`${fieldId}-date`}>Draft date</FieldLabel>}
      <TextField
        id={`${fieldId}-date`}
        label={ps ? undefined : 'Draft date'}
        type="datetime-local"
        InputLabelProps={{ shrink: true }}
        InputProps={ps ? { sx: FIELD_SX } : undefined}
        sx={(theme) => ({ colorScheme: theme.palette.mode, ...(ps ? HINT_SX : null) })}
        value={wallTime}
        disabled={disabled}
        inputProps={minWallTime ? { min: minWallTime } : undefined}
        error={Boolean(error)}
        helperText={error}
        onChange={handleWallTimeChange}
      />
      <Typography variant="caption" color={ps ? undefined : 'text.secondary'} sx={ps ? { color: 'var(--ps-dim)', fontSize: '14px' } : undefined}>{utcPreview}</Typography>
      {scheduled && (
        <>
          {ps && <FieldLabel id={`${fieldId}-zone-label`} htmlFor={`${fieldId}-zone`}>Draft time zone</FieldLabel>}
          <Autocomplete
            id={`${fieldId}-zone`}
            size={ps ? undefined : 'small'}
            sx={ps ? { '& .MuiAutocomplete-endAdornment .MuiIconButton-root': { minWidth: '44px', minHeight: '44px' } } : undefined}
            componentsProps={ps ? { paper: menuPaperSx ? { ...MENU_PAPER, sx: { ...MENU_PAPER.sx, ...menuPaperSx } } : MENU_PAPER } : undefined}
            disabled={disabled}
            options={ZONE_OPTIONS}
            value={timeZone || null}
            disableClearable
            onChange={handleTimeZoneChange}
            renderInput={(params) => <TextField {...params} label={ps ? undefined : 'Draft time zone'} InputProps={ps ? { ...params.InputProps, sx: FIELD_SX } : params.InputProps} />}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={acknowledged}
                sx={ps ? { padding: '10px' } : undefined}
                disabled={disabled}
                onChange={(event) => onAcknowledgedChange(event.target.checked)}
                inputProps={acknowledgeError
                  ? { 'aria-invalid': 'true', 'aria-describedby': acknowledgeErrorId }
                  : undefined}
              />
            }
            label="I confirm this draft date and time are correct in the time zone shown above."
          />
          {acknowledgeError && (
            <FormHelperText id={acknowledgeErrorId} error sx={{ mt: 0 }}>{acknowledgeError}</FormHelperText>
          )}
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
  acknowledgeError: PropTypes.string,
  look: PropTypes.oneOf(['default', 'playselect']),
  menuPaperSx: PropTypes.object,
};
