import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button } from '@material-ui/core';
import Pagination from '@material-ui/lab/Pagination';
import { makeStyles } from '@material-ui/core/styles';

const useStyles = makeStyles((theme) => ({
  table: {
    minWidth: 650,
    margin: '0 auto', // centers the table horizontally
  },
  select: {
    margin: theme.spacing(1),
    minWidth: 120,
    backgroundColor: '#f4a261', // sandy brown
    color: theme.palette.text.primary,
  },
  tableContainer: {
    borderRadius: 15,
    margin: '10px 10px',
    maxWidth: 900,
    backgroundColor: '#e0e0e0', // green color
  },
  tableHeaderCell: {
    fontWeight: 'bold',
    backgroundColor: '#ff9100', // orange color
    color: theme.palette.getContrastText('#e76f51'),
  },
  name: {
    fontWeight: 'bold',
    color: '#264653', // dark blue color
  },
  position: {
    fontStyle: 'italic',
  },
  button: {
    backgroundColor: '#ff9100', // orange color
    color: theme.palette.text.primary,
    '&:hover': {
      backgroundColor: '#e76f51', // darkens the color a bit
    },
  },
  rosterTableContainer: {
    borderRadius: 15,
    margin: '10px 10px',
    maxWidth: 900,
    backgroundColor: '#e0e0e0',
    marginTop: 30,
  },
  parentContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center', // vertically center the select and pagination
    flexDirection: 'column', // align elements vertically
  },
  filtersContainer: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 10,
  },
  pagination: {
    marginTop: 10,
  },
}));

function PlayerManagement() {
  const [players, setPlayers] = useState([]);
  const [positionFilter, setPositionFilter] = useState('All');
  const [pageNumber, setPageNumber] = useState(1);
  const classes = useStyles();
  const [roster, setRoster] = useState([]);

  useEffect(() => {
    fetchPlayers();
    fetchRoster();
  }, [positionFilter, pageNumber]);

  const fetchPlayers = async () => {
    try {
      const response = await axios.get(`/api/players?page=${pageNumber}&position=${positionFilter}`);
      console.log(response.data);
      setPlayers(response.data);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchRoster = async () => {
    try {
      const response = await axios.get('/api/team/roster'); // Update to use your server route
      console.log(response.data);
      setRoster(response.data);
    } catch (error) {
      console.error(error);
    }
  };

  const addToRoster = (player) => {
    const updatedRoster = [...roster, player];
    setRoster(updatedRoster);
  };
  


  const removeFromRoster = async (playerId) => {
    try {
      await axios.delete(`/api/team/roster/${playerId}`); // Update to use your server route
      console.log(`Removed player ${playerId} from roster.`);
      fetchRoster(); // Refresh roster after removing player
    } catch (error) {
      console.error(`Error removing player from roster: ${error}`);
    }
  };

  const isPlayerInRoster = (playerId) => {
    return roster.some((player) => player.id === playerId);
  };

  const positionLimits = {
    'QB': 1,
    'RB': 2,
    'WR': 2,
    'TE': 1,
    'K': 1,
    'DST': 1
  };

  return (
    <div className={classes.parentContainer}>
      <div className={classes.filtersContainer}>
        <select className={classes.select} onChange={(e) => setPositionFilter(e.target.value)}>
          <option>All</option>
          <option>QB</option>
          <option>RB</option>
          <option>WR</option>
          <option>TE</option>
          <option>K</option>
          <option>DST</option>
          {/* Add all positions here */}
        </select>
        <Pagination
          className={classes.pagination}
          count={10}
          page={pageNumber}
          onChange={(event, value) => setPageNumber(value)}
        />
      </div>
      <TableContainer component={Paper} className={classes.tableContainer}>
        <Table className={classes.table}>
          <TableHead>
            <TableRow>
              <TableCell className={classes.tableHeaderCell}>Name</TableCell>
              <TableCell className={classes.tableHeaderCell} align="right">Position</TableCell>
              <TableCell className={classes.tableHeaderCell} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {players.map((player) => (
              <TableRow key={player.id}>
                <TableCell component="th" scope="row" className={classes.name}>{player.name}</TableCell>
                <TableCell align="right" className={classes.position}>{player.position}</TableCell>
                <TableCell align="right">
                  <Button
                    className={classes.button}
                    onClick={() => addToRoster(player)}
                    disabled={isPlayerInRoster(player.id)}
                  >
                    {isPlayerInRoster(player.id) ? 'Added' : 'Add to Roster'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TableContainer component={Paper} className={classes.rosterTableContainer}>
        <Table className={classes.table}>
          <TableHead>
            <TableRow>
              <TableCell className={classes.tableHeaderCell}>Name</TableCell>
              <TableCell className={classes.tableHeaderCell} align="right">Position</TableCell>
              <TableCell className={classes.tableHeaderCell} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roster.map((player) => (
              <TableRow key={player.id}>
                <TableCell component="th" scope="row" className={classes.name}>{player.name}</TableCell>
                <TableCell align="right" className={classes.position}>{player.position}</TableCell>
                <TableCell align="right">
                  <Button className={classes.button} onClick={() => removeFromRoster(player.id)}>Remove</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
  
  }
  export default PlayerManagement;
  