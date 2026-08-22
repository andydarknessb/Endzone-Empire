// Shared stat-line formatting for the quick-view dialog and the full profile
// page, so both read identically. Keep the defensive keys in sync with
// STAT_LINE_FIELDS in server/services/publicRead.service.js, which builds the
// same line server-side for the public profile endpoint.

export const STAT_LABELS = {
  passingYards: 'Pass Yds',
  passingTDs: 'Pass TD',
  interceptions: 'INT',
  rushingYards: 'Rush Yds',
  rushingTDs: 'Rush TD',
  receivingYards: 'Rec Yds',
  receivingTDs: 'Rec TD',
  receptions: 'Rec',
  fumbles: 'Fum',
  // Team defense
  sack: 'Sk',
  interceptionReturn: 'INT',
  fumbleRecovery: 'FR',
  defensiveTD: 'TD',
  safety: 'Sfty',
  blockedKick: 'Blk',
  pointsAllowed: 'PA',
  yardsAllowed: 'YdA',
  // Individual defenders (IDP)
  soloTackle: 'Solo',
  assistedTackle: 'Ast',
  idpSack: 'Sk',
  idpInterception: 'INT',
  forcedFumble: 'FF',
  idpFumbleRecovery: 'FR',
  passDeflection: 'PD',
  qbHit: 'QBH',
  tacklesForLoss: 'TFL',
  idpSafety: 'Sfty',
  idpDefensiveTD: 'TD',
  twoPointReturn: '2pt Ret',
};

// Order stats by salience so a line reads naturally instead of leading with
// fumbles: rushing, then receiving, then passing, with fumbles always last.
// Zero/absent stats are dropped, so a QB line still starts with passing.
// Offensive and defensive keys never co-occur on one row, so the defensive
// keys can simply follow. IDP sack/TFL/fumble-return YARDAGE keys are
// deliberately absent — they're opt-in bonus inputs, not headline stats.
const STAT_ORDER = [
  'rushingYards',
  'rushingTDs',
  'receptions',
  'receivingYards',
  'receivingTDs',
  'passingYards',
  'passingTDs',
  'interceptions',
  'fumbles',
  // Team defense
  'sack',
  'interceptionReturn',
  'fumbleRecovery',
  'defensiveTD',
  'safety',
  'blockedKick',
  'pointsAllowed',
  'yardsAllowed',
  // IDP
  'soloTackle',
  'assistedTackle',
  'idpSack',
  'idpInterception',
  'forcedFumble',
  'idpFumbleRecovery',
  'passDeflection',
  'qbHit',
  'tacklesForLoss',
  'idpSafety',
  'idpDefensiveTD',
  'twoPointReturn',
];

// Stats whose zero is itself the story — a defense that pitched a shutout
// should read "0 PA", not drop the field entirely.
const ALWAYS_SHOW = new Set(['pointsAllowed']);

export function statLine(stats) {
  const s = stats || {};
  const parts = STAT_ORDER.filter(
    (key) => s[key] != null && (Number(s[key]) !== 0 || ALWAYS_SHOW.has(key))
  ).map((key) => `${s[key]} ${STAT_LABELS[key]}`);
  return parts.length > 0 ? parts.join(', ') : '-';
}
