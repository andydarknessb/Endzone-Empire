import { FIELD_GREEN, colorDistance, CONTRAST_THRESHOLD } from '../../../shared/lib';

/**
 * A Team sprite kit. Postgame Teams are fantasy Teams with no real uniform, so
 * the kit is a stable pick from an NES-palette table by hash of the Team id:
 * the same Team always wears the same colors. The pick is then moved along the
 * table to the next kit that reads, when its jersey is too close (under
 * CONTRAST_THRESHOLD) to the field green or to the opponent jersey. Pure and
 * deterministic: same input, same kit.
 */
const nes = (jersey, pants, accent) => Object.freeze({
  helmet: jersey, jersey, pants, accent,
});

export const TEAM_KITS = Object.freeze([
  nes('#d82800', '#fcfcfc', '#fcfcfc'),
  nes('#0058f8', '#fcfcfc', '#f8b800'),
  nes('#fcfcfc', '#0058f8', '#d82800'),
  nes('#f8b800', '#503000', '#503000'),
  nes('#6844fc', '#fcfcfc', '#f8b800'),
  nes('#00a800', '#fcfcfc', '#fcfcfc'),
  nes('#fc7460', '#503000', '#fcfcfc'),
  nes('#f878f8', '#fcfcfc', '#6844fc'),
  nes('#00e8d8', '#0058f8', '#fcfcfc'),
  nes('#503000', '#f8b800', '#f8b800'),
  nes('#7c7c7c', '#fcfcfc', '#d82800'),
  nes('#1c1c1c', '#fcfcfc', '#f8b800'),
]);

/** A small integer hash (FNV-1a) of the id text, stable across runs. */
function hashOf(teamId) {
  let hash = 2166136261;
  const text = String(teamId);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const reads = (kit, opponentKit) => (
  colorDistance(kit.jersey, FIELD_GREEN) >= CONTRAST_THRESHOLD
  && (!opponentKit || colorDistance(kit.jersey, opponentKit.jersey) >= CONTRAST_THRESHOLD)
);

export function kitForTeam(teamId, opponentKit) {
  const start = hashOf(teamId) % TEAM_KITS.length;
  for (let step = 0; step < TEAM_KITS.length; step += 1) {
    const kit = TEAM_KITS[(start + step) % TEAM_KITS.length];
    if (reads(kit, opponentKit)) return kit;
  }
  return TEAM_KITS[start];
}
