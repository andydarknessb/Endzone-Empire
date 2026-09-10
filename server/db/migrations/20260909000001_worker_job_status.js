/**
 * Persist worker-owned job snapshots so the API process can publish truthful
 * health data when jobs run in a separate Render worker.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('worker_heartbeats', (table) => {
    table.jsonb('job_status');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('worker_heartbeats', (table) => {
    table.dropColumn('job_status');
  });
};
