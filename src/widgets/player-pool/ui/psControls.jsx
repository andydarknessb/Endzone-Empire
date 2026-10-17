import React, { useId } from 'react';
import { Box } from '@mui/material';
import { PixelArrow, PixelCheck } from '../../../shared/ui/playselect';

// Play-select form controls for the player pool (ADR 0067 wave 3, boards Waivers / WaiversPhone):
// native elements on `ps-*` tokens, square, 44px, a 2px Dim edge (Ink on hover and focus). They keep
// the native roles (textbox, combobox, checkbox), so a label is the accessible name.

const CONTROL = {
  boxSizing: 'border-box',
  height: '44px',
  borderRadius: 0,
  backgroundColor: 'var(--ps-field)',
  color: 'var(--ps-ink)',
  border: '2px solid var(--ps-dim)',
  fontFamily: 'inherit',
  fontSize: '16px',
  width: '100%',
  appearance: 'none',
  '&:hover, &:focus': { borderColor: 'var(--ps-ink)' },
};
const LABEL = { fontSize: '14px', fontWeight: 600 };

export function PsField({
  label, value, onChange, placeholder, width, onClear, clearLabel = 'Clear',
}) {
  const id = useId();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, width: width ? `${width}px` : '100%', flex: width ? 'none' : undefined }}>
      <Box component="label" htmlFor={id} sx={LABEL}>{label}</Box>
      <Box sx={{ position: 'relative' }}>
        <Box
          component="input"
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={onChange}
          sx={{ ...CONTROL, padding: onClear && value ? '0 56px 0 12px' : '0 12px' }}
        />
        {onClear && value ? (
          <Box
            component="button"
            type="button"
            aria-label={clearLabel}
            onClick={onClear}
            sx={{
              position: 'absolute', right: 0, top: 0, width: '44px', height: '44px', padding: 0, display: 'grid', placeItems: 'center',
              border: 0, borderLeft: '2px solid var(--ps-dim)', borderRadius: 0, background: 'transparent', color: 'var(--ps-ink)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1h2v2H1zM3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 9h2v2H9zM9 1h2v2H9zM7 3h2v2H7zM3 7h2v2H3zM1 9h2v2H1z" fill="currentColor" />
            </svg>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

const CARET = 'M1 2h10v2H9v2H7v2H5V6H3V4H1z';

/** `options`: `[{ value, label }]`. A native select with a 44px caret cell. */
export function PsSelect({
  label, value, onChange, options, width,
}) {
  const id = useId();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, width: width ? `${width}px` : '100%', flex: width ? 'none' : undefined }}>
      <Box component="label" htmlFor={id} sx={LABEL}>{label}</Box>
      <Box sx={{ position: 'relative' }}>
        <Box component="select" id={id} value={value} onChange={onChange} sx={{ ...CONTROL, padding: '0 56px 0 12px' }}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Box>
        <Box
          component="span"
          aria-hidden="true"
          sx={{
            position: 'absolute', right: 0, top: 0, width: '44px', height: '44px', display: 'grid', placeItems: 'center',
            pointerEvents: 'none', borderLeft: '2px solid var(--ps-dim)', boxSizing: 'border-box', color: 'var(--ps-ink)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><path d={CARET} fill="currentColor" /></svg>
        </Box>
      </Box>
    </Box>
  );
}

/** A checkbox: the native input covers its 44px label, so the whole row is the target. */
export function PsCheck({ label, checked, onChange }) {
  return (
    <Box
      component="label"
      sx={{
        position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '10px', minHeight: '44px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
        '& input:focus-visible + span': { outline: '3px solid var(--ps-focus)', boxShadow: '0 0 0 7px var(--ps-halo)' },
      }}
    >
      <Box
        component="input"
        type="checkbox"
        checked={checked}
        onChange={onChange}
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', m: 0, opacity: 0, cursor: 'pointer' }}
      />
      <Box
        component="span"
        aria-hidden="true"
        sx={{ display: 'grid', placeItems: 'center', width: '24px', height: '24px', boxSizing: 'border-box', border: '2px solid var(--ps-ink)', color: 'var(--ps-ink)' }}
      >
        {checked ? <PixelCheck /> : null}
      </Box>
      <span>{label}</span>
    </Box>
  );
}

/** The sort direction toggle: a 44px ghost square. */
export function PsIconButton({ label, onClick, children }) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onClick={onClick}
      sx={{
        width: '44px', height: '44px', padding: 0, display: 'grid', placeItems: 'center', flex: 'none', boxSizing: 'border-box', borderRadius: 0,
        background: 'transparent', border: '2px solid var(--ps-ink)', color: 'var(--ps-ink)',
      }}
    >
      {children}
    </Box>
  );
}

/** A pager item for MUI's `Pagination` `renderItem`: 44px square, the current page Play blue with an arrow. */
export function PsPageItem({ item }) {
  const {
    type, page, selected, disabled, onClick,
  } = item;
  if (type === 'start-ellipsis' || type === 'end-ellipsis') {
    return <Box component="span" aria-hidden="true" sx={{ minWidth: '44px', textAlign: 'center', fontWeight: 600 }}>...</Box>;
  }
  const direction = type === 'previous' ? 'left' : 'right';
  let label = `Go to page ${page}`;
  if (type === 'previous') label = 'Go to previous page';
  else if (type === 'next') label = 'Go to next page';
  else if (selected) label = `page ${page}`;
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      aria-current={selected ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      sx={{
        minWidth: '44px', height: '44px', padding: '0 10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        boxSizing: 'border-box', borderRadius: 0, fontFamily: 'inherit', fontSize: '15px', fontWeight: 600,
        border: `2px solid ${selected ? 'var(--ps-play)' : disabled ? 'var(--ps-rule)' : 'var(--ps-ink)'}`,
        backgroundColor: selected ? 'var(--ps-play)' : 'transparent',
        color: selected ? 'var(--ps-play-ink)' : disabled ? 'var(--ps-dim)' : 'var(--ps-ink)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        '&[disabled]:hover': { filter: 'none' },
      }}
    >
      {selected ? <PixelArrow /> : null}
      {type === 'page' ? page : (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d={direction === 'left' ? 'M7 1h2v10H7zM5 3h2v6H5zM3 5h2v2H3z' : 'M3 1h2v10H3zM5 3h2v6H5zM7 5h2v2H7z'} fill="currentColor" />
        </svg>
      )}
    </Box>
  );
}

