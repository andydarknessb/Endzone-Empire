const express = require('express');
const axios = require('axios');
const pool = require('../modules/pool');
const router = express.Router();

router.get('/players', async (req, res) => {
  try {
    const response = await axios({
      method: 'GET',
      url: 'https://api-american-football.p.rapidapi.com/players',
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

router.post('/:playerId', async (req, res) => {
  const playerId = req.params.playerId;
  const queryText = `INSERT INTO team_players (player_id, team_id) VALUES ($1, $2);`;

  try {
    await pool.query(queryText, [playerId, req.user.team_id]);
    res.sendStatus(200);
  } catch (error) {
    console.error('Error drafting player', error);
    res.sendStatus(500);
  }
});

module.exports = router;
