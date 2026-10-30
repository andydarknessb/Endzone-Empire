import { BODY_FONT } from './type';

/**
 * The page root's token context for a Play-select page (DESIGN.md "Play-select:
 * Home and league pages"): `ps-field`, `ps-ink` and Archivo. The root element
 * also takes `className="ps-root"`, which scopes the focus ring, selection,
 * hover and cursor rules in playselect.css.
 */
export const psRootSx = {
  backgroundColor: 'var(--ps-field)',
  color: 'var(--ps-ink)',
  fontFamily: BODY_FONT,
};

/** Home and the league dashboard remap Panel and Skel to the NES-navy menu panel in dark (#2652, #2660). */
export const MENU_PANEL_VARS = { '--ps-panel': 'var(--ps-menu-panel)', '--ps-skel': 'var(--ps-menu-skel)' };
