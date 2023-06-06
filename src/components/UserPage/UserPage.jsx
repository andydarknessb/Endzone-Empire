import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, InputLabel,Snackbar} from '@material-ui/core';
import Alert from '@material-ui/lab/Alert';
import './UserPage.css';


function UserPage() {
  const dispatch = useDispatch();
  const user = useSelector((store) => store.user);
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [openJoinDialog, setOpenJoinDialog] = useState(false);
  const [leagueName, setLeagueName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [openCreateTeamDialog, setOpenCreateTeamDialog] = useState(false);
  const [teamNumber, setTeamNumber] = useState(2);
  const [numTeams, setNumTeams] = useState(2);
  const [availableLeagues, setAvailableLeagues] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedLeague, setSelectedLeague] = useState('');
  const [availableTeams, setAvailableTeams] = useState([]);
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");


  
  useEffect(() => {
    // Fetch user's leagues
    dispatch({ type: 'FETCH_USER_LEAGUES', payload: user.id });
  }, [dispatch, user.id]);

  // List of user's leagues
  const leagues = useSelector((store) => store.leagues);

  // Functions to handle create dialog
  const handleOpenCreateDialog = () => {
    setOpenCreateDialog(true);
  };

  const handleCloseCreateDialog = () => {
    setOpenCreateDialog(false);
  };

  const handleCreateLeague = () => {
    console.log('numTeams:', numTeams);
    fetch('/api/league/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },

      body: JSON.stringify({
        name: leagueName,
        team: teamName,
        numTeams: numTeams, 
        userId: user.id,
      }),
       
    })
    .then((response) => {
      if (!response.ok) throw new Error(response.status);
      else return response.json();
    })
    .then(() => {
      handleCloseCreateDialog();
      // Fetch user's leagues again

      setSnackbarMessage("League successfully created!");
      setOpenSnackbar(true);

      dispatch({ type: 'FETCH_USER_LEAGUES', payload: user.id });
    })
    .catch((error) => {
      setSnackbarMessage(`Error creating league: ${error.message}`);
      setOpenSnackbar(true);
    });
  };

  // Functions to handle join dialog
  const handleOpenJoinDialog = () => {
    fetch('/api/league/available')
      .then(response => {
        if (!response.ok) throw new Error(`Error: ${response.statusText}`);
        return response.json();
      })
      .then(data => {
        console.log(data);
        setAvailableLeagues(data);
        setOpenJoinDialog(true);
      })
      .catch(error => {
        console.error('Error fetching available leagues:', error);
    });
  };

  const handleCloseJoinDialog = () => {
    setOpenJoinDialog(false);
  };

  const handleJoinLeague = () => {
    fetch(`/api/league/${selectedLeague}/teams`)
      .then(response => response.json())
      .then(data => {
        const teamExists = data.some(team => team.id === selectedTeam);
        if (!teamExists) {
          throw new Error('Team does not exist in this league');
        }
  
        return fetch(`/api/league/join/${selectedLeague}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            teamId: selectedTeam,
          }),
        });
      })
      .then((response) => {
        if (!response.ok) throw new Error(response.status);
        else return response.json();
      })
      .then(() => {
        handleCloseJoinDialog(); // This will close the dialog box after successfully joining the league
        setSnackbarMessage("Successfully joined the league!");
        setOpenSnackbar(true);
        dispatch({ type: 'FETCH_USER_LEAGUES', payload: user.id });
      })
      .catch((error) => {
        setSnackbarMessage(`Error joining league: ${error.message}`);
        setOpenSnackbar(true);
      });
  };
  
  

  // Functions to handle create team dialog
const handleOpenCreateTeamDialog = () => {
  setOpenCreateTeamDialog(true);
};

const handleCloseCreateTeamDialog = () => {
  setOpenCreateTeamDialog(false);
};

const handleCreateTeam = () => {
  fetch('/api/teamName/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: teamName,
      // Add more data here as necessary
    }),  
  })
  .then((response) => {
    if (!response.ok) throw new Error(response.status);
    else return response.json();
  })
  .then(() => {
    handleCloseCreateTeamDialog();
    setSnackbarMessage("Team successfully created!");
    setOpenSnackbar(true);
    dispatch({ type: 'FETCH_USER_LEAGUES', payload: user.id });
  })
  .catch((error) => {
    setSnackbarMessage(`Error creating team: ${error.message}`);
    setOpenSnackbar(true);
  });

};

const handleTeamSelection = (event) => {
  setSelectedTeam(event.target.value);
};

const handleOpenSnackbar = () => {
  setOpenSnackbar(true);
};

const handleCloseSnackbar = (event, reason) => {
  if (reason === 'clickaway') {
    return;
  }

  setOpenSnackbar(false);
};
  return (
    <div className="user-page">
    <div className="container">
    <div className="btn">
    <div className="user-page">
    <div className="RegisterForm">
      <Typography variant="h4" className="title">Endzone Empire</Typography>
      <Typography variant="h6" className="welcomeText">Welcome, {user.username}!</Typography>
     
      <div className="leagueContainer">
        {leagues && leagues.map((league) => (
          <div key={league.id} className="leagueItem">
            <Typography variant="body1">{league.name}</Typography>
            <Typography variant="body2">{league.description}</Typography>
          </div>
        ))}
      </div>
      <div className="buttonContainer">
        <Button variant="contained" color="primary" onClick={handleOpenCreateDialog}>
          Create League
        </Button>
      
      </div>
      <Dialog open={openCreateDialog} onClose={handleCloseCreateDialog} className="dialogContainer">
        <DialogTitle className="dialogTitle">Create a New League</DialogTitle>
        <DialogContent>
          <TextField className="dialogTextField" autoFocus margin="dense" label="League Name" fullWidth onChange={(event) => setLeagueName(event.target.value)} />
          <TextField className="dialogTextField" margin="dense" label="Team Name" fullWidth onChange={(event) => setTeamName(event.target.value)} />
          <InputLabel id="numTeams-label"></InputLabel>
          <div style={{display: 'flex', alignItems: 'center', marginTop: '1em'}}>
          <Typography variant="body1" style={{marginRight: '1em', color: '#000', fontWeight: 'bold', fontSize: '1.2em'}}>Teams:</Typography>
        <Select
            value={numTeams}
            onChange={(event) => setNumTeams(event.target.value)}
            style={{minWidth: 120}}
        >
            {Array.from({length: 19}, (_, i) => i+2).map((number) => (
            <MenuItem key={number} value={number}>{number}</MenuItem>
            ))}
        </Select>
      </div>
          </DialogContent>
          <DialogActions>
          <Button onClick={handleCloseCreateDialog} color="primary">
           Cancel
          </Button>
          <Button onClick={handleCreateLeague} color="primary">
           Create
          </Button>
          </DialogActions>
          </Dialog>
      <Dialog open={openJoinDialog} onClose={handleCloseJoinDialog} className="dialogContainer">
        <DialogTitle className="dialogTitle">Join an Existing League</DialogTitle>
        <DialogContent>
        <InputLabel id="league-select-label">League</InputLabel>
        <Select
        labelId="league-select-label"
        value={selectedLeague}
        onChange={(event) => setSelectedLeague(event.target.value)}
  >
        {availableLeagues.map((league) => (
        <MenuItem key={league.id} value={league.id}>
        {league.name}
        </MenuItem>
        ))}
        </Select>
  
        </DialogContent>
                <DialogActions>
                  <Button onClick={handleCloseJoinDialog} color="primary">
                    Cancel
                  </Button>
                  <Button onClick={handleJoinLeague} color="primary">
                    Join
                  </Button>
                </DialogActions>
              </Dialog>
      <Dialog open={openCreateTeamDialog} onClose={handleCloseCreateTeamDialog} className="dialogContainer">
      <DialogTitle className="dialogTitle">Create a New Team</DialogTitle>
      <DialogContent>
      <TextField className="dialogTextField" autoFocus margin="dense" label="Team Name" fullWidth onChange={(event) => setTeamName(event.target.value)} />
      </DialogContent>
      <DialogActions>
      <Button onClick={handleCloseCreateTeamDialog} color="primary">
      Cancel
    </Button>
    <Button onClick={handleCreateTeam} color="primary">
                  Create
                </Button>
              </DialogActions>
            </Dialog>
          </div>
        </div>
      </div>
    </div>
    <Snackbar 
      open={openSnackbar} 
      autoHideDuration={6000} 
      onClose={handleCloseSnackbar}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <Alert onClose={handleCloseSnackbar} severity="success" sx={{ width: '100%' }}>
        {snackbarMessage}
      </Alert>
    </Snackbar>
  </div>
  );
}

export default UserPage;
