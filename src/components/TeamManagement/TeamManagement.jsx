import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Typography, makeStyles, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@material-ui/core';

const useStyles = makeStyles({
  table: {
    minWidth: 650,
  },
});

function TeamManagement() {
  const classes = useStyles();
  const [roster, setRoster] = useState([]);

  useEffect(() => {
    fetchRoster();
  }, []);

  const fetchRoster = async () => {
    const response = await axios.get('/api/league/team/roster');  // Update to use your server route
    setRoster(response.data);
  }

  return (
    <div className={classes.root}>
      <Typography variant="h4">Team Management</Typography>
      <TableContainer component={Paper}>
        <Table className={classes.table}>
          <TableHead>
            <TableRow>
              <TableCell>POS</TableCell>
              <TableCell align="right">Offense</TableCell>
              <TableCell align="right">Opp</TableCell>
              <TableCell align="right">Status</TableCell>
              <TableCell align="right">Passing</TableCell>
              <TableCell align="right">Rushing</TableCell>
              <TableCell align="right">Receiving</TableCell>
              <TableCell align="right">Fantasy Points</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roster.map((player) => (
              <TableRow key={player.id}>
                <TableCell component="th" scope="row">{player.position}</TableCell>
                <TableCell align="right">{player.offense}</TableCell>
                <TableCell align="right">{player.opposition}</TableCell>
                <TableCell align="right">{player.status}</TableCell>
                <TableCell align="right">{player.passing}</TableCell>
                <TableCell align="right">{player.rushing}</TableCell>
                <TableCell align="right">{player.receiving}</TableCell>
                <TableCell align="right">{player.fantasyPoints}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

export default TeamManagement;
