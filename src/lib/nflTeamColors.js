// Static lookup of all 32 NFL teams' primary home-uniform colors, plus the
// contrast logic the Tecmo cutscene needs so a sprite always reads against the
// green field and against the chasing defender. Plain constants — no API call.
//
// Each kit maps to the sprite's pixel roles:
//   helmet -> H, jersey -> J, pants -> P, accent -> jersey number / trim row.
// `alt` is the team's contrasting (white/away) combo, used by the contrast
// guard when the home jersey would vanish into the field or clash with the
// defender.

// The field the sprites run on (matches TecmoCutscene's field color). Kept here
// so the contrast guard and the render agree on one source of truth.
export const FIELD_GREEN = '#1f7a3d';

// Neutral kit for unknown/missing abbreviations — never throw, never a blank sprite.
export const FALLBACK_KIT = Object.freeze({
  helmet: '#9aa0a6',
  jersey: '#d7d9dc',
  pants: '#5f6368',
  accent: '#3c4043',
  alt: { helmet: '#5f6368', jersey: '#ffffff', pants: '#5f6368', accent: '#9aa0a6' },
});

// A plain white/away combo, reused for teams whose home jersey is a dark green.
const whiteAlt = (accent, pants) => ({
  helmet: pants,
  jersey: '#ffffff',
  pants,
  accent,
});

export const NFL_TEAM_COLORS = Object.freeze({
  ARI: { helmet: '#97233f', jersey: '#97233f', pants: '#ffffff', accent: '#000000' },
  ATL: { helmet: '#000000', jersey: '#a71930', pants: '#000000', accent: '#a5acaf' },
  BAL: { helmet: '#241773', jersey: '#241773', pants: '#ffffff', accent: '#9e7c0c' },
  BUF: { helmet: '#00338d', jersey: '#00338d', pants: '#ffffff', accent: '#c60c30' },
  CAR: { helmet: '#000000', jersey: '#0085ca', pants: '#ffffff', accent: '#101820' },
  CHI: { helmet: '#0b162a', jersey: '#0b162a', pants: '#ffffff', accent: '#c83803' },
  CIN: { helmet: '#000000', jersey: '#fb4f14', pants: '#000000', accent: '#ffffff' },
  CLE: { helmet: '#ff3c00', jersey: '#311d00', pants: '#ffffff', accent: '#ff3c00' },
  DAL: { helmet: '#041e42', jersey: '#003594', pants: '#869397', accent: '#ffffff' },
  DEN: { helmet: '#002244', jersey: '#002244', pants: '#ffffff', accent: '#fb4f14' },
  DET: { helmet: '#0076b6', jersey: '#0076b6', pants: '#b0b7bc', accent: '#b0b7bc' },
  GB: { helmet: '#ffb612', jersey: '#203731', pants: '#ffb612', accent: '#ffb612', alt: whiteAlt('#203731', '#203731') },
  HOU: { helmet: '#03202f', jersey: '#03202f', pants: '#ffffff', accent: '#a71930' },
  IND: { helmet: '#002c5f', jersey: '#002c5f', pants: '#ffffff', accent: '#a2aaad' },
  JAX: { helmet: '#101820', jersey: '#006778', pants: '#ffffff', accent: '#d7a22a' },
  KC: { helmet: '#e31837', jersey: '#e31837', pants: '#ffffff', accent: '#ffb81c' },
  LV: { helmet: '#a5acaf', jersey: '#000000', pants: '#a5acaf', accent: '#a5acaf' },
  LAC: { helmet: '#0080c6', jersey: '#0080c6', pants: '#ffffff', accent: '#ffc20e' },
  LAR: { helmet: '#003594', jersey: '#003594', pants: '#ffd100', accent: '#ffd100' },
  MIA: { helmet: '#008e97', jersey: '#008e97', pants: '#ffffff', accent: '#fc4c02' },
  MIN: { helmet: '#4f2683', jersey: '#4f2683', pants: '#ffffff', accent: '#ffc62f' },
  NE: { helmet: '#002244', jersey: '#002244', pants: '#ffffff', accent: '#c60c30' },
  NO: { helmet: '#d3bc8d', jersey: '#101820', pants: '#d3bc8d', accent: '#d3bc8d' },
  NYG: { helmet: '#0b2265', jersey: '#0b2265', pants: '#ffffff', accent: '#a71930' },
  NYJ: { helmet: '#125740', jersey: '#125740', pants: '#ffffff', accent: '#ffffff', alt: whiteAlt('#125740', '#125740') },
  PHI: { helmet: '#004c54', jersey: '#004c54', pants: '#ffffff', accent: '#a5acaf', alt: whiteAlt('#004c54', '#004c54') },
  PIT: { helmet: '#101820', jersey: '#101820', pants: '#ffb612', accent: '#ffb612' },
  SF: { helmet: '#b3995d', jersey: '#aa0000', pants: '#b3995d', accent: '#b3995d' },
  SEA: { helmet: '#002244', jersey: '#002244', pants: '#69be28', accent: '#69be28' },
  TB: { helmet: '#34302b', jersey: '#d50a0a', pants: '#34302b', accent: '#ff7900' },
  TEN: { helmet: '#4b92db', jersey: '#0c2340', pants: '#ffffff', accent: '#4b92db' },
  WAS: { helmet: '#5a1414', jersey: '#5a1414', pants: '#ffb612', accent: '#ffb612' },
});

