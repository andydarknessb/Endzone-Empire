const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const pool = require("../modules/pool");
const { signToken } = require("../modules/auth");
const playerRouter = require("../routes/player.router");

// The Players page's read itself now lives in playersPage.service.js
// (readPlayersPage), tested directly in playersPage.service.test.js with the
// same fixtures this file used to drive through supertest (#1497, parent
// spec #1490). What's left here is the route's own job: authenticate,
// coerce query strings, call the module, map a refusal to a status, and
// pass a success straight through. Green-for-the-wrong-reason coverage for
// the module's refusal codes lives in playersPage.service.test.js.

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "player-browser-availability-route-test-secret";
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use("/api/players", playerRouter);

test("GET /api/players with no Authorization header is 401", async () => {
  const res = await request(app).get("/api/players");
  assert.equal(res.status, 401);
});

test("GET /api/players?leagueId=N for a non-member maps the module's refusal to 403", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    const text = String(sql);
    if (text.startsWith('SELECT * FROM "teams"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const token = signToken({ id: 7, username: "member" });
  const res = await request(app)
    .get("/api/players?leagueId=1")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "not a member of this league" });
});

test("GET /api/players passes a successful read's module result straight through", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "players" AS "source"')) {
      return {
        rows: [
          { id: 1, name: "Free Agent", position: "RB", nfl_team: "ATL", total_count: "1", identity_ids: [1] },
        ],
      };
    }
    if (text.includes('FROM "nfl_games"') || text.includes('FROM "player_season_stats"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const token = signToken({ id: 7, username: "member" });
  const res = await request(app)
    .get("/api/players")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.page, 1);
  assert.equal(res.body.pageSize, 25);
  assert.equal(res.body.players.length, 1);
  assert.equal(res.body.players[0].id, 1);
  assert.equal(res.body.context, null);
});
