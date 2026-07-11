import React from 'react';
import { Link } from 'react-router-dom';
import { IconButton, Tooltip } from '@mui/material';
import LogOutButton from '../LogOutButton/LogOutButton';
import NotificationBell from '../NotificationBell/NotificationBell';
import { useThemeMode } from '../../theme/AppThemeProvider';
import './Nav.css';
import { useSelector } from 'react-redux';

function Nav() {
  const user = useSelector((store) => store.user);
  const { mode, toggleMode } = useThemeMode();

  return (
    <div className="nav">
      <Link to="/home">
        <h2 className="nav-title">Endzone Empire</h2>
      </Link>
      <div>
        {/* If no user is logged in, show these links */}
        {!user.id && (
          // If there's no user, show login/registration links
          <Link className="navLink" to="/login">
            Login / Register
          </Link>
        )}

        {/* If a user is logged in, show these links */}
        {user.id && (
          <>
            <Link className="navLink" to="/user">
              Home
            </Link>
            
            <Link className="navLink" to="/league">
              League
            </Link>
           
            <Link className="navLink" to="/player">
              Players
            </Link>

            <Link className="navLink" to="/team">
              My Team
            </Link>

            
            <LogOutButton className="navLink" />
            <NotificationBell />
          </>
        )}

        <Tooltip title={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
          <IconButton aria-label="Toggle theme" onClick={toggleMode} size="small">
            <span role="img" aria-hidden="true">{mode === 'light' ? '🌙' : '☀️'}</span>
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

export default Nav;
