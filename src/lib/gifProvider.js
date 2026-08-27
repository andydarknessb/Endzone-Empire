/**
 * The client-side GIF provider registry (#446).
 *
 * A GIF message stores an OPAQUE (provider, assetId) and a required description
 * (leagueFeed.feedEntryOf -> entry.media). Turning that reference into something
 * renderable - a still frame, the animation, attribution - is a PROVIDER
 * concern, and this registry is where a provider is looked up.
 *
 * DISABLED BY DEFAULT, AND THAT IS THE POINT (AC5/AC7/AC9). In production this
 * registry is EMPTY: no GIPHY or Tenor resolver is registered, because none may
 * be introduced before external approval (AC9). So resolveGifAsset returns null
 * for every stored asset, and the UI falls back to the "GIF unavailable" tile
 * that still shows the caption and description (AC5). The picker is likewise
 * absent when the capability is off (AC7), so no GIF message is ever composed in
 * production in the first place; these columns stay null there.
 *
 * A PROVIDER NEVER MAKES A NETWORK REQUEST HERE (AC9). resolveGifAsset is pure:
 * it hands the descriptor to a registered resolver and returns what the resolver
 * returns. A real provider added after approval would return that provider's
 * rendition URLs; introducing it is a deliberate future change, not something
 * that happens by leaving this file as it is. Tests register a DETERMINISTIC
 * FAKE (see gifProviderFake.js) that answers FROM the assetId and returns
 * app-owned data, so the whole experience is exercisable with no third party.
 */

const providers = new Map();

/** Register a resolver for a provider id. Test-only in this ticket: production
 *  registers nothing (AC9). A resolver is `(media) => rendition | null`. */
export function registerGifProvider(id, resolver) {
  providers.set(id, resolver);
}

/** Remove one provider, or all of them. Tests clear between cases so a fake
 *  never leaks into another test's "unavailable" expectation. */
export function clearGifProviders(id) {
  if (id === undefined) providers.clear();
  else providers.delete(id);
}

/**
 * The id of the first registered provider, or null when none is registered
 * (the production default, AC9). The composer uses this to stamp a GIF send
 * with the provider that will resolve it: with no provider registered there is
 * nothing to send against, so the picker cannot compose a GIF even if the
 * capability flag were somehow on. A real integration registers exactly one
 * provider after approval; this returns it.
 */
export function firstGifProviderId() {
  const [first] = providers.keys();
  return first ?? null;
}

/**
 * Resolve a media descriptor to a rendition, or null when unavailable.
 *
 * Returns null - the "unavailable" signal the tile renders from - when the
 * descriptor is missing, names no provider, no provider is registered for it
 * (the production default), or the resolver itself declines. A resolved
 * rendition always carries the `description` through so the renderer never has
 * to reach back to the raw entry for its alt text.
 *
 * @param {{provider:string, assetId:string, description:string}} media
 * @returns {{still:string|null, animated:string|null, attribution:object|null,
 *            description:string}|null}
 */
export function resolveGifAsset(media) {
  if (!media || !media.provider || !media.assetId) return null;
  const resolver = providers.get(media.provider);
  if (typeof resolver !== 'function') return null;
  const rendition = resolver(media);
  if (!rendition) return null;
  return {
    still: rendition.still ?? null,
    animated: rendition.animated ?? null,
    attribution: rendition.attribution ?? null,
    description: media.description,
  };
}
