/**
 * Public surface of the matchup-hero widget (ticket #893, ADR 0031): the
 * "Your matchup" card on Game Center. The page composes it from here;
 * everything else in this folder is the widget's own internal slice. It reads
 * the Matchup entity only (ADR 0029) and takes the viewer's Team id and the
 * standings-derived record and rank lookups as props, since a Team's record
 * does not join the wire.
 */
export { default, MatchupHero } from './ui/MatchupHero';
