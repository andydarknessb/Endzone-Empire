import React, { useId } from 'react';
import { Box } from '@mui/material';
import { SR_ONLY_SX } from '../../shared/ui/playselect';
import { FieldLabel } from '../../shared/ui/playselect/CardControls';

// A Play-select text field for the chat composer and its GIF and hide forms: a native input on `ps-*`
// tokens, square, 44px, a 2px Dim edge (Ink on hover and focus, Danger when in error). It keeps the
// textbox role with the label as its accessible name. `hideLabel` keeps the label for assistive tech
// but takes it out of the layout (the main composer has no room for a row of its own). `adornment`
// sits inside the field's right edge and ignores the pointer, so a click on it places the caret.
const CONTROL_SX = {
  boxSizing: 'border-box',
  height: '44px',
  width: '100%',
  borderRadius: 0,
  backgroundColor: 'var(--ps-field)',
  color: 'var(--ps-ink)',
  border: '2px solid var(--ps-dim)',
  fontFamily: 'inherit',
  fontSize: '16px',
  '&:hover, &:focus': { borderColor: 'var(--ps-ink)' },
  '&[aria-invalid="true"]': { borderColor: 'var(--ps-danger)' },
};

const ChatField = React.forwardRef(({
  id, label, hideLabel = false, hint, error = false, required = false, adornment = null, describedBy, sx, ...rest
}, ref) => {
  const autoId = useId();
  const inputId = id || autoId;
  const hintId = `${inputId}-hint`;
  const described = [describedBy, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, ...sx }}>
      <Box sx={hideLabel ? SR_ONLY_SX : undefined}>
        <FieldLabel htmlFor={inputId}>{label}{required ? <span aria-hidden="true"> *</span> : null}</FieldLabel>
      </Box>
      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Box
          component="input"
          ref={ref}
          id={inputId}
          type="text"
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={described}
          {...rest}
          sx={{ ...CONTROL_SX, padding: adornment ? '0 96px 0 12px' : '0 12px' }}
        />
        {adornment && (
          <Box
            data-testid="composer-counter-adornment"
            sx={{ position: 'absolute', right: '12px', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}
          >
            {adornment}
          </Box>
        )}
      </Box>
      {hint && (
        <Box id={hintId} sx={{ fontSize: '14px', color: error ? 'var(--ps-danger)' : 'var(--ps-dim)' }}>{hint}</Box>
      )}
    </Box>
  );
});

export default ChatField;
