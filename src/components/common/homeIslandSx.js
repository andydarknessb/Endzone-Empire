/**
 * Home (`/user`) on the island's visual generation (ADR 0051): the `sx`
 * fragments the Home pieces share, painted only with `dash-*` tokens and the
 * island's two faces. Every text and edge pairing named here is registered in
 * src/theme/tokens.contrast.test.js; the comment on each fragment says which
 * surface it is drawn for, so a caller does not move it onto a backdrop the
 * guard has not measured.
 *
 * These are plain objects for MUI `sx`, so a component keeps its own MUI
 * element (and its variant classes, accessible names and DOM) and only
 * repaints. Lives under `common` because `LeagueStatusCard` shares it with
 * the `UserPage` files.
 */

export const DISPLAY_FONT = 'var(--dash-font-display)';

/** A hairline in the island's `dash-line`: decoration, never a boundary. */
export const HAIRLINE = '1px solid var(--dash-line)';

/**
 * The page root's token context, the way the League Dashboard and Game
 * Center roots paint it: `dash-bg`, `dash-ink` and the body face.
 */
export const homeRootSx = {
  backgroundColor: 'var(--dash-bg)',
  color: 'var(--dash-ink)',
  fontFamily: 'var(--dash-font-body)',
};

/** A card or panel: `dash-surface`, the `dash-line` hairline, the island radius. */
export const panelSx = {
  backgroundColor: 'var(--dash-surface)',
  backgroundImage: 'none',
  border: HAIRLINE,
  borderRadius: 'var(--dash-radius)',
  boxShadow: 'none',
  color: 'var(--dash-ink)',
};

/** A panel's header strip (the boards' `.card-h`): title row over a hairline. */
export const panelHeaderSx = {
  borderBottom: HAIRLINE,
};

/**
 * A section or panel title in the display face: uppercase, spaced. Changes
 * type scale only; the heading level stays whatever `component` says.
 */
export const panelTitleSx = {
  m: 0,
  fontFamily: DISPLAY_FONT,
  fontSize: '20px',
  fontWeight: 600,
  lineHeight: 1.2,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--dash-ink)',
};

/** The page's section headings (My leagues, Around the League). */
export const sectionTitleSx = {
  m: 0,
  fontFamily: DISPLAY_FONT,
  fontSize: { xs: '26px', md: '30px' },
  fontWeight: 700,
  lineHeight: 1.1,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
  color: 'var(--dash-ink)',
};

/** Scores and big counts: the display face with tabular numerals. */
export const scoreSx = {
  fontFamily: DISPLAY_FONT,
  fontWeight: 700,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
};

/** The uppercase micro label (deadline column, invite code, stat labels). */
export const microLabelSx = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--dash-dim)',
};

export const inkSx = { color: 'var(--dash-ink)' };
export const dimSx = { color: 'var(--dash-dim)' };

/** A skeleton bar: the States board draws them in `dash-surface3`. */
export const skeletonSx = { backgroundColor: 'var(--dash-surface3)' };

const buttonBaseSx = {
  textTransform: 'none',
  fontWeight: 600,
  borderRadius: 'var(--dash-radius-sm)',
  boxShadow: 'none',
};

/**
 * The primary button (the canvas's `.btn.primary`) on a MUI contained
 * Button: `dash-on-accent` on `dash-accent`. Disabled drops to `dash-dim`
 * on `dash-surface3`, the DashButton treatment.
 */
export const primaryButtonSx = {
  ...buttonBaseSx,
  color: 'var(--dash-on-accent)',
  backgroundColor: 'var(--dash-accent)',
  border: '1px solid var(--dash-accent)',
  transition: 'filter var(--transition-fast)',
  '&:hover': { backgroundColor: 'var(--dash-accent)', boxShadow: 'none', filter: 'brightness(1.08)' },
  '&.Mui-disabled': {
    color: 'var(--dash-dim)',
    backgroundColor: 'var(--dash-surface3)',
    borderColor: 'var(--dash-line-strong)',
  },
};

/**
 * The ghost button (the boards' `.bg` links) on a MUI outlined Button:
 * `dash-ink` on whatever surface it sits on (a card, a stat tile, the page),
 * with a decorative `dash-line-strong` edge that moves to the accent line on
 * hover.
 */
export const ghostButtonSx = {
  ...buttonBaseSx,
  color: 'var(--dash-ink)',
  backgroundColor: 'transparent',
  border: '1px solid var(--dash-line-strong)',
  '&:hover': { backgroundColor: 'transparent', borderColor: 'var(--dash-accent-line)' },
  '&.Mui-disabled': { color: 'var(--dash-dim)', borderColor: 'var(--dash-line)' },
};

/**
 * The quiet text action (card footer links, Show all, Edit): `dash-accent`
 * text on a card or a footer well (both registered), hover fill a step up.
 */
export const quietButtonSx = {
  ...buttonBaseSx,
  color: 'var(--dash-accent)',
  backgroundColor: 'transparent',
  '&:hover': { backgroundColor: 'var(--dash-surface2)', color: 'var(--dash-ink)' },
};

/** A plain text link in the accent (All notifications, Browse the waiver wire). */
export const textLinkSx = {
  color: 'var(--dash-accent)',
  fontWeight: 600,
  textDecorationColor: 'currentColor',
  '&:hover': { color: 'var(--dash-ink)' },
};

/**
 * Text fields, selects and the Teams number field. Descendant selectors, so
 * it can sit on a TextField or on a wrapper around a shared field component.
 * The edge is `dash-field` (3:1 on `dash-bg`, `dash-surface`, `dash-surface2`;
 * never `dash-surface3`), accent when focused and a 2px `dash-danger` when in
 * error. `fill` is the input's own background, a surface token.
 */
