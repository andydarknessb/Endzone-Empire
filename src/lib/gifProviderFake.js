/**
 * A deterministic FAKE GIF provider (#446 AC8).
 *
 * The whole GIF experience must be exercisable WITHOUT a real provider (AC9):
 * no key, no network, nothing sent to a third party. This fake is how. It is
 * registered by tests (and only by tests - production registers no provider at
 * all, gifProvider.js) and it ANSWERS FROM THE REQUEST rather than returning
 * canned data: every rendition and the attribution are derived from the
 * assetId, so a test that passes asset "abc" and reads back a rendition naming
 * "abc" has proven the asset actually flowed through the contract, which a
 * fixed canned response could never show.
 *
 * It makes NO network request: the renditions are app-owned strings that embed
 * the id. jsdom never fetches an <img> src in a unit test, and even in a real
 * browser these are self-contained references, not a provider URL - so AC9
 * holds even with the capability enabled.
 */

export const FAKE_PROVIDER_ID = 'fake';

/**
 * Resolve a media descriptor deterministically from its assetId. Distinct ids
 * produce distinct renditions and attribution; the same id always produces the
 * same result, so a reconnect or a retry reproduces byte-identical output.
 */
export function fakeGifResolver(media) {
  if (!media || !media.assetId) return null;
  const id = media.assetId;
  return {
    // Renditions that embed the id, so a test asserts the request reached here.
    still: `fake-still:${id}`,
    animated: `fake-animated:${id}`,
    // Attribution derived from the id, surfaced behind the capability boundary
    // (AC6). Source and creator are text; no URL is fetched.
    attribution: { source: 'Fake GIF Library', creator: `creator-${id}` },
  };
}
