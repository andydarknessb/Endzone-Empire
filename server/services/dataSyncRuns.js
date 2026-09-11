/**
 * One-release re-export (#1200, ADR 0036, #1197 R5). `recordDataSyncRun`'s
 * implementation moved to `server/modules/syncRun.js`, the module that now
 * owns the shape of a Sync run and is the ONE writer of `data_sync_runs`
 * (`runSyncJob` calls it directly; this re-export exists only for the two
 * callers that don't go through `runSyncJob` yet: `adp.service.js`'s
 * `recordAdpRun` and `modules/liveBox.js`'s source-switch signal).
 *
 * This file stays a thin re-export for one release so neither caller's
 * require path needs to change in this ticket; #1201 (the ADP job's own move
 * onto the module) removes it once nothing requires this path anymore.
 */
const { recordDataSyncRun } = require('../modules/syncRun');

module.exports = { recordDataSyncRun };
