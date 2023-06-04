const express = require('express');
const router = express.Router();
const pool = require('../modules/pool'); // Your PostgreSQL pool setup
const axios = require('axios');

// Add route for getting players from third-party API
router.get('/players', async (req, res) => {
  try {
    const response = await axios({
      method: 'GET',
      url: 'https://api-american-football.p.rapidapi.com/players',
      params: {id: '1'},
      headers: {
        'X-RapidAPI-Key': process.env.RAPID_API_KEY,
        'X-RapidAPI-Host': process.env.RAPID_API_HOST,
      },
    });
    res.send(response.data);
  } catch (error) {
    console.error('Error fetching players', error);
    res.sendStatus(500);
  }
});

// Add route for drafting a player
router.post('/:playerId', async (req, res) => {
  const playerId = req.params.playerId;

  // Replace with your own logic to add player to team
  const queryText = `INSERT INTO draftedplayers (player_id, team_id) VALUES ($1, $2);`;
  try {
    await pool.query(queryText, [playerId, req.user.team_id]);
    res.sendStatus(200);
  } catch (error) {
    console.error('Error drafting player', error);
    res.sendStatus(500);
  }
});

module.exports = router;
