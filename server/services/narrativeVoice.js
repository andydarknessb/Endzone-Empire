const polkHighLegend = require('./voices/polkHighLegend');

/**
 * Voice (ADR 0069, CONTEXT.md): a league's choice of how Claude's rewrite of a
 * Recap or Matchup narrative sounds. `leagues.narrative_voice` holds a key
 * below, or null for neutral. The block heads the surface's system prompt so
 * the surface's own rules follow it and win; the deny list discards a rewrite
 * that names a borrowed character, place or catchphrase. Only recap.service
 * and matchupNarrative.service reach for this; the public game recap and the
 * Projection explanation stay neutral.
 */

const VOICES = Object.freeze({ polk_high_legend: polkHighLegend });
const VOICE_KEYS = Object.freeze(Object.keys(VOICES));

const DENY = Object.values(VOICES).flatMap((v) => v.DENY);

/** The block for a known Voice, '' for null or unknown (neutral). */
const voiceBlockFor = (voice) => (VOICE_KEYS.includes(voice) ? VOICES[voice].VOICE_BLOCK : '');

/** `system` with the Voice block at its head; `system` itself when neutral. */
const withVoice = (system, voice) => (voiceBlockFor(voice) ? `${voiceBlockFor(voice)}\n\n${system}` : system);

const plain = (s) => String(s).replace(/[\u2018\u2019]/g, "'").toLowerCase();

/** Whole word or whole phrase, case-insensitive; a letter or digit beside it is not a match. */
const hasTerm = (text, term) => {
  const escaped = plain(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(plain(text));
};

/**
 * The first deny-list term in `text` that `factsText` does not also carry, else
 * null. A term the facts carry is never a reason to discard: a real player can
 * share a name with the list.
 */
const deniedTerm = (text, factsText = '') =>
  DENY.find((term) => hasTerm(text, term) && !hasTerm(factsText, term)) || null;

module.exports = { VOICE_KEYS, voiceBlockFor, withVoice, deniedTerm, hasTerm };
