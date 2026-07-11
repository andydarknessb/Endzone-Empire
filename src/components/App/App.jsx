import React, { useEffect } from 'react';
import {
  HashRouter as Router,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';

import { useDispatch, useSelector } from 'react-redux';

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
import TeamManagement from '../TeamManagement/TeamManagement';
import PlayerManagement from '../PlayerManagement/PlayerManagement';
import LeagueDashboard from '../LeagueDashboard/LeagueDashboard';
import MatchupScreen from '../MatchupScreen/MatchupScreen';
import DraftBoard from '../DraftBoard/DraftBoard';
import LineupScreen from '../LineupScreen/LineupScreen';
import WaiverWire from '../WaiverWire/WaiverWire';
import TradeCenter from '../TradeCenter/TradeCenter';
import TransactionLog from '../TransactionLog/TransactionLog';
import PlayerDetail from '../PlayerDetail/PlayerDetail';


import './App.css';

function App() {
  const dispatch = useDispatch();

  const user = useSelector(store => store.user);

  useEffect(() => {
    dispatch({ type: 'FETCH_USER' });
  }, [dispatch]);

  return (
    <Router>
      <div>
        <Nav />
        <Routes>
          <Route path="/league" element={<ProtectedRoute><LeagueManagement /></ProtectedRoute>} />
          <Route path="/team" element={<ProtectedRoute><TeamManagement /></ProtectedRoute>} />
          <Route path="/player" element={<ProtectedRoute><PlayerManagement /></ProtectedRoute>} />
          <Route path="/league/:leagueId" element={<ProtectedRoute><LeagueDashboard /></ProtectedRoute>} />
          <Route path="/league/:leagueId/matchups" element={<ProtectedRoute><MatchupScreen /></ProtectedRoute>} />
          <Route path="/league/:leagueId/draft" element={<ProtectedRoute><DraftBoard /></ProtectedRoute>} />
          <Route path="/league/:leagueId/lineup" element={<ProtectedRoute><LineupScreen /></ProtectedRoute>} />
          <Route path="/league/:leagueId/waivers" element={<ProtectedRoute><WaiverWire /></ProtectedRoute>} />
          <Route path="/league/:leagueId/trades" element={<ProtectedRoute><TradeCenter /></ProtectedRoute>} />
          <Route path="/league/:leagueId/activity" element={<ProtectedRoute><TransactionLog /></ProtectedRoute>} />
          <Route path="/players/:playerId" element={<ProtectedRoute><PlayerDetail /></ProtectedRoute>} />
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
          <Route path="*" element={<h1>404</h1>} />
        </Routes>
        <Footer />
      </div>
    </Router>
  );
}

export default App;
