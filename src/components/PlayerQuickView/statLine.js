// Shared stat-line formatting for the quick-view dialog and the full profile
// page, so both read identically.

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
};

// Order stats by salience so a line reads naturally instead of leading with
// fumbles: rushing, then receiving, then passing, with fumbles always last.
// Zero/absent stats are dropped, so a QB line still starts with passing.
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
];

export function statLine(stats) {
  const s = stats || {};
  const parts = STAT_ORDER.filter((key) => s[key] != null && Number(s[key]) !== 0).map(
    (key) => `${s[key]} ${STAT_LABELS[key]}`
  );
  return parts.length > 0 ? parts.join(', ') : '—';
}
