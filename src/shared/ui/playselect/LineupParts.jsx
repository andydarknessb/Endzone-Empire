import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { SR_ONLY_SX } from './type';

// Pieces the wave 3 Lineup slices share (ADR 0067, spec #2347): a 44px action that passes its props through
// (PsButton does not), the in-row word tag, the Floor to Ceiling band, and the ruled stat line. Imported by
// direct path, never through the playselect index.

const ACTION = {
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
  lineHeight: 1.2,
  textDecoration: 'none',
  cursor: 'pointer',
};

const VARIANT = {
  fill: { backgroundColor: 'var(--ps-accent)', border: '2px solid var(--ps-accent)', color: 'var(--ps-on-accent)' },
  ghost: { backgroundColor: 'transparent', border: '2px solid var(--ps-ink)', color: 'var(--ps-ink)' },
  quiet: { backgroundColor: 'transparent', border: '2px solid transparent', color: 'var(--ps-dim)' },
};

// A destructive ghost: Ink edge, Danger text (RULINGS "Wave 3 boards", the drop dialog).
const DANGER_TEXT = { color: 'var(--ps-danger)' };

// Disabled is a solid Rule edge with Dim text and no opacity, whatever the variant (RULINGS Critique 7).
const DISABLED = {
  '&[disabled], &[aria-disabled="true"]': {
    backgroundColor: 'transparent', borderColor: 'var(--ps-rule)', color: 'var(--ps-dim)', cursor: 'not-allowed',
  },
  '&[disabled]:hover': { filter: 'none' },
};

/**
 * A square 44px action. `variant` is `fill` (the page's one filled action), `ghost` or `quiet`; `danger`
 * paints a ghost's text in Danger; `to` makes it a router link. Every other prop (`data-testid`,
 * `aria-*`, `onClick`, `disabled`) reaches the element. The root carries `data-variant`, so a test can
 * count the page's filled actions.
 */
