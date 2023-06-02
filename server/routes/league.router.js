const express = require('express');
const pool = require('../modules/pool');
const router = express.Router();

// This route gets all leagues
router.get('/', (req, res) => {
  const queryText = 'SELECT * FROM "league"';
  pool.query(queryText)
    .then((result) => {
      res.send(result.rows);
    })
    .catch((error) => {
      console.log('Error on GET leagues query', error);
      res.sendStatus(500);
    });
});

// Create a league
router.post('/create', async (req, res) => {
    const newLeague = req.body;
    const queryText = `INSERT INTO "league" ("name", "owner_id") VALUES ($1, $2)`;
    try {
        await pool.query(queryText, [newLeague.name, req.user.id]);
        res.sendStatus(201);
    } catch (error) {
        console.log('Error on POST league query', error);
        res.sendStatus(500);
    }
});

// Join a league
router.post('/join/:id', async (req, res) => {
    const leagueId = req.params.id;
    const queryText = `INSERT INTO "league_members" ("user_id", "league_id") VALUES ($1, $2)`;
    try {
        await pool.query(queryText, [req.user.id, leagueId]);
        res.sendStatus(200);
    } catch (error) {
        console.log('Error on POST join league query', error);
        res.sendStatus(500);
    }
});

  // This route updates a league's name
router.put('/:id', (req, res) => {
    const updatedLeague = req.body;
    const queryText = `UPDATE "league"
                       SET "name" = $1
                       WHERE "id" = $2 AND "owner_id" = $3`;
    pool.query(queryText, [updatedLeague.name, req.params.id, req.user.id])
      .then(() => {
        res.sendStatus(200);
      })
      .catch((error) => {
        console.log('Error on PUT league query', error);
        res.sendStatus(500);
      });
  });

  // This route deletes a league
router.delete('/:id', (req, res) => {
    const queryText = 'DELETE FROM "league" WHERE "id" = $1 AND "owner_id" = $2';
    pool.query(queryText, [req.params.id, req.user.id])
      .then(() => {
        res.sendStatus(200);
      })
      .catch((error) => {
        console.log('Error on DELETE league query', error);
        res.sendStatus(500);
      });
  });
  
  module.exports = router;