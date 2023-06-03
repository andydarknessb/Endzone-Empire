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
    // Retrieve player stats for the game
    const gameID = req.body.gameID;
    const playerStatsQuery = `
      SELECT * FROM player_stats
      WHERE game_id = $1
    `;
    const playerStatsResult = await pool.query(playerStatsQuery, [gameID]);
    const playerStats = playerStatsResult.rows;

    // Calculate player scores
    const playerScores = playerStats.map(stats => ({
      playerID: stats.player_id,
      score: calculateScore(stats),
    }));

    // Update player scores in the database
    for (const { playerID, score } of playerScores) {
      const updateScoreQuery = `
        UPDATE player_stats
        SET score = $1
        WHERE game_id = $2 AND player_id = $3
      `;
      await pool.query(updateScoreQuery, [score, gameID, playerID]);
    }

    // Send success status
    res.sendStatus(200);
  } catch (error) {
    console.error('Error calculating scores:', error);
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
