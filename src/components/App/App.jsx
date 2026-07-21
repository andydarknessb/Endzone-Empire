import React, { useEffect } from 'react';
import {
  HashRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import { useDispatch, useSelector } from 'react-redux';
import Box from '@mui/material/Box';

import Nav from '../Nav/Nav';
import Footer from '../Footer/Footer';

import ProtectedRoute from '../ProtectedRoute/ProtectedRoute';

import AboutPage from '../AboutPage/AboutPage';
import UserPage from '../UserPage/UserPage';
import InfoPage from '../InfoPage/InfoPage';
import LandingPage from '../LandingPage/LandingPage';
import LoginPage from '../LoginPage/LoginPage';
import RegisterPage from '../RegisterPage/RegisterPage';

import LeagueManagement from '../LeagueManagement/LeagueManagement';
import LeagueDiscovery from '../LeagueDiscovery/LeagueDiscovery';
import TeamManagement from '../TeamManagement/TeamManagement';
import PlayerManagement from '../PlayerManagement/PlayerManagement';
import LeagueDashboard from '../LeagueDashboard/LeagueDashboard';
import MatchupScreen from '../MatchupScreen/MatchupScreen';
import MatchupDetail from '../MatchupDetail/MatchupDetail';
import GameCenter from '../GameCenter/GameCenter';
import DraftBoard from '../DraftBoard/DraftBoard';
import DraftSettings from '../DraftSettings/DraftSettings';
import DraftPresenter from '../DraftPresenter/DraftPresenter';
import LineupScreen from '../LineupScreen/LineupScreen';
import WaiverWire from '../WaiverWire/WaiverWire';
import TradeCenter from '../TradeCenter/TradeCenter';
import TransactionLog from '../TransactionLog/TransactionLog';
import PowerRankings from '../PowerRankings/PowerRankings';
import LeagueHistory from '../LeagueHistory/LeagueHistory';
import NotificationPrefs from '../NotificationPrefs/NotificationPrefs';
import PlayerDetail from '../PlayerDetail/PlayerDetail';
import AdminDashboard from '../AdminDashboard/AdminDashboard';
import ForgotPassword from '../ForgotPassword/ForgotPassword';
import ResetPassword from '../ResetPassword/ResetPassword';
import VerifyEmail from '../VerifyEmail/VerifyEmail';
import AppThemeProvider from '../../theme/AppThemeProvider';
import OfflineBanner from '../OfflineBanner/OfflineBanner';
import NotFound from '../NotFound/NotFound';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import NavigationGuard from '../NavigationGuard/NavigationGuard';


import './App.css';

function AppLayout({ children }) {
  const { pathname } = useLocation();
  const isPresenter = pathname.startsWith('/present/');

  return (
    <Box sx={isPresenter ? { minHeight: '100vh' } : { display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
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
        <Routes>
          <Route path="/present/:token" element={<DraftPresenter />} />
          <Route path="/league" element={<ProtectedRoute><LeagueManagement /></ProtectedRoute>} />
          <Route path="/league/join" element={<ProtectedRoute><LeagueManagement /></ProtectedRoute>} />
          <Route path="/discover" element={<ProtectedRoute><LeagueDiscovery /></ProtectedRoute>} />
          <Route path="/team" element={<ProtectedRoute><TeamManagement /></ProtectedRoute>} />
          <Route path="/player" element={<ProtectedRoute><PlayerManagement /></ProtectedRoute>} />
          <Route path="/league/:leagueId" element={<ProtectedRoute><LeagueDashboard /></ProtectedRoute>} />
          <Route path="/league/:leagueId/matchups" element={<ProtectedRoute><MatchupScreen /></ProtectedRoute>} />
          <Route path="/league/:leagueId/matchups/:matchupId" element={<ProtectedRoute><MatchupDetail /></ProtectedRoute>} />
          <Route path="/league/:leagueId/game-center" element={<ProtectedRoute><GameCenter /></ProtectedRoute>} />
          <Route path="/league/:leagueId/draft" element={<ProtectedRoute><DraftBoard /></ProtectedRoute>} />
          <Route path="/league/:leagueId/draft-settings" element={<ProtectedRoute><DraftSettings /></ProtectedRoute>} />
          <Route path="/league/:leagueId/lineup" element={<ProtectedRoute><LineupScreen /></ProtectedRoute>} />
          <Route path="/league/:leagueId/waivers" element={<ProtectedRoute><WaiverWire /></ProtectedRoute>} />
          <Route path="/league/:leagueId/trades" element={<ProtectedRoute><TradeCenter /></ProtectedRoute>} />
          <Route path="/league/:leagueId/activity" element={<ProtectedRoute><TransactionLog /></ProtectedRoute>} />
          <Route path="/league/:leagueId/power-rankings" element={<ProtectedRoute><PowerRankings /></ProtectedRoute>} />
          <Route path="/league/:leagueId/history" element={<ProtectedRoute><LeagueHistory /></ProtectedRoute>} />
          <Route path="/settings/notifications" element={<ProtectedRoute><NotificationPrefs /></ProtectedRoute>} />
          <Route path="/players/:playerId" element={<ProtectedRoute><PlayerDetail /></ProtectedRoute>} />
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
      </AppLayout>
      </NavigationGuard>
    </Router>
    </SnackbarProvider>
    </AppThemeProvider>
  );
}

export default App;
