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

/**
 * Lowercase, every other run of non-letters/digits one space. Apostrophe-like
 * characters are deleted (a typed "Xs" = "X's" for a phrase) or, as the second
 * variant, spaced (a possessive matches its bare name).
 */
const plain = (s, apostrophe) =>
  String(s).toLowerCase().replace(/['\u2018\u2019\u02bc`]/g, apostrophe).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whole word or whole phrase, case-, punctuation- and spacing-insensitive, under either apostrophe variant. */
const hasTerm = (text, term) => ['', ' '].some((a) => ` ${plain(text, a)} `.includes(` ${plain(term, a)} `));

/**
 * The first deny-list term in `text` that `factsText` does not also carry, else
 * null. A term the facts carry is never a reason to discard: a real player can
 * share a name with the list.
 */
const deniedTerm = (text, factsText = '') =>
  DENY.find((term) => hasTerm(text, term) && !hasTerm(factsText, term)) || null;

module.exports = { VOICE_KEYS, voiceBlockFor, withVoice, deniedTerm, hasTerm };
