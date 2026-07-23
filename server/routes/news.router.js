const express = require('express');
const { requireAuth } = require('../modules/auth');
const { getLatestNews } = require('../services/news.service');

const router = express.Router();
router.use(requireAuth);

// GET /api/news — latest fantasy-relevant NFL headlines, server-side so the
// RapidAPI key never reaches the browser.
router.get('/', async (req, res) => {
  try {
    const news = await getLatestNews();
    res.json(news);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching NFL news', error);
    res.status(500).json({ error: 'failed to fetch NFL news' });
  }
});

module.exports = router;
