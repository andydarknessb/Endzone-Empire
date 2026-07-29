const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCsvRecords, parseCsvHeader, collectColumns } = require('../../scripts/backtest/lib/csv');
const {
  valueCounts,
  crossTab,
  duplicateReport,
  idShapeReport,
  crosswalkReport,
  coverageReport,
  canonicalize,
  serializeReport,
  GSIS_PATTERN,
  ESPN_PATTERN,
} = require('../../scripts/backtest/lib/inspect');
const { buildSourceReport, PROJECTIONS } = require('../../scripts/backtest/inspect-sources');
const { sourceByName } = require('../../scripts/backtest/lib/sources');

// --- csv -------------------------------------------------------------------

test('parseCsvRecords handles quoting, doubled quotes, CRLF, and a trailing newline', () => {
  assert.deepEqual(parseCsvRecords('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsvRecords('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsvRecords('a,b\n"x,y",2\n'), [['a', 'b'], ['x,y', '2']]);
  assert.deepEqual(parseCsvRecords('a\n"say ""hi"""\n'), [['a'], ['say "hi"']]);
  assert.deepEqual(parseCsvRecords(''), []);
});

test('parseCsvRecords keeps a newline INSIDE a quoted field, which injuries_2024 needs', () => {
  // The pinned injuries_2024.csv carries whitespace-only placeholder fields
  // spelled as a literal newline plus four spaces inside quotes. A parser that
  // splits on newlines first silently mangles those rows.
  const text = 'gsis_id,position\n00-0036915,"\n    "\n';
  assert.deepEqual(parseCsvRecords(text), [['gsis_id', 'position'], ['00-0036915', '\n    ']]);
});

test('parseCsvRecords refuses an unterminated quoted field', () => {
  assert.throws(() => parseCsvRecords('a\n"oops\n'), /unterminated quoted field/);
});

test('parseCsvRecords is strict RFC4180: no silent "abc"def concatenation', () => {
  // A permissive parser reads this as `abcdef` and moves on. There is no such
  // form in RFC4180, so the bytes are not the CSV they claim to be.
  assert.throws(() => parseCsvRecords('a\n"abc"def\n'), /must end the field/);
  assert.throws(() => parseCsvRecords('a\n"abc"def\n'), /RFC4180 has no/);
  assert.throws(() => parseCsvRecords('a\nabc"def"\n'), /may only open a field at its start/);
  // The legal neighbours of that form all still parse.
  assert.deepEqual(parseCsvRecords('a,b\n"abc",def\n'), [['a', 'b'], ['abc', 'def']]);
  assert.deepEqual(parseCsvRecords('a\n"abc"\n'), [['a'], ['abc']]);
  assert.deepEqual(parseCsvRecords('a,b\n"abc",\n'), [['a', 'b'], ['abc', '']]);
});

test('a strict-parse failure names the line it happened on', () => {
  assert.throws(() => parseCsvRecords('a\nok\n"abc"def\n'), /line 3/);
  // Lines are counted through a newline embedded in a quoted field, so the
  // number still points at the real offending row.
  assert.throws(() => parseCsvRecords('a\n"x\ny"\n"abc"def\n'), /line 4/);
});

test('parseCsvHeader and collectColumns fail loud on a missing header or column', () => {
  assert.deepEqual(parseCsvHeader('a,b\n'), ['a', 'b']);
  assert.throws(() => parseCsvHeader(''), /no header line/);
  assert.throws(
    () => collectColumns('a,b\n1,2\n', ['a', 'zzz'], { label: 'f' }),
    /f: missing required column\(s\) zzz/
  );
});

test('collectColumns refuses a ragged record instead of guessing', () => {
  assert.throws(
    () => collectColumns('a,b,c\n1,2\n', ['a'], { label: 'f' }),
    /record 1 has 2 fields, header has 3/
  );
});

test('collectColumns projects only the requested columns', () => {
  const { rows, rowCount, header } = collectColumns('a,b,c\n1,2,3\n4,5,6\n', ['c', 'a']);
  assert.deepEqual(header, ['a', 'b', 'c']);
  assert.equal(rowCount, 2);
  assert.deepEqual(rows, [{ c: '3', a: '1' }, { c: '6', a: '4' }]);
});

// --- report builders -------------------------------------------------------

test('valueCounts sorts by VALUE, never by count, and counts blanks as empty string', () => {
  const rows = [{ s: 'b' }, { s: 'a' }, { s: 'b' }, { s: '' }, { s: null }];
  assert.deepEqual(valueCounts(rows, 's'), [
    { value: '', count: 2 },
    { value: 'a', count: 1 },
    { value: 'b', count: 2 },
  ]);
});

test('valueCounts is order-independent: a shuffled input gives identical output', () => {
  const rows = [{ s: 'x' }, { s: 'y' }, { s: 'x' }, { s: 'z' }];
  const shuffled = [rows[3], rows[1], rows[0], rows[2]];
  assert.deepEqual(valueCounts(rows, 's'), valueCounts(shuffled, 's'));
});

test('crossTab pairs two categorical columns deterministically', () => {
  const rows = [
    { status: 'ACT', d: 'A01' },
    { status: 'RES', d: 'R01' },
    { status: 'ACT', d: 'A01' },
    { status: 'ACT', d: 'R48' },
  ];
  assert.deepEqual(crossTab(rows, 'status', 'd'), [
    { status: 'ACT', d: 'A01', count: 2 },
    { status: 'ACT', d: 'R48', count: 1 },
    { status: 'RES', d: 'R01', count: 1 },
  ]);
});

test('duplicateReport counts duplicate keys and the excess rows they represent', () => {
  const rows = [
    { season: '2024', week: '15', gsis_id: 'A' },
    { season: '2024', week: '15', gsis_id: 'A' },
    { season: '2024', week: '15', gsis_id: 'B' },
    { season: '2024', week: '16', gsis_id: 'B' },
  ];
  const report = duplicateReport(rows, ['season', 'week', 'gsis_id']);
  assert.equal(report.rowCount, 4);
  assert.equal(report.distinctKeys, 3);
  assert.equal(report.duplicateKeyCount, 1);
  assert.equal(report.duplicateRowExcess, 1);
  assert.deepEqual(report.duplicateKeys, [{ key: ['2024', '15', 'A'], count: 2 }]);
});

test('idShapeReport separates blank, placeholder, well-formed, and malformed ids', () => {
  const rows = [
    { id: '00-0039924' },
    { id: '' },
    { id: '0' },
    { id: 'ABB498348' },
    { id: 'ABB498348' },
    { id: null },
  ];
  const report = idShapeReport(rows, 'id', GSIS_PATTERN, { placeholders: ['0'] });
  assert.equal(report.blank, 2);
  assert.equal(report.placeholder, 1);
  assert.equal(report.wellFormed, 1);
  assert.equal(report.malformedRowCount, 2);
  assert.equal(report.malformedDistinctCount, 1);
  assert.deepEqual(report.malformedSamples, [{ value: 'ABB498348', count: 2 }]);
});

test('ESPN_PATTERN accepts bare digits only', () => {
  assert.ok(ESPN_PATTERN.test('4241479'));
  assert.ok(!ESPN_PATTERN.test('42a'));
  assert.ok(!ESPN_PATTERN.test(''));
});

test('crosswalkReport reports the three crosswalk failure modes separately', () => {
  const rows = [
    { gsis_id: 'g1', espn_id: 'e1' },
    { gsis_id: 'g1', espn_id: 'e2' }, // one gsis, two espn
    { gsis_id: 'g2', espn_id: 'e3' },
    { gsis_id: 'g3', espn_id: 'e3' }, // two gsis, one espn
    { gsis_id: 'g4', espn_id: 'e4' },
    { gsis_id: 'g4', espn_id: 'e4' }, // duplicate pair
    { gsis_id: 'g5', espn_id: '' },
  ];
  const report = crosswalkReport(rows);
  assert.equal(report.gsisWithMultipleEspnCount, 1);
  assert.deepEqual(report.gsisWithMultipleEspn, [{ gsis_id: 'g1', espn_ids: ['e1', 'e2'] }]);
  assert.equal(report.espnWithMultipleGsisCount, 1);
  assert.deepEqual(report.espnWithMultipleGsis, [{ espn_id: 'e3', gsis_ids: ['g2', 'g3'] }]);
  assert.equal(report.duplicatePairRowCount, 1);
  assert.deepEqual(report.duplicatePairs, [{ gsis_id: 'g4', espn_id: 'e4', count: 2 }]);
  assert.equal(report.gsisOnly, 1);
  assert.equal(report.bothPresent, 6);
});

test('coverageReport separates "in the crosswalk" from "mappable to an espn id"', () => {
  const rows = [{ gsis_id: 'g1' }, { gsis_id: 'g2' }, { gsis_id: 'g3' }, { gsis_id: '' }];
  const report = coverageReport(rows, 'gsis_id', new Set(['g1', 'g2']), { mappedIds: new Set(['g1']) });
  assert.equal(report.distinctIds, 3);
  assert.equal(report.coveredByCrosswalk, 2);
  assert.deepEqual(report.missingSamples, ['g3']);
  assert.equal(report.mappableToEspn, 1);
  assert.deepEqual(report.unmappableSamples, ['g2', 'g3']);
});

// --- determinism -----------------------------------------------------------

test('canonicalize sorts keys recursively so serialization cannot depend on insertion order', () => {
  const a = { b: 1, a: { d: 2, c: [{ f: 1, e: 2 }] } };
  const b = { a: { c: [{ e: 2, f: 1 }], d: 2 }, b: 1 };
  assert.equal(serializeReport(a), serializeReport(b));
  assert.deepEqual(Object.keys(canonicalize(a)), ['a', 'b']);
  assert.ok(serializeReport(a).endsWith('\n'));
});

const ROSTER_FIXTURE = [
  'season,week,game_type,team,position,status,status_description_abbr,gsis_id,full_name',
  '2025,1,REG,LA,QB,ACT,A01,00-0000001,Alpha One',
  '2025,1,REG,WAS,RB,INA,I01,00-0000002,Beta Two',
  '2025,1,REG,WAS,DB,RES,R01,00-0000003,Gamma Three',
  '2025,2,REG,LA,QB,ACT,A01,00-0000001,Alpha One',
  '2025,2,REG,LA,WR,DEV,P01,,Nameless Four',
  '',
].join('\n');

const INJURY_FIXTURE = [
  'season,game_type,team,week,gsis_id,position,full_name,report_status,practice_status,date_modified',
  '2024,REG,LA,15,00-0000001,QB,Alpha One,Out,"\n    ",2024-12-15T14:17:06Z',
  '2024,REG,LA,15,00-0000001,QB,Alpha One,Questionable,"\n    ",2024-12-15T03:34:33Z',
  '2024,REG,WAS,2,00-0000002,WR,Beta Two,Note,Full Participation in Practice,2024-09-14T18:00:23Z',
  '2024,REG,WAS,3,00-0000003,"\n    ",Gamma Three,,Full Participation in Practice,2024-09-20T18:00:23Z',
  '',
].join('\n');

test('buildSourceReport re-runs the schema gate before it builds anything', () => {
  // Verification proves the BYTES have not drifted; it does not prove the
  // registry still asks for columns the source has.
  const withoutStatus = ROSTER_FIXTURE.split('\n').map((line) => {
    const fields = line.split(',');
    fields.splice(5, 1); // drop `status`
    return fields.join(',');
  }).join('\n');
  assert.throws(
    () => buildSourceReport(sourceByName('roster_weekly_2025'), withoutStatus),
    /schema validation failed, missing column\(s\) status/
  );
});

test('buildSourceReport is deterministic: the same bytes give byte-identical reports', () => {
  const source = sourceByName('roster_weekly_2025');
  const first = serializeReport(buildSourceReport(source, ROSTER_FIXTURE).report);
  const second = serializeReport(buildSourceReport(source, ROSTER_FIXTURE).report);
  assert.equal(first, second);
});

test('buildSourceReport on a roster fixture reports schema, categoricals, and duplicates', () => {
  const { report } = buildSourceReport(sourceByName('roster_weekly_2025'), ROSTER_FIXTURE);
  assert.equal(report.rowCount, 5);
  assert.equal(report.schema.columnCount, 9);
  assert.deepEqual(report.categorical.status.map((v) => v.value), ['ACT', 'DEV', 'INA', 'RES']);
  assert.deepEqual(
    report.categorical.statusByDescription.filter((r) => r.status === 'ACT'),
    [{ status: 'ACT', status_description_abbr: 'A01', count: 2 }]
  );
  // The blank-gsis row is the only reason a player-week key repeats, and the
  // gsis-only view proves it.
  assert.equal(report.idIntegrity.gsis.blank, 1);
  assert.equal(report.idIntegrity.playerWeekDuplicatesWithGsis.duplicateKeyCount, 0);
  assert.equal(report.columnPresence.status_description_abbr, true);
  assert.equal(report.columnPresence.espn_id, false);
});

test('buildSourceReport on an injury fixture surfaces date_modified, Note, and the duplicate player-week', () => {
  const { report } = buildSourceReport(sourceByName('injuries_2024'), INJURY_FIXTURE);
  assert.equal(report.columnPresence.date_modified, true);
  assert.deepEqual(
    report.categorical.report_status.map((v) => v.value),
    ['', 'Note', 'Out', 'Questionable']
  );
  assert.equal(report.idIntegrity.playerWeekDuplicates.duplicateKeyCount, 1);
  assert.deepEqual(report.idIntegrity.playerWeekDuplicates.duplicateKeys, [
    { key: ['2024', '15', 'REG', '00-0000001'], count: 2 },
  ]);
  // The whitespace-only placeholder survives the parse as its own value rather
  // than being silently folded into blank.
  assert.ok(report.categorical.position.some((v) => v.value === '\n    '));
});

test('a source missing date_modified is REPORTED as absent, not assumed present', () => {
  // The 2025 shape: no date_modified, an extra season_type. The 2024/2025
  // asymmetry is the whole reason the injury policy has two branches, so the
  // report has to state which side of it a file is on.
  const fixture = [
    'season,season_type,game_type,team,week,gsis_id,position,full_name,report_status,practice_status',
    '2025,REG,REG,LA,3,00-0000001,QB,Alpha One,Out,Full Participation in Practice',
    '',
  ].join('\n');
  const { report } = buildSourceReport(sourceByName('injuries_2025'), fixture);
  assert.equal(report.columnPresence.date_modified, false);
  assert.equal(report.columnPresence.practice_status, true);
});

test('the inspection projections read no stat column from any source', () => {
  // The preregistration is sealed against these reports, so the inspection must
  // be incapable of surfacing an outcome. The projected column list is the
  // whole surface it can see: identity, categorical, and nothing else.
  const allowed = new Set([
    'season', 'week', 'game_type', 'season_type', 'team', 'opponent_team', 'position',
    'status', 'status_description_abbr', 'report_status', 'gsis_id', 'espn_id',
    'player_id', 'game_id', 'home_team', 'away_team', 'location',
  ]);
  for (const [kind, columns] of Object.entries(PROJECTIONS)) {
    for (const column of columns) {
      assert.ok(allowed.has(column), `${kind} projects ${column}, which is not an identity/categorical column`);
    }
  }
  const banned = /home_score|away_score|fantasy|points|yards|touchdown|passing_|rushing_|receiving_|def_/;
  for (const columns of Object.values(PROJECTIONS)) {
    for (const column of columns) assert.ok(!banned.test(column), `${column} is outcome-bearing`);
  }
});

test('the inspection module contains no arithmetic over a stat value', () => {
  // Counting is addition of ones; scoring is arithmetic on source values. The
  // builders only ever increment counters, so a report cannot become a metric.
  const fs = require('fs');
  const path = require('path');
  const text = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'inspect.js'), 'utf8');
  assert.ok(!/Number\s*\(\s*row\[/.test(text), 'inspect.js coerces a source field to a number');
  assert.ok(!/parseFloat|parseInt/.test(text), 'inspect.js parses a numeric source field');
});
