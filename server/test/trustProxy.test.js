const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

// server.js reads NODE_ENV while it loads, and each test file runs in its own process.
process.env.NODE_ENV = 'production';
// Loading the pool in production needs a CA for any remote URL a local .env might supply.
process.env.DATABASE_URL_RUNTIME = 'postgres://localhost/unused';
const { app } = require('../server');

const probe = express();
probe.set('trust proxy', app.get('trust proxy'));
probe.get('/', (req, res) => res.json({ ip: req.ip }));

test('req.ip is the visitor behind Cloudflare and Render, not the Cloudflare server', async () => {
  const res = await request(probe).get('/').set('X-Forwarded-For', '203.0.113.9, 104.16.0.1');
  assert.equal(res.body.ip, '203.0.113.9');
});

test('a forged X-Forwarded-For entry cannot stand in for the visitor', async () => {
  const res = await request(probe).get('/').set('X-Forwarded-For', '198.51.100.7, 203.0.113.9, 104.16.0.1');
  assert.equal(res.body.ip, '203.0.113.9');
});
