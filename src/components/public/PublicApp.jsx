import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Container } from '@mui/material';
import { HelmetProvider } from 'react-helmet-async';
import AppThemeProvider from '../../theme/AppThemeProvider';
import { LoadingRows } from './kit/DataState';

// Lazy-load every public page so the authed bundle doesn't grow — the public
// tree is only ever fetched when a visitor lands on a public URL.
const RankingsPage = lazy(() => import('./pages/RankingsPage'));
const PlayerProfilePage = lazy(() => import('./pages/PlayerProfilePage'));
const WaiverWirePage = lazy(() => import('./pages/WaiverWirePage'));
const StrategyIndexPage = lazy(() => import('./pages/StrategyIndexPage'));
const ArticlePage = lazy(() => import('./pages/ArticlePage'));
const RecapsPage = lazy(() => import('./pages/RecapsPage'));
const RecapDetailPage = lazy(() => import('./pages/RecapDetailPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));

function SuspenseFallback() {
  return (
    <Container maxWidth="lg" sx={{ py: 8 }}>
      <LoadingRows rows={8} />
    </Container>
  );
}

/**
 * The public (no-login) app tree. Mounted by RootRouter when the pathname is a
 * public path; uses a real BrowserRouter (public URLs are plain paths, not hash
 * fragments). Wrapped in its own AppThemeProvider so it is theme-aware and has
 * the light/dark toggle, exactly like the authed app.
 */
function PublicApp() {
  return (
    <HelmetProvider>
      <AppThemeProvider>
        <BrowserRouter>
          <Suspense fallback={<SuspenseFallback />}>
            <Routes>
              <Route path="/rankings" element={<RankingsPage />} />
              <Route path="/players/:id" element={<PlayerProfilePage />} />
              <Route path="/waiver-wire" element={<WaiverWirePage />} />
              <Route path="/strategy" element={<StrategyIndexPage />} />
              <Route path="/strategy/:slug" element={<ArticlePage />} />
              <Route path="/recaps" element={<RecapsPage />} />
              <Route path="/recaps/:gameId" element={<RecapDetailPage />} />
              <Route path="/privacy" element={<LegalPage document="privacy" />} />
              <Route path="/terms" element={<LegalPage document="terms" />} />
              <Route path="/acceptable-use" element={<LegalPage document="acceptable-use" />} />
              {/* Any other public-prefixed path falls back to rankings. */}
              <Route path="*" element={<Navigate to="/rankings" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AppThemeProvider>
    </HelmetProvider>
  );
}

export default PublicApp;