export const fieldSx = (fill = 'var(--dash-surface)') => ({
  '& .MuiInputLabel-root': { color: 'var(--dash-dim)' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--dash-accent)' },
  '& .MuiInputLabel-root.Mui-error': { color: 'var(--dash-danger)' },
  '& .MuiOutlinedInput-root': {
    color: 'var(--dash-ink)',
    backgroundColor: fill,
    borderRadius: 'var(--dash-radius-sm)',
  },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--dash-field)' },
  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--dash-ink)' },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--dash-accent)' },
  '& .MuiOutlinedInput-root.Mui-error .MuiOutlinedInput-notchedOutline': {
    borderColor: 'var(--dash-danger)',
    borderWidth: 2,
  },
  '& .MuiFormHelperText-root': { color: 'var(--dash-dim)', mx: 0 },
  '& .MuiFormHelperText-root.Mui-error': { color: 'var(--dash-danger)', fontWeight: 600 },
  '& .MuiInputAdornment-root, & .MuiAutocomplete-endAdornment .MuiSvgIcon-root': { color: 'var(--dash-dim)' },
});

/** A radio or checkbox: `dash-dim` resting, `dash-accent` when checked. */
export const choiceControlSx = {
  color: 'var(--dash-dim)',
  '&.Mui-checked': { color: 'var(--dash-accent)' },
  '&.Mui-disabled': { color: 'var(--dash-dim)' },
};

/**
 * An alert on a tint (`danger` or `warning`): ink text on the tone's tint,
 * a solid edge and icon in the tone. Danger is registered over the page and
 * a card; warning over a card only, so a warning alert sits in a card.
 * `titleTone` paints an AlertTitle in the tone (the Create failure alert).
 */
export const alertSx = (tone, { titleTone = false } = {}) => ({
  backgroundColor: `var(--dash-${tone}-soft)`,
  color: 'var(--dash-ink)',
  border: `1px solid var(--dash-${tone})`,
  borderRadius: 'var(--dash-radius-sm)',
  alignItems: 'center',
  '& .MuiAlert-icon': { color: `var(--dash-${tone})` },
  '& .MuiAlertTitle-root': { color: titleTone ? `var(--dash-${tone})` : 'var(--dash-ink)', fontWeight: 600 },
});

/**
 * The retry inside an alert (the States board's Try again): ink on a
 * `dash-surface` chip with the tone's edge.
 */
export const alertActionSx = (tone) => ({
  ...buttonBaseSx,
  color: 'var(--dash-ink)',
  backgroundColor: 'var(--dash-surface)',
  border: `1px solid var(--dash-${tone})`,
  px: 2,
  '&:hover': { backgroundColor: 'var(--dash-surface2)' },
});

/**
 * A dialog's Paper. `fill` is its surface: `dash-surface` for a floating
 * dialog, `dash-bg` for a full-screen sheet (it then is the page).
 */
export const dialogPaperSx = (fill = 'var(--dash-surface)', { fullScreen = false } = {}) => ({
  backgroundColor: fill,
  backgroundImage: 'none',
  color: 'var(--dash-ink)',
  border: fullScreen ? 0 : HAIRLINE,
  borderRadius: fullScreen ? 0 : 'var(--dash-radius)',
});

/** A dialog title in the display face. */
export const dialogTitleSx = {
  fontFamily: DISPLAY_FONT,
  fontSize: '26px',
  fontWeight: 700,
  lineHeight: 1.1,
  textTransform: 'uppercase',
  color: 'var(--dash-ink)',
};

/**
 * A status chip (the boards' pills), on a card. Tones:
 *   live    danger text on the danger tint (a leading dot)
 *   accent  accent text on the accent tint with the accent line
 *   home    blue text on the home tint (a draft date)
 *   warning warning text on the warning tint
 *   neutral dim text in a `dash-line-strong` outline
 */
const CHIP_TONES = {
  live: { color: 'var(--dash-danger)', backgroundColor: 'var(--dash-danger-soft)', border: '1px solid var(--dash-danger-soft)' },
  accent: { color: 'var(--dash-accent)', backgroundColor: 'var(--dash-accent-soft)', border: '1px solid var(--dash-accent-line)' },
  home: { color: 'var(--dash-home)', backgroundColor: 'var(--dash-home-soft)', border: '1px solid var(--dash-home-soft)' },
  warning: { color: 'var(--dash-warning)', backgroundColor: 'var(--dash-warning-soft)', border: '1px solid var(--dash-warning-soft)' },
  neutral: { color: 'var(--dash-dim)', backgroundColor: 'transparent', border: '1px solid var(--dash-line-strong)' },
};

export const chipSx = (tone = 'neutral') => ({
  height: 24,
  borderRadius: 999,
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  ...(CHIP_TONES[tone] || CHIP_TONES.neutral),
  '& .MuiChip-label': { px: 1.25 },
  ...(tone === 'live'
    ? {
      '&::before': {
        content: '""',
        width: 7,
        height: 7,
        ml: 1.25,
        mr: -0.5,
        borderRadius: 999,
        backgroundColor: 'var(--dash-danger)',
        flexShrink: 0,
      },
    }
    : {}),
});

/**
 * A determinate LinearProgress as the boards draw it: `dash-accent` fill on a
 * `dash-surface3` track (a graphical object, registered at AA_LARGE).
 */
export const progressSx = {
  backgroundColor: 'var(--dash-surface3)',
  '& .MuiLinearProgress-bar': { backgroundColor: 'var(--dash-accent)', borderRadius: 999 },
};
