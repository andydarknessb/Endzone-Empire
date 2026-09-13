/**
 * The Decision card's generic entry shape (#1307, ADR 0040), pure. WaiverWire
 * and PlayerManagement each carried a byte-identical `toDecisionCardEntry`
 * before formal review round 1 (f9) named the duplication; this entity is
 * the natural single home; both surfaces read it from HERE now. No lineup
 * fields (`slot`/`locked`/`spent`/`eligibleSlots`) exist for a Player
 * Browser or waivers-list row, so those are simply absent rather than
 * guessed - the widget's `lineupManaged` gate (PlayerDecisionCard.jsx) is
 * what keeps a lineup-shaped action bar from ever reading them.
 */
export function toDecisionCardEntry(player) {
  return player
    ? {
        playerId: player.id,
        name: player.name,
        position: player.position,
        nflTeam: player.nfl_team,
        slot: player.position,
        injuryStatus: player.injury_status ?? null,
        photoUrl: player.photo_url ?? null,
      }
    : null;
}

export default toDecisionCardEntry;
