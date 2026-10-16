import React from 'react';
import { Box } from '@mui/material';
import { listArticles } from '../../content/articles';
import { formatInstant } from '../../shared/lib/instantFormat';
import { Frame, FrameHead, PsLink, PixelHeading } from '../../shared/ui/playselect';

/**
 * The Columns frame on the authed dashboard: the newest Darkness Report from
 * the strategy library, as a headline, a byline and one link. With no report in
 * the registry the frame is not rendered.
 *
 * Two deliberate mechanics:
 * - The link is a plain href, not a RouterLink. The authed app lives in the
 *   hash router, so a public path is a full page load that RootRouter hands to
 *   the public BrowserRouter tree — exactly how the dual-router shell is meant
 *   to be crossed.
 * - This module is React.lazy'd from UserPage. It imports the strategy-article
 *   registry, and an eager import would push all of it into the initial main
 *   bundle; as a lazy chunk it stays outside the 250 KiB initial-JS budget.
 */

// "Week 6 Waiver Wire: The Darkness Report" is the Waiver Wire series.
const seriesOf = (article) => article.title.match(/^(?:Week \d+ )?(.+?):/)?.[1] ?? article.category;

function PublicHighlights() {
  // listArticles is newest first.
  const report = listArticles().find((article) => /Darkness Report/i.test(article.title));
  if (!report) return null;

  const series = seriesOf(report);
  // Frontmatter dates are date-only strings, which Date reads as UTC midnight
  // (a day early west of UTC); pin them to local midnight.
  const byline = [
    series,
    report.author,
    formatInstant(`${report.date}T00:00:00`, 'day'),
    report.readMinutes != null && `${report.readMinutes} min read`,
  ].filter(Boolean).join(' · ');

  return (
    <Frame labelledBy="columns-heading" head={<FrameHead><PixelHeading id="columns-heading">Columns</PixelHeading></FrameHead>}>
      <Box component="article" sx={{ p: { xs: '14px', md: '16px 20px' }, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <Box component="p" sx={{ m: 0, fontSize: { xs: '18px', md: '19px' }, fontWeight: 600, lineHeight: 1.35 }}>
          {report.title}
        </Box>
        <Box sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>{byline}</Box>
        <Box sx={{ ml: '-10px' }}>
          <PsLink href={`/strategy/${report.slug}`}>{`Read the ${series} column`}</PsLink>
        </Box>
      </Box>
    </Frame>
  );
}

export default PublicHighlights;
