/**
 * One-release re-export (#1200, ADR 0036, #1197 R5). `recordDataSyncRun`'s
 * implementation moved to `server/modules/syncRun.js`, the module that now
 * owns the shape of a Sync run and is the ONE writer of `data_sync_runs`
 * (`runSyncJob` calls it directly).
 *
 * #1201 moved `adp.service.js`'s ADP job onto `runSyncJob` itself, so it no
 * longer requires this path. The one remaining caller is
 * `modules/liveBox.js`'s source-switch signal, which stays outside
 * `runSyncJob` on purpose (ADR 0035: a source switch is not a run of a feed
 * sync). This file stays a thin re-export for that caller; #1206 owns
 * removing it once nothing requires this path anymore.
 */
const { recordDataSyncRun } = require('../modules/syncRun');

module.exports = { recordDataSyncRun };
