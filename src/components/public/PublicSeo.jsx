import React from 'react';
import { Helmet } from 'react-helmet-async';

export const SITE_NAME = 'Endzone Empire';
export const SITE_ORIGIN = 'https://endzoneempire.gg';
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-brand-gradient.png`;

// Site-wide default, shared with the static shell (public/index.html), which
// cannot import it: shellMeta.test.jsx asserts the two stay equal (#351).
// Product-first: the fantasy league is named before the pick'em league, and
// the sentence opens with the product clause (2026-08-25 ruling on #399,
// follow-up to #50). The pick'em clause matches the hero's middot fragment
// (LandingPage.jsx) as of this writing; the two are independent literals,
// not a shared constant, so keep them in sync by hand. No em-dashes.
export const DEFAULT_DESCRIPTION =
  "Run a fantasy football league, or an NFL pick'em league · no draft, no rosters. Free rankings, player profiles, strategy guides, and NFL game recaps.";

// Shell-only title (public/index.html <title>, og:title, twitter:title): a
// descriptor beyond the bare site name so a search/social snippet says what
// the product is (2026-08-25 ruling on #399). SITE_NAME is untouched; it
// still builds the `Page · Endzone Empire` per-route title below (#401).
export const SHELL_TITLE = "Endzone Empire · Fantasy Football & NFL Pick'em Leagues";

function absoluteUrl(value) {
  if (/^https?:\/\//i.test(String(value || ''))) return value;
  const path = String(value || '/');
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

function trimDescription(value, maxLength = 200) {
  const text = String(value || DEFAULT_DESCRIPTION).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}\u2026`;
}

/**
 * Metadata shared by every page in the BrowserRouter-only public shell.
 * PublicApp owns the HelmetProvider; the authenticated HashRouter tree never
 * mounts this component or receives Helmet context.
 */
function PublicSeo({
  title,
  description,
  path,
  type = 'website',
  image = DEFAULT_OG_IMAGE,
  imageAlt = 'Endzone Empire fantasy football',
  noIndex = false,
}) {
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} · ${SITE_NAME}`;
  const normalizedDescription = trimDescription(description);
  const canonicalUrl = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={normalizedDescription} />
      <link rel="canonical" href={canonicalUrl} />
      {noIndex && <meta name="robots" content="noindex,follow" />}

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={normalizedDescription} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={imageAlt} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={normalizedDescription} />
      <meta name="twitter:image" content={imageUrl} />
      <meta name="twitter:image:alt" content={imageAlt} />
    </Helmet>
  );
}

export default PublicSeo;
