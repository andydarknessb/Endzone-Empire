import React from 'react';
import { Box, Container } from '@mui/material';
import PublicHeader from './PublicHeader';
import PublicFooter from './PublicFooter';
import CTABanner from './kit/CTABanner';

/**
 * Page chrome for every public route: sticky header, a centered <main> content
 * column (max 1200px), an optional closing CTA banner, and the footer. Section
 * padding is generous on desktop and tightened on mobile.
 *
 * `maxWidth` lets reading pages (articles) narrow the column; `showCta={false}`
 * suppresses the banner on pages that render their own.
 */
function PublicLayout({ children, maxWidth = 'lg', showCta = true, disableGutterY = false, ctaContext = 'default' }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      <PublicHeader />
      <Box component="main" sx={{ flexGrow: 1 }}>
        <Container maxWidth={maxWidth} sx={disableGutterY ? undefined : { py: { xs: 4, md: 8 } }}>
          {children}
        </Container>
      </Box>
      {showCta && <CTABanner context={ctaContext} />}
      <PublicFooter />
    </Box>
  );
}

export default PublicLayout;
