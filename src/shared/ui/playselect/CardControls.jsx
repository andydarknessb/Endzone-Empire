import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { PixelArrow } from './Icons';

// Controls for the Player card's playselect look (spec #2347 ruling 7): a square 44px action button that
// forwards its ref and takes test ids and aria props (PsButton does not), plus the field and menu skins the
// claim and add bars paint on MUI's Select and TextField. Imported by direct path, not through index.js.

const BTN = {
  minHeight: '44px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '10px',
  padding: '0 16px',
  boxSizing: 'border-box',
  borderRadius: 0,
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer',
};

const VARIANT = {
  // The one filled action: only the modal phone sheet carries it.
  fill: { backgroundColor: 'var(--ps-accent)', border: '2px solid var(--ps-accent)', color: 'var(--ps-on-accent)' },
  ghost: { backgroundColor: 'transparent', border: '2px solid var(--ps-ink)', color: 'var(--ps-ink)' },
  // A pressed toggle (Watching): the Play-blue selected state, never the green filled action.
  selected: { backgroundColor: 'var(--ps-play)', border: '2px solid var(--ps-play)', color: 'var(--ps-play-ink)' },
};

const DISABLED = {
  '&[disabled], &[aria-disabled="true"]': {
    backgroundColor: 'transparent', borderColor: 'var(--ps-rule)', color: 'var(--ps-dim)', cursor: 'not-allowed',
  },
  '&[disabled]:hover': { filter: 'none' },
};

/**
 * Square 44px button: `ghost` (default), `fill` or `selected`. A `to` makes it a router link. The root
 * carries `data-variant`, so a test can count a surface's filled actions (`[data-variant="fill"]`).
 */
export const ActionButton = React.forwardRef(({
  variant = 'ghost', to, children, type = 'button', ...rest
}, ref) => {
  const sx = { ...BTN, ...VARIANT[variant], ...DISABLED };
  const arrow = variant === 'fill' || variant === 'selected' ? <PixelArrow /> : null;
  if (to) {
    return (
      <Box ref={ref} component={RouterLink} to={to} data-variant={variant} {...rest} sx={sx}>
        {children}
        {arrow}
      </Box>
    );
  }
  return (
    <Box ref={ref} component="button" type={type} data-variant={variant} {...rest} sx={sx}>
      {variant === 'selected' ? arrow : null}
      {children}
      {variant === 'fill' ? arrow : null}
    </Box>
  );
});

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
  '& .MuiSelect-select': {
    height: '44px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', padding: '0 40px 0 12px',
  },
  '& input': { height: '44px', boxSizing: 'border-box', padding: '0 12px' },
};

/** A field's hint or error line under it: Archivo 14 Dim, with no side margin. */
export const HINT_SX = { '& .MuiFormHelperText-root': { fontSize: '14px', color: 'var(--ps-dim)', mx: 0, mt: '6px' } };

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
    '& .MuiMenuItem-root': { minHeight: '44px', fontSize: '15px', fontWeight: 600 },
  },
};