/** #rrggbb -> {r,g,b}; tolerant of missing '#' and shorthand-free only. */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Euclidean distance in RGB (0..441). Cheap and good enough for "too close". */
export function colorDistance(a, b) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2);
}

// Below this RGB distance two colors read as "the same" at sprite scale.
export const CONTRAST_THRESHOLD = 100;

/** The team's kit, or the neutral fallback for unknown/missing abbreviations. */
export function getTeamKit(abbr) {
  const key = String(abbr || '').toUpperCase();
  return NFL_TEAM_COLORS[key] || FALLBACK_KIT;
}

/** A kit's contrasting combo: its explicit `alt`, or a derived white kit. */
function altKit(kit) {
  return kit.alt || whiteAlt(kit.accent, kit.jersey);
}

/**
 * Resolve the runner (scoring player's real NFL team) and the chasing defender
 * (that player's real-game opponent) into two kits that (a) both read against
 * the field and (b) don't share a near-identical jersey.
 *
 * Guard order: first pull the runner off the field green, then separate the
 * two jerseys — so a runner swapped to white can still force the defender to
 * swap if they now collide.
 */
export function getSpriteColors(runnerAbbr, defenderAbbr) {
  let runner = getTeamKit(runnerAbbr);
  let defender = getTeamKit(defenderAbbr);

  // 1. Runner must read against the field.
  if (colorDistance(runner.jersey, FIELD_GREEN) < CONTRAST_THRESHOLD) {
    runner = altKit(runner);
  }
  // 2. Defender must also read against the field.
  if (colorDistance(defender.jersey, FIELD_GREEN) < CONTRAST_THRESHOLD) {
    defender = altKit(defender);
  }
  // 3. The two sprites must not share a near-identical jersey; move the
  //    defender to its alt. If that still collides (both white), tint it grey.
  if (colorDistance(runner.jersey, defender.jersey) < CONTRAST_THRESHOLD) {
    const swapped = altKit(defender);
    defender = colorDistance(runner.jersey, swapped.jersey) < CONTRAST_THRESHOLD
      ? { ...swapped, jersey: '#4b4f52', helmet: '#4b4f52' }
      : swapped;
  }

  return { runner: normalizeKit(runner), defender: normalizeKit(defender) };
}

// The BOOM band behind the scorer's name in the cutscene's referee frame.
const BAND_BLACK = '#000000';

/**
 * Colors for the scorer's name on the black BOOM band: `text` is the first kit
 * color readable on black, `shadow` a second distinct kit color for the
 * two-tone pixel-text look, `stripe` the raw jersey for the band's decorative
 * top border (no contrast guard needed — it never sits behind text).
 */
export function getNameColors(abbr) {
  const kit = getTeamKit(abbr);
  const candidates = [kit.jersey, kit.accent, kit.helmet, kit.pants, '#ffffff'];
  const text = candidates.find(
    (c) => c && colorDistance(c, BAND_BLACK) >= CONTRAST_THRESHOLD
  ) || '#ffffff';
  const shadow = candidates.find(
    (c) => c && c !== text
      && colorDistance(c, text) >= CONTRAST_THRESHOLD
      && colorDistance(c, BAND_BLACK) >= 60
  ) || '#b3251f';
  return { text, shadow, stripe: kit.jersey };
}

/** Ensure a kit has all four roles (accent falls back to helmet). */
function normalizeKit(kit) {
  return {
    helmet: kit.helmet,
    jersey: kit.jersey,
    pants: kit.pants,
    accent: kit.accent || kit.helmet,
  };
}
