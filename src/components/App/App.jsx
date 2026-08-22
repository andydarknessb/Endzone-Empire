import React, { lazy, Suspense, useEffect } from 'react';
import {
  HashRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import { useDispatch, useSelector } from 'react-redux';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import CircularProgress from '@mui/material/CircularProgress';

import Nav from '../Nav/Nav';
import Footer from '../Footer/Footer';

import ProtectedRoute from '../ProtectedRoute/ProtectedRoute';
import FantasyOnly from '../common/FantasyOnly';

import AboutPage from '../AboutPage/AboutPage';
import UserPage from '../UserPage/UserPage';
import InfoPage from '../InfoPage/InfoPage';
import LandingPage from '../LandingPage/LandingPage';
import LoginPage from '../LoginPage/LoginPage';
import RegisterPage from '../RegisterPage/RegisterPage';
import ForgotPassword from '../ForgotPassword/ForgotPassword';
import ResetPassword from '../ResetPassword/ResetPassword';
import VerifyEmail from '../VerifyEmail/VerifyEmail';
import AppThemeProvider from '../../theme/AppThemeProvider';
import OfflineBanner from '../OfflineBanner/OfflineBanner';
import NotFound from '../NotFound/NotFound';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import NavigationGuard from '../NavigationGuard/NavigationGuard';

import './App.css';

const LeagueManagement = lazy(() => import('../LeagueManagement/LeagueManagement'));
const LeagueDiscovery = lazy(() => import('../LeagueDiscovery/LeagueDiscovery'));
const TeamManagement = lazy(() => import('../TeamManagement/TeamManagement'));
const PlayerManagement = lazy(() => import('../PlayerManagement/PlayerManagement'));
const LeagueDashboard = lazy(() => import('../LeagueDashboard/LeagueDashboard'));
const MatchupDetail = lazy(() => import('../MatchupDetail/MatchupDetail'));
const GameCenter = lazy(() => import('../GameCenter/GameCenter'));
const DraftBoard = lazy(() => import('../DraftBoard/DraftBoard'));
const DraftSettings = lazy(() => import('../DraftSettings/DraftSettings'));
const LeagueRules = lazy(() => import('../LeagueRules/LeagueRules'));
const LeaguePickem = lazy(() => import('../LeaguePickem/LeaguePickem'));
const DraftPresenter = lazy(() => import('../DraftPresenter/DraftPresenter'));
const LineupScreen = lazy(() => import('../LineupScreen/LineupScreen'));
const WaiverWire = lazy(() => import('../WaiverWire/WaiverWire'));
const TradeCenter = lazy(() => import('../TradeCenter/TradeCenter'));
const TransactionLog = lazy(() => import('../TransactionLog/TransactionLog'));
const PowerRankings = lazy(() => import('../PowerRankings/PowerRankings'));
const LeagueHistory = lazy(() => import('../LeagueHistory/LeagueHistory'));
const NotificationPrefs = lazy(() => import('../NotificationPrefs/NotificationPrefs'));
const AuthenticatedPlayerProfilePage = lazy(() => import('../PlayerDetail/AuthenticatedPlayerProfilePage'));
const AdminDashboard = lazy(() => import('../AdminDashboard/AdminDashboard'));
const DraftSimScreen = lazy(() => import('../DraftSim/DraftSimScreen'));

// The Draft route path this session's skip link targets (issue #121). Kept
// as a narrow, route-scoped check rather than a site-wide skip link: the
// #draft-main-content landmark it points at only exists on this one route
// today (see DraftBoard.jsx). Broader coverage is parent-spec #108 territory.
const DRAFT_ROUTE_PATTERN = /^\/league\/[^/]+\/draft$/;

// HashRouter reads the URL's #fragment as the app's OWN route, so a plain
// `href="#draft-main-content"` skip link would make the browser's native
// same-page anchor navigation look like a route change to `/draft-main-
// content` instead of scrolling/focusing the landmark. Handle the click
// ourselves - focus the target directly - and never let that hash reach
// the router.
function skipToMainContent(event) {
  event.preventDefault();
  const target = document.getElementById('draft-main-content');
  if (!target) return;
  target.focus();
  target.scrollIntoView();
}

function AppLayout({ children }) {
  const { pathname } = useLocation();
  const isPresenter = pathname.startsWith('/present/');
  const isDraftRoute = DRAFT_ROUTE_PATTERN.test(pathname);

  return (
    <Box sx={isPresenter ? { minHeight: '100vh' } : { display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {isDraftRoute && (
        <Link
          href="#draft-main-content"
          onClick={skipToMainContent}
          sx={{
            position: 'fixed',
            top: 8,
            left: 8,
            zIndex: (theme) => theme.zIndex.tooltip + 1,
            transform: 'translateY(-200%)',
            transition: 'transform 0.15s ease-in',
            bgcolor: 'background.paper',
            color: 'text.primary',
            px: 2,
            minHeight: 44,
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 1,
            border: '2px solid',
            borderColor: 'primary.main',
            fontWeight: 600,
            textDecoration: 'none',
            '&:focus': { transform: 'translateY(0)' },
          }}
        >
          Skip to main content
        </Link>
      )}
      {!isPresenter && <Nav />}
      <Box sx={isPresenter ? undefined : { flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </Box>
      {!isPresenter && <Footer />}
    </Box>
  );
}

function App() {
  const dispatch = useDispatch();

  const user = useSelector(store => store.user);

  useEffect(() => {
    dispatch({ type: 'FETCH_USER' });
  }, [dispatch]);

  return (
    <AppThemeProvider>
    <SnackbarProvider>
    <OfflineBanner />
    <Router>
      <NavigationGuard>
      <AppLayout>
        <Suspense
          fallback={(
            <Box role="status" aria-label="Loading page" sx={{ py: 8, textAlign: 'center' }}>
              <CircularProgress />
            </Box>
          )}
        >
        <Routes>
          <Route path="/present/:token" element={<DraftPresenter />} />
          <Route path="/league" element={<ProtectedRoute><LeagueManagement /></ProtectedRoute>} />
          <Route path="/league/join" element={<ProtectedRoute><LeagueManagement /></ProtectedRoute>} />
          <Route path="/discover" element={<ProtectedRoute><LeagueDiscovery /></ProtectedRoute>} />
          <Route path="/team" element={<ProtectedRoute><TeamManagement /></ProtectedRoute>} />
          <Route path="/player" element={<ProtectedRoute><PlayerManagement /></ProtectedRoute>} />
          <Route path="/league/:leagueId" element={<ProtectedRoute><LeagueDashboard /></ProtectedRoute>} />
          <Route path="/league/:leagueId/matchups/:matchupId" element={<ProtectedRoute><FantasyOnly><MatchupDetail /></FantasyOnly></ProtectedRoute>} />
          <Route path="/league/:leagueId/game-center" element={<ProtectedRoute><FantasyOnly><GameCenter /></FantasyOnly></ProtectedRoute>} />
          <Route path="/league/:leagueId/draft" element={<ProtectedRoute><FantasyOnly><DraftBoard /></FantasyOnly></ProtectedRoute>} />
          <Route path="/league/:leagueId/draft-settings" element={<ProtectedRoute><FantasyOnly><DraftSettings /></FantasyOnly></ProtectedRoute>} />
          <Route path="/league/:leagueId/rules" element={<ProtectedRoute><LeagueRules /></ProtectedRoute>} />
          <Route path="/league/:leagueId/pickem" element={<ProtectedRoute><LeaguePickem /></ProtectedRoute>} />
          <Route path="/league/:leagueId/lineup" element={<ProtectedRoute><FantasyOnly><LineupScreen /></FantasyOnly></ProtectedRoute>} />
          <Route path="/league/:leagueId/waivers" element={<ProtectedRoute><FantasyOnly><WaiverWire /></FantasyOnly></ProtectedRoute>} />
          <Route path="/league/:leagueId/trades" element={<ProtectedRoute><FantasyOnly><TradeCenter /></FantasyOnly></ProtectedRoute>} />
          <Route path="/league/:leagueId/activity" element={<ProtectedRoute><TransactionLog /></ProtectedRoute>} />
          <Route path="/league/:leagueId/power-rankings" element={<ProtectedRoute><FantasyOnly><PowerRankings /></FantasyOnly></ProtectedRoute>} />
          <Route path="/league/:leagueId/history" element={<ProtectedRoute><LeagueHistory /></ProtectedRoute>} />
          <Route path="/draft-sim" element={<ProtectedRoute><DraftSimScreen /></ProtectedRoute>} />
          <Route path="/settings/notifications" element={<ProtectedRoute><NotificationPrefs /></ProtectedRoute>} />
          <Route path="/players/:playerId" element={<ProtectedRoute><AuthenticatedPlayerProfilePage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          {/* Visiting localhost:3000 will redirect to localhost:3000/home */}
          <Route path="/" element={<Navigate to="/home" replace />} />

          {/* Visiting localhost:3000/about will show the about page. */}
          <Route
            // shows AboutPage at all times (logged in or not)
            path="/about"
            element={<AboutPage />}
          />

          {/* For protected routes, the view could show one of several things on the same route.
            Visiting localhost:3000/user will show the UserPage if the user is logged in.
            If the user is not logged in, the ProtectedRoute will show the LoginPage (component).
            Even though it seems like they are different pages, the user is always on localhost:3000/user */}
          <Route
            // logged in shows UserPage else shows LoginPage
            path="/user"
            element={<ProtectedRoute><UserPage /></ProtectedRoute>}
          />

          <Route
            // logged in shows InfoPage else shows LoginPage
            path="/info"
            element={<ProtectedRoute><InfoPage /></ProtectedRoute>}
          />

          <Route
            path="/login"
            element={
              user.id ?
                // If the user is already logged in,
                // redirect to the /user page
                <Navigate to="/user" replace />
                :
                // Otherwise, show the login page
                <LoginPage />
            }
          />

          <Route
            path="/registration"
            element={
              user.id ?
                // If the user is already logged in,
                // redirect them to the /user page
                <Navigate to="/user" replace />
                :
                // Otherwise, show the registration page
                <RegisterPage />
            }
          />

          <Route
            path="/home"
            element={
              user.id ?
                // If the user is already logged in,
                // redirect them to the /user page
                <Navigate to="/user" replace />
                :
                // Otherwise, show the Landing page
                <LandingPage />
            }
          />

          {/* If none of the other routes matched, we will show a 404. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </AppLayout>
      </NavigationGuard>
    </Router>
    </SnackbarProvider>
    </AppThemeProvider>
  );
}

export default App;