export const PsAction = React.forwardRef(function PsAction({
  variant = 'ghost', danger = false, to, sx, children, ...rest
}, ref) {
  const link = Boolean(to);
  return (
    <Box
      ref={ref}
      component={link ? RouterLink : 'button'}
      to={link ? to : undefined}
      type={link ? undefined : 'button'}
      data-variant={variant}
      {...rest}
      sx={[ACTION, VARIANT[variant], danger ? DANGER_TEXT : null, DISABLED, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
    </Box>
  );
});

/** A small word tag (Backup, Attested, Spent): Archivo 13 700 uppercase on a 2px edge in the surrounding ink. */
export function WordTag({ children, dashed = false, ...rest }) {
  return (
    <Box
      component="span"
      {...rest}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        flex: 'none',
        height: '22px',
        padding: '0 6px',
        border: `2px ${dashed ? 'dashed' : 'solid'} currentColor`,
        fontSize: '13px',
        fontWeight: 700,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

/** The 13px 700 uppercase Dim label that heads a column or a group (Sit, Start, Needs attention). */
export const CAPTION_SX = {
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color: 'var(--ps-dim)',
};

/** One ruled stat row: a Dim label at the left, the figure at the right, over a 2px Rule. */
export function RuleStat({ label, value, ...rest }) {
  return (
    <Box
      {...rest}
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '8px 0',
        borderTop: '2px solid var(--ps-rule)',
        fontSize: '14px',
      }}
    >
      <Box component="span" sx={{ color: 'var(--ps-dim)' }}>{label}</Box>
      <Box component="b" sx={{ fontWeight: 600, textAlign: 'right' }}>{value}</Box>
    </Box>
  );
}

// A finite number from `value`, or null: Number(null) and Number('') are 0, which would invent a figure.
const finite = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * A Floor-to-Ceiling band with a tick at the projection, drawn in Play blue and Ink. A `role="img"` whose
 * name states the three figures; it prints no text of its own. `min` and `max` set the domain (a Sit and a
 * Start bar pass the same pair so they share a scale); a missing Floor or Ceiling draws no band and a
 * missing projection draws no tick.
 */
export function RangeBand({
  floor, ceiling, projection, min = 0, max, label, 'data-testid': testId = 'range-band',
}) {
  const f = finite(floor);
  const c = finite(ceiling);
  const p = finite(projection);
  const lo = finite(min) ?? 0;
  const hi = finite(max) ?? Math.max(c ?? 0, p ?? 0, lo + 1);
  const span = Math.max(hi - lo, 1e-6);
  const pct = (v) => (v == null ? null : Math.max(0, Math.min(100, ((v - lo) / span) * 100)));
  const fp = pct(f);
  const cp = pct(c);
  const pp = pct(p);
  const band = fp != null && cp != null;
  const parts = [];
  if (label) parts.push(label);
  if (f != null) parts.push(`Floor ${f.toFixed(1)}`);
  if (p != null) parts.push(`Projection ${p.toFixed(1)}`);
  if (c != null) parts.push(`Ceiling ${c.toFixed(1)}`);
  return (
    <Box
      role="img"
      aria-label={parts.length ? parts.join(', ') : 'No projection'}
      data-testid={testId}
      sx={{
        position: 'relative', height: '16px', boxSizing: 'border-box', border: '2px solid var(--ps-rule)',
      }}
    >
      {band && (
        <Box
          data-testid={`${testId}-band`}
          style={{ left: `${Math.min(fp, cp)}%`, width: `${Math.max(cp - fp, 0)}%` }}
          sx={{
            position: 'absolute', top: '2px', bottom: '2px', backgroundColor: 'var(--ps-play)',
          }}
        />
      )}
      {pp != null && (
        <Box
          data-testid={`${testId}-tick`}
          style={{ left: `${pp}%` }}
          sx={{
            position: 'absolute',
            top: '-6px',
            bottom: '-6px',
            width: '4px',
            marginLeft: '-4px',
            boxSizing: 'content-box',
            backgroundColor: 'var(--ps-ink)',
            border: '2px solid var(--ps-panel)',
          }}
        />
      )}
    </Box>
  );
}

/** Text a screen reader reads and a sighted reader does not. */
export function SrOnly({ children }) {
  return <Box component="span" sx={SR_ONLY_SX}>{children}</Box>;
}

// Small pictograms on the 2px grid (the canvas kit's), crisp edges, colour from the surrounding ink.
const GLYPHS = {
  lock: 'M5 1h6v2H5zM3 3h2v4H3zM11 3h2v4h-2zM2 7h12v8H2zM7 9h2v3H7z',
  trash: 'M6 1h4v2H6zM2 3h12v2H2zM3 5h2v8H3zM11 5h2v8h-2zM3 13h10v2H3zM7 7h2v4H7z',
  up: 'M7 2h2v2H7zM5 4h6v2H5zM3 6h10v2H3zM7 8h2v6H7z',
  flag: 'M3 2h2v13H3zM5 3h2v2H5zM9 3h2v2H9zM7 5h2v2H7zM11 5h2v2h-2zM5 7h2v2H5zM9 7h2v2H9z',
  bolt: 'M9 1h2v2H9zM7 3h2v2H7zM5 5h6v2H5zM7 7h2v2H7zM5 9h2v2H5zM3 11h2v2H3z',
};

export function Glyph({ kind, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false" shapeRendering="crispEdges" style={{ flex: 'none', display: 'block' }}>
      <path d={GLYPHS[kind]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

const INJURY_NAMES = {
  Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'Injured reserve',
};

/**
 * The product's injury code (Q, D, O, IR) as an in-row badge, with the full word for a screen reader.
 * Out and IR are the filled Ink chip, so they stand out without red. A code the wire does not name
 * still shows, raw. Null for no designation.
 */
export function InjuryCode({ status, ...rest }) {
  const code = String(status || '').trim().toUpperCase();
  if (!code) return null;
  const filled = code === 'O' || code === 'IR';
  return (
    <Box
      component="span"
      data-status={code}
      {...rest}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        flex: 'none',
        minWidth: '24px',
        height: '22px',
        padding: code.length > 1 ? '0 5px' : 0,
        border: `2px solid ${filled ? 'var(--ps-ink)' : 'currentColor'}`,
        ...(filled ? { backgroundColor: 'var(--ps-ink)', color: 'var(--ps-panel)' } : null),
        fontSize: '13px',
        fontWeight: 700,
        letterSpacing: '.04em',
        lineHeight: 1,
      }}
    >
      <span aria-hidden="true">{code}</span>
      <Box component="span" sx={SR_ONLY_SX}>{`Injury status: ${INJURY_NAMES[code] || code}`}</Box>
    </Box>
  );
}
