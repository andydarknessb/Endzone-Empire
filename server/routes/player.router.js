const express = require('express');
const pool = require('../modules/pool');
const router = express.Router();

router.get('/', async (req, res) => {
  const pageNumber = parseInt(req.query.page) || 1;
  const positionFilter = req.query.position || 'All';
  const limit = 25;  // Assume you want to return 25 records per page
  const offset = (pageNumber - 1) * limit;
  let queryText;
  let params;

  if (positionFilter === 'All') {
    queryText = `SELECT * FROM "players" ORDER BY "id" LIMIT $1 OFFSET $2`;
    params = [limit, offset];
  } else {
    queryText = `SELECT * FROM "players" WHERE "position" = $1 ORDER BY "id" LIMIT $2 OFFSET $3`;
    params = [positionFilter, limit, offset];
  }

  try {
    const result = await pool.query(queryText, params);
    res.send(result.rows);
  } catch (error) {
    console.log('Error on GET players query', error);
    res.sendStatus(500);
  }
});

router.post('/draft/:playerId', async (req, res) => {
    const playerId = req.params.playerId;
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
