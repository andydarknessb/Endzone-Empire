import React from 'react';
import {
  Card, CardContent, Link, Typography,
} from '@mui/material';
import { listArticles } from '../../content/articles';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { formatInstant } from '../../shared/lib/instantFormat';
import {
  DISPLAY_FONT, dimSx, panelSx, panelTitleSx, textLinkSx,
} from '../common/homeIslandSx';

/**
 * The Darkness Report card on the authed dashboard: the newest Darkness Report
 * from the strategy library, as a headline, a byline and one link. With no
 * report in the registry the card is not rendered.
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

// inline-flex so the 44px floor applies to the link.
const readLinkSx = {
  ...textLinkSx, ...MIN_TOUCH_TARGET_SX, display: 'inline-flex', alignItems: 'center',
};

function PublicHighlights() {
  // listArticles is newest first.
  const report = listArticles().find((article) => /Darkness Report/i.test(article.title));
  if (!report) return null;

  // Frontmatter dates are date-only strings, which Date reads as UTC midnight
  // (a day early west of UTC); pin them to local midnight.
  const byline = [
    report.author,
    formatInstant(`${report.date}T00:00:00`, 'day'),
    report.readMinutes != null && `${report.readMinutes} min read`,
  ].filter(Boolean).join(' · ');

  return (
    <Card variant="outlined" sx={{ ...panelSx, height: '100%' }}>
      <CardContent>
        <Typography variant="h6" component="h2" sx={{ ...panelTitleSx, mb: 1.5 }}>
          The Darkness Report
        </Typography>
        <Typography
          component="p"
          sx={{
            fontFamily: DISPLAY_FONT, fontSize: '24px', fontWeight: 600, lineHeight: 1.2, color: 'var(--dash-ink)',
          }}
        >
          {report.title}
        </Typography>
        <Typography variant="body2" sx={{ ...dimSx, fontSize: '14px', mt: 0.5, mb: 1 }}>
          {byline}
        </Typography>
        <Link href={`/strategy/${report.slug}`} underline="hover" sx={readLinkSx}>
          Read the report
        </Link>
      </CardContent>
    </Card>
  );
}

export default PublicHighlights;
