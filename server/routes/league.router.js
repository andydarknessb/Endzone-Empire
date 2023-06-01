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

// This route adds a new league
router.post('/', (req, res) => {
    const newLeague = req.body;
    const queryText = `INSERT INTO "league" ("name", "owner_id")
                       VALUES ($1, $2)`;
    pool.query(queryText, [newLeague.name, req.user.id])
      .then(() => {
        res.sendStatus(201);
      })
      .catch((error) => {
        console.log('Error on POST league query', error);
        res.sendStatus(500);
      });
  });