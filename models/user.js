const pool = require('../modules/pool');

const User = {
  create: async (username, password) => {
    const queryText = 'INSERT INTO "user" (username, password) VALUES ($1, $2) RETURNING id';
    const result = await pool.query(queryText, [username, password]);
    return result.rows[0];
  },
  findByUsername: async (username) => {
    const queryText = 'SELECT * FROM "user" WHERE username = $1';
    const result = await pool.query(queryText, [username]);
    return result.rows[0];
  },
  
};

module.exports = User;
