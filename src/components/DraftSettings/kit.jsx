import React from 'react';
import { Box, FormControl, FormHelperText, Select, TextField } from '@mui/material';
import { FIELD_SX, FieldLabel, HINT_SX, MENU_PAPER } from '../../shared/ui/playselect/CardControls';

// Draft settings on the Play-select kit (spec #2433, 3/8). The semantics stay MUI's (tabs, radios,
// spinbuttons); only the skin moves to `--ps-*` tokens.

export { ErrorPanel, Frame, PsButton, Skel } from '../../shared/ui/playselect';
export { FIELD_SX, MENU_PAPER };

/** Archivo Dim body text under a panel head. */
export function Dim({ children, sx, ...rest }) {
  return <Box component="p" {...rest} sx={[{ m: 0, fontSize: '14px', color: 'var(--ps-dim)' }, ...[].concat(sx ?? [])]}>{children}</Box>;
}

/** A note: a rule-edged block in place of a MUI alert, announced as one (role=alert) as the alert was. `warn` takes the danger edge. */
export function Note({ children, warn = false }) {
  return <Box role="alert" sx={{ border: '2px solid', borderColor: warn ? 'var(--ps-danger)' : 'var(--ps-dim)', padding: '10px 12px', fontSize: '15px' }}>{children}</Box>;
}

/** Section head inside a panel: an h2 under the page's h1. */
export function SubHead({ children, sx, ...rest }) {
  return <Box component="h2" {...rest} sx={[{ m: 0, fontSize: '16px', fontWeight: 700 }, ...[].concat(sx ?? [])]}>{children}</Box>;
}

/** 44px target for icon buttons and other small controls. */
export const TARGET_SX = { minWidth: '44px', minHeight: '44px' };

/** A labelled TextField: the kit label above a 44px field, hint or error beneath. */
export function KitTextField({ id, label, helperText, sx, ...rest }) {
  return (
    <Box sx={[{ display: 'flex', flexDirection: 'column', gap: '6px' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <TextField id={id} helperText={helperText} sx={HINT_SX} InputProps={{ sx: FIELD_SX }} {...rest} />
    </Box>
  );
}

/** A labelled Select in the kit skin; the label names the combobox as MUI's labelId does. */
export function KitSelect({ id, label, error, helperText, disabled, children, sx, ...rest }) {
  return (
    <FormControl error={error} disabled={disabled} sx={{ gap: '6px', ...sx }}>
      <FieldLabel id={`${id}-label`}>{label}</FieldLabel>
      <Select labelId={`${id}-label`} id={id} sx={FIELD_SX} MenuProps={{ PaperProps: MENU_PAPER }} {...rest}>{children}</Select>
      {helperText && <FormHelperText sx={HINT_SX['& .MuiFormHelperText-root']}>{helperText}</FormHelperText>}
    </FormControl>
  );
}

/** A Radio whose hit area is 44px (MUI's default is 42). */
export const RADIO_SX = { padding: '10px' };
