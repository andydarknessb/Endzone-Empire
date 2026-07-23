const RECAPS_SCHEMA = 'private';
const RECAPS_TABLE_NAME = 'game_recaps';
const RECAPS_TABLE = `${RECAPS_SCHEMA}.${RECAPS_TABLE_NAME}`;
const RECAPS_TABLE_SQL = `"${RECAPS_SCHEMA}"."${RECAPS_TABLE_NAME}"`;

const DATA_VERSION = 1;
const GENERATOR_VERSION = '1.0.0';

const MISSING_STORAGE_CODES = new Set([
  '42P01', // undefined_table: schema exists, table does not
  '3F000', // invalid_schema_name: private schema is not migrated yet
]);

function isMissingRecapStorage(error) {
  return Boolean(error && MISSING_STORAGE_CODES.has(error.code));
}

module.exports = {
  RECAPS_SCHEMA,
  RECAPS_TABLE_NAME,
  RECAPS_TABLE,
  RECAPS_TABLE_SQL,
  DATA_VERSION,
  GENERATOR_VERSION,
  isMissingRecapStorage,
};
