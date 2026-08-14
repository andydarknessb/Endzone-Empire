/**
 * The worker's code identity, observable. Before this column the worker had
 * no independently checkable release SHA at all - no HTTP surface, nothing in
 * the tables it writes - so "the worker is still running old code" was
 * invisible until a capture had already committed under the wrong protocol.
 * The heartbeat now carries the release, and /api/health/worker reports it.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('worker_heartbeats', (table) => {
    table.string('release_sha', 64);
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('worker_heartbeats', (table) => {
    table.dropColumn('release_sha');
  });
};
