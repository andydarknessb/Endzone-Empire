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