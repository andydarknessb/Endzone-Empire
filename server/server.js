require('dotenv').config();
const http = require('http');
const express = require('express');

const authRouter = require('./routes/auth.router');
const userRouter = require('./routes/user.router');
const playerRouter = require('./routes/player.router');
const leagueRouter = require('./routes/league.router');
const teamRouter = require('./routes/team.router');
const scoringRouter = require('./routes/scoring.router');
const { attachDraftSocket } = require('./modules/draftSocket');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Routes */
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/players', playerRouter);
app.use('/api/league', leagueRouter);
app.use('/api/team', teamRouter);
app.use('/api/scoring', scoringRouter);

// Serve the built React app
app.use(express.static('build'));

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
attachDraftSocket(server);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Endzone Empire listening on port ${PORT}`);
  });
}

module.exports = { app, server };
