import React from 'react';
import { Box } from '@mui/material';
import { BODY_FONT } from './type';

// Field and menu skins for the Player card's claim and add bars (spec #2347 ruling 7): MUI's Select and
// TextField on playselect tokens. The action button is PsButton. Imported by direct path, not through index.js.

/** A field label above its control: Archivo 14 600. */
export function FieldLabel({ id, htmlFor, children }) {
  return (
    <Box component="label" id={id} htmlFor={htmlFor} sx={{ fontSize: '14px', fontWeight: 600 }}>
      {children}
    </Box>
  );
}

/** `sx` for MUI's Select and OutlinedInput: square, 44px, 2px Dim edge turning Ink on hover and focus. */
export const FIELD_SX = {
  height: '44px',
  borderRadius: 0,
  backgroundColor: 'var(--ps-panel)',
  color: 'var(--ps-ink)',
  fontFamily: 'inherit',
  fontSize: '16px',
  '& .MuiOutlinedInput-notchedOutline': { borderWidth: '2px', borderRadius: 0, borderColor: 'var(--ps-dim)' },
  '&:hover .MuiOutlinedInput-notchedOutline, &.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderWidth: '2px', borderColor: 'var(--ps-ink)',
  },
  '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--ps-danger)' },
  '& .MuiSelect-icon': { color: 'var(--ps-ink)' },
  // MUI sets the select's height and padding at triple specificity; four classes win.
  '& .MuiSelect-select.MuiSelect-select.MuiSelect-select': {
    height: '44px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', padding: '0 40px 0 12px',
  },
  '& input': { height: '44px', boxSizing: 'border-box', padding: '0 12px' },
};

/** A field's hint or error line under it: Archivo 14 Dim, with no side margin. */
export const HINT_SX = { '& .MuiFormHelperText-root': { fontFamily: 'inherit', fontSize: '14px', color: 'var(--ps-dim)', mx: 0, mt: '6px' } };

/** `PaperProps` for a MUI Menu or a Select's `MenuProps`: the primary double frame, square items 44px high. */
export const MENU_PAPER = {
  className: 'ps-root',
  sx: {
    borderRadius: 0,
    border: '6px double var(--ps-frame)',
    backgroundColor: 'var(--ps-panel)',
    color: 'var(--ps-ink)',
    backgroundImage: 'none',
    boxShadow: 'none',
    // Menus portal outside the drawer, so they take the body font themselves.
    fontFamily: BODY_FONT,
    '& .MuiMenuItem-root': { minHeight: '44px', fontFamily: 'inherit', fontSize: '15px', fontWeight: 600 },
  },
};
