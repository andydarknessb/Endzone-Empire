const express = require('express');
const pool = require('../modules/pool');
const router = express.Router();

// This route gets leagues for a specific user
router.get('/available', async (req, res) => {
  const userId = req.user.id;
  const queryText = `
    SELECT "leagues"."id", "leagues"."name", COUNT("league_teams"."id") AS "current_members"
    FROM "leagues"
    LEFT JOIN "league_teams" ON "league_teams"."league_id" = "leagues"."id"
    WHERE "leagues"."id" NOT IN (
      SELECT "league_teams"."league_id"
      FROM "league_teams"
      WHERE "league_teams"."user_id" = $1
    )
    GROUP BY "leagues"."id"
    HAVING COUNT("league_teams"."id") < "leagues"."num_teams"
  `;
  try {
    const result = await pool.query(queryText, [userId]);
    res.send(result.rows);
  } catch (error) {
    console.log('Error on GET available leagues query', error);
    res.sendStatus(500);
  }
});


// Create a league
router.post('/create', async (req, res) => {
  const newLeague = req.body;
  const numTeams = newLeague.numTeams; 
  const userId = newLeague.userId;

  const leagueQueryText = `INSERT INTO "leagues" ("name", "owner_id", "num_teams") VALUES ($1, $2, $3) RETURNING id`;
  const teamQueryText = `INSERT INTO "teams" ("name", "owner_id", "league_id") VALUES ($1, $2, $3) RETURNING id`;
  const memberQueryText = `INSERT INTO "league_teams" ("user_id", "league_id", "team_id") VALUES ($1, $2, $3)`;

  try {
    await pool.query('BEGIN');
    const leagueResult = await pool.query(leagueQueryText, [newLeague.name, userId, numTeams]);
    if (leagueResult.rows.length === 0) {
      throw new Error('League creation failed: no rows returned');
    }
    const leagueId = leagueResult.rows[0].id;

    for (let i = 0; i < numTeams; i++) {
      const teamResult = await pool.query(teamQueryText, [`Team ${i + 1}`, userId, leagueId]);
      let teamId;
      if (teamResult.rows[0]) {
        teamId = teamResult.rows[0].id;
      } else {
        throw new Error('Team creation failed: no rows returned');
      }

      await pool.query(memberQueryText, [userId, leagueId, teamId]);
    }

    await pool.query('COMMIT');
    res.sendStatus(201);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.log('Error on POST league query', error);
    res.sendStatus(500);
  }
});


// Join a league
router.post('/join/:id', async (req, res) => {
    const leagueId = req.params.id;
    const teamId = req.body.teamId;  // New team_id to join a specific team
    const queryText = `INSERT INTO "league_teams" ("user_id", "league_id", "team_id", "role") VALUES ($1, $2, $3, 'member')`;
    try {
        await pool.query(queryText, [req.user.id, leagueId, teamId]);
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
    const queryText = 'DELETE FROM "league_teams" WHERE "league_id" = $1 AND "user_id" = $2';
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
    const queryText = `UPDATE "teams" SET "name" = $1 WHERE "id" = $2 AND "owner_id" = $3`;
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
    const queryText = `INSERT INTO "drafted_players" ("team_id", "player_id") VALUES ($1, $2)`;
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
  SELECT "league_teams"."user_id", "username", "league_teams"."ranking" 
  FROM "league_teams"
  JOIN "user" ON "league_teams"."user_id" = "user"."id"
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

router.get('/available', async (req, res) => {
  const queryText = `
    SELECT "leagues"."id", "leagues"."name", COUNT("league_members"."id") AS "current_members"
    FROM "leagues"
    LEFT JOIN "league_teams" ON "league_teams"."league_id" = "leagues"."id"
    GROUP BY "leagues"."id"
    HAVING COUNT("league_teams"."id") < "leagues"."num_teams"
  `;
  try {
    const result = await pool.query(queryText);
    res.send(result.rows);
  } catch (error) {
    console.log('Error on GET available leagues query', error);
    res.sendStatus(500);
  }
});


  module.exports = router;