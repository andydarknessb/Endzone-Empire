const express = require('express');
const pool = require('../modules/pool');
const router = express.Router();

// This route gets all leagues
router.get('/', (req, res) => {
  const queryText = 'SELECT * FROM "leagues"';
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
    const queryText = `INSERT INTO "leagues" ("name", "owner_id") VALUES ($1, $2)`;
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
    const queryText = `UPDATE "leagues"
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
    const queryText = 'DELETE FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2';
    pool.query(queryText, [req.params.id, req.user.id])
      .then(() => {
        res.sendStatus(200);
      })
      .catch((error) => {
        console.log('Error on DELETE league query', error);
        res.sendStatus(500);
      });
  });

  router.delete('/:id/withdraw', (req, res) => {
    const queryText = 'DELETE FROM "leagueteams" WHERE "league_id" = $1 AND "user_id" = $2';
    pool.query(queryText, [req.params.id, req.user.id])
      .then(() => {
        res.sendStatus(200);
      })
      .catch((error) => {
        console.log('Error on DELETE league membership query', error);
        res.sendStatus(500);
      });
  });

  router.post('/team/create', async (req, res) => {
    const newTeam = req.body;
    const queryText = `INSERT INTO "teams" ("name", "owner_id", "league_id") VALUES ($1, $2, $3)`;
    try {
        await pool.query(queryText, [newTeam.name, req.user.id, newTeam.league_id]);
        res.sendStatus(201);
    } catch (error) {
        console.log('Error on POST team create query', error);
        res.sendStatus(500);
    }
});

router.put('/team/:id', async (req, res) => {
    const updatedTeam = req.body;
    const queryText = `UPDATE "team" SET "name" = $1 WHERE "id" = $2 AND "owner_id" = $3`;
    try {
        await pool.query(queryText, [updatedTeam.name, req.params.id, req.user.id]);
        res.sendStatus(200);
    } catch (error) {
        console.log('Error on PUT team update query', error);
        res.sendStatus(500);
    }
});

router.get('/players/search/:name', async (req, res) => {
    const playerName = req.params.name;
    const queryText = `SELECT * FROM "player" WHERE "name" LIKE $1`;
    try {
        const result = await pool.query(queryText, [`%${playerName}%`]);
        res.send(result.rows);
    } catch (error) {
        console.log('Error on GET player search query', error);
        res.sendStatus(500);
    }
});

router.post('/team/:team_id/draft/:player_id', async (req, res) => {
    const { team_id, player_id } = req.params;
    const queryText = `INSERT INTO "team_players" ("team_id", "player_id") VALUES ($1, $2)`;
    try {
        await pool.query(queryText, [team_id, player_id]);
        res.sendStatus(201);
    } catch (error) {
        console.log('Error on POST draft player query', error);
        res.sendStatus(500);
    }
});

router.get('/team/roster', async (req, res) => {
  const userId = req.user.id;
  const queryText = `SELECT * FROM "roster" WHERE "user_id" = $1`;
  try {
      const result = await pool.query(queryText, [userId]);
      res.send(result.rows);
  } catch (error) {
      console.log('Error on GET roster query', error);
      res.sendStatus(500);
  }
});

router.get('/:id/details', async (req, res) => {
  const leagueId = req.params.id;
  const queryText = `
  SELECT "leagueteams"."user_id", "username", "leagueteams"."ranking" 
  FROM "leagueteams"
  JOIN "user" ON "leagueteams"."user_id" = "user"."id"
  WHERE "league_id" = $1
  ORDER BY "ranking" DESC
  `;

  try {
      const result = await pool.query(queryText, [leagueId]);
      res.send(result.rows);
  } catch (error) {
      console.log('Error on GET league details query', error);
      res.sendStatus(500);
  }
});


  module.exports = router;