const express = require('express');
const pool = require('../modules/pool');
const router = express.Router();

// Define scoring rules
const scoringRules = {
    passingYards: 0.04,   // 1 point per 25 yards
    rushingYards: 0.1,    // 1 point per 10 yards
    receivingYards: 0.1,  // 1 point per 10 yards
    passingTDs: 4,
    rushingTDs: 6,
    receivingTDs: 6,
    fumbles: -2,
    interceptions: -2,   // Thrown interceptions
    passingTwoPt: 2,     // 2pt conversion (pass)
    rushingTwoPt: 2,     // 2pt conversion (rush)
    receivingTwoPt: 2,   // 2pt conversion (receive)
    sack: 1,             // For defensive players
    interceptionReturn: 2, // For defensive players
    fumbleRecovery: 2,   // For defensive players
    defensiveTD: 6,      // For defensive players
    fieldGoal: 3,        // For kickers, might vary depending on distance
    extraPoint: 1,       // For kickers
  };
  

// Route to calculate player scores for a particular game
router.post('/calculate_scores', async (req, res) => {
  try {
    // Retrieve all teams
    const teamsQuery = 'SELECT * FROM teams';
    const teamsResult = await pool.query(teamsQuery);
    const teams = teamsResult.rows;

    // Calculate and update score for each team
    for (const team of teams) {
      const teamScoreQuery = `
        SELECT SUM(score) as total_score FROM player_stats
        JOIN players_teams ON players_teams.player_id = player_stats.player_id
        WHERE players_teams.team_id = $1
      `;
      const teamScoreResult = await pool.query(teamScoreQuery, [team.id]);
      const teamScore = teamScoreResult.rows[0].total_score || 0;

      const updateTeamScoreQuery = 'UPDATE teams SET score = $1 WHERE id = $2';
      await pool.query(updateTeamScoreQuery, [teamScore, team.id]);
    }

    // Send success status
    res.sendStatus(200);
  } catch (error) {
    console.error('Error calculating team scores:', error);
    res.sendStatus(500);
  }
});

// Route to get team rankings
router.get('/rankings', async (req, res) => {
  try {
    const rankingsQuery = 'SELECT * FROM teams ORDER BY score DESC';
    const rankingsResult = await pool.query(rankingsQuery);
    res.send(rankingsResult.rows);
  } catch (error) {
    console.error('Error getting team rankings:', error);
    res.sendStatus(500);
  }
});

// Function to calculate a player's score based on their stats
function calculateScore(stats) {
  let score = 0;
  for (const [stat, value] of Object.entries(stats)) {
    const pointsPerStat = scoringRules[stat];
    if (pointsPerStat !== undefined) {
      score += value * pointsPerStat;
    }
  }
  return score;
}

module.exports = router;
