// Shared labels and rule-merging helpers for league settings display.
// Used by the commissioner editor (CommissionerTools) and the read-only
// League Rules page, so the two never drift on wording.

export const ROSTER_POSITION_OPTIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
export const DP_GROUP_KEYS = ['DL', 'LB', 'DB'];

export const RULE_CATEGORIES = ['passing', 'rushing', 'receiving', 'misc', 'kicking', 'teamDefense', 'idp'];
export const CATEGORY_LABELS = {
  passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', misc: 'Misc & Returns',
  kicking: 'Kicking', teamDefense: 'Team Defense', idp: 'Individual Defense (IDP)',
};
export const LEAF_LABELS = {
  yards: 'Per Yard', touchdowns: 'Touchdown', interceptions: 'Interception',
  twoPointConversions: '2-Pt Conversion', reception: 'Reception', fumblesLost: 'Fumble Lost',
  returnTDs: 'Kick/Punt Return TD', puntReturnYards: 'Per Punt Return Yard',
  kickReturnYards: 'Per Kick Return Yard',
  extraPoint: 'Extra Point', extraPointMissed: 'Extra Point Missed',
  fieldGoalMissed: 'Field Goal Missed', sack: 'Sack', interception: 'Interception',
  fumbleRecovery: 'Fumble Recovery', defensiveTD: 'Defensive TD', safety: 'Safety',
  blockedKick: 'Blocked Kick', soloTackle: 'Solo Tackle', assistedTackle: 'Assisted Tackle',
  forcedFumble: 'Forced Fumble', passDeflection: 'Pass Defended', qbHit: 'QB Hit',
  tacklesForLoss: 'Tackle For Loss', twoPointReturn: '2-Pt Return',
  sackYards: 'Per Sack Yard', tacklesForLossYards: 'Per TFL Yard',
  fumbleReturnYards: 'Per Fumble Return Yard',
};
export const TIER_LABELS = {
  fieldGoal: 'Field Goal (by distance)', pointsAllowed: 'Points Allowed', yardsAllowed: 'Yards Allowed',
  yardageBonus: 'Yardage Bonus', tdLengthBonus: 'TD Length Bonus',
};

export const WAIVER_TYPE_LABELS = {
  faab: 'FAAB (Bidding)',
  priority: 'Rolling Priority',
};

export const SCORING_PRESET_LABELS = {
  standard: 'Standard',
  half_ppr: 'Half PPR',
  ppr: 'Full PPR',
  custom: 'Custom',
};

/**
 * The PPR format a league actually plays, read off its effective reception
 * rate rather than the stored `scoring_preset`. Preferred for display: a brand
 * new league has a null preset (and the server defaults to half PPR), and a
 * league with any custom rule has its preset flipped to 'custom' — in both
 * cases the stored value says less about the scoring than the rate does.
 * Returns null for a rate with no conventional name, so callers can decide how
 * to phrase it.
 */
export function receptionFormatLabel(rules) {
  const rate = Number(rules?.receiving?.reception);
  if (!Number.isFinite(rate)) return null;
  if (rate === 0) return 'Standard';
  if (rate === 0.5) return 'Half PPR';
  if (rate === 1) return 'Full PPR';
  return null;
}

// Per-yard rate leaves get a "1 pt per N yds" translation so a commissioner
// used to NFL.com's phrasing can sanity-check the decimal.
export const PER_YARD_KEYS = new Set([
  'yards', 'puntReturnYards', 'kickReturnYards', 'sackYards', 'tacklesForLossYards', 'fumbleReturnYards',
]);
export function perYardHelper(key, value) {
  if (!PER_YARD_KEYS.has(key)) return undefined;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) return undefined;
  return `= 1 pt per ${Math.round(1 / rate)} yds`;
}

// Client-side mirror of scoring.service.js's mergeRuleCategory — only used
// to seed display/editor values from a league's stored (possibly partial)
// scoring_rules; the server re-validates and re-merges on save.
export function mergeCategoryClient(defaults, custom) {
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(custom || {})) {
    if (!(key in defaults)) continue;
    if (Array.isArray(defaults[key])) {
      if (Array.isArray(value) && value.length > 0) {
        merged[key] = value.map((t) => ({
          min: Number(t.min),
          max: t.max === null || t.max === undefined ? null : Number(t.max),
          points: Number(t.points),
          ...(t.pointsPerYardOverMin === undefined
            ? {}
            : { pointsPerYardOverMin: Number(t.pointsPerYardOverMin) }),
        }));
      }
    } else if (Number.isFinite(Number(value))) {
      merged[key] = Number(value);
    }
  }
  return merged;
}

export function buildInitialRules(defaults, custom) {
  const rules = {};
  for (const [category, catDefaults] of Object.entries(defaults || {})) {
    const customCategory = custom && typeof custom === 'object' ? custom[category] : null;
    rules[category] = customCategory && typeof customCategory === 'object' && !Array.isArray(customCategory)
      ? mergeCategoryClient(catDefaults, customCategory)
      : { ...catDefaults };
  }
  return rules;
}

// "40-49" / "50+" for a tier row; max === null means open-ended.
export function tierRangeLabel(tier) {
  const min = Number(tier?.min) || 0;
  if (tier?.max === null || tier?.max === undefined) return `${min}+`;
  return `${min}–${Number(tier.max)}`;
}

// Points render with their own precision (0.04, 0.5, 6) rather than a fixed
// number of decimals, so per-yard rates stay readable next to whole-point TDs.
export function formatPoints(value) {
  const points = Number(value);
  if (!Number.isFinite(points)) return '—';
  return String(points);
}
