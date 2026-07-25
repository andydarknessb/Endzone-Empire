const { tank01Body } = require('./scoring.service');
const { tank01Get } = require('../modules/tank01Client');

const MAX_ITEMS = 6;

// Trim Tank01's getNFLNews payload down to what the dashboard widget needs,
// in case the upstream shape grows extra fields later.
function normalizeNewsItems(items) {
  return (items || []).slice(0, MAX_ITEMS).map((item) => ({ title: item.title, link: item.link }));
}

/**
 * Fantasy-relevant NFL headlines from Tank01 (same RapidAPI subscription
 * already used for live scoring — no separate key).
 */
async function getLatestNews() {
  // 'low' priority — headlines are the first thing shed when quota gets tight
  // (see modules/tank01Client), which is why the cache below serves stale.
  const response = await tank01Get('/getNFLNews', {
    params: { fantasyNews: true, maxItems: MAX_ITEMS },
    priority: 'low',
  });
  return normalizeNewsItems(tank01Body(response.data));
}

module.exports = { getLatestNews, normalizeNewsItems, MAX_ITEMS };
