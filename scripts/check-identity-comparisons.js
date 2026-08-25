#!/usr/bin/env node
/**
 * Guard against a new unsanctioned identity comparison landing silently.
 *
 * #188 swept every identity comparison on an authorization path or a "which of
 * these is me" path, server and client. The thing that made that sweep
 * necessary is that the defects are not distinguishable by SHAPE:
 * `x.owner_id === y.owner_id` is correct in leagueRole.service and was wrong
 * in commissioner.service. So this script cannot decide whether a comparison
 * is right. What it CAN do is refuse to let a new one appear without someone
 * writing down which rule it implements.
 *
 * The rule it holds every entry against is stated in
 * `server/services/leagueRole.service.js`'s module docstring:
 *
 *   "Commissioner" is the league owner OR anyone holding a `league_commissioners`
 *   row; every commissioner-gated action authorizes through
 *   `isLeagueCommissioner` or `commissionerPredicate`. "Owner" is the creator
 *   alone, and THREE things stay owner-shaped and keep comparing `owner_id`
 *   directly: deleting the league, granting or revoking co-commissioners, and
 *   protecting the creator's Team from removal.
 *
 * CONTEXT.md's Commissioner entry states the same rule and counts it
 * differently: "Two powers stay with the creator alone ... One protection
 * stands alongside them". Same three items, and the split is the more precise
 * reading - the protection is not a power anyone holds, it is a refusal that
 * binds everyone including the creator. Recorded rather than reconciled,
 * because #188 asks for divergent statements of a rule to be listed even when
 * they agree substantively, and a reader who has met "three" in one file and
 * "two plus one" in the other should find the discrepancy already noticed.
 *
 * So every allowlist entry carries a `rule`, and the rule names either one of
 * those three, or the caller-identity question the comparison answers. Adding
 * an entry is a documented decision rather than a regex tweak: if you cannot
 * write the rule down, that is the finding.
 *
 * WHAT IS SCANNED, and why these shapes and not others:
 *
 *  - A JS equality where either operand mentions `owner_id` / `ownerId`. This
 *    is signature A from #188: compared against the league owner where the
 *    rule meant the caller.
 *  - A JS equality where either operand is a `username`, in `src/` only. This
 *    is signature B: a display string standing in for identity (#185). The
 *    server is excluded because its one hit is privacy.service's typed
 *    confirmation phrase, which #188 puts out of scope by name, and adding it
 *    would teach the reader that a username comparison is ordinary.
 *  - The SQL fragment `"leagues"."owner_id" =`. Comparing against the LEAGUE's
 *    owner is the authorization-relevant SQL shape. `"teams"."owner_id" = $n`
 *    is deliberately NOT scanned: it is the everyday "this caller's own team"
 *    lookup, it appears in about twenty places, and listing them all would
 *    bury the handful of comparisons that decide a role.
 *
 * WHAT IS NOT A COMPARISON, and so never reported:
 *
 *  - `x.owner_id != null` and friends. A null guard is not an identity
 *    question; every one of them sits BESIDE a real comparison that is listed.
 *  - Anything inside a comment. Comments are stripped first, using
 *    check-color-literals.js's own stripper, so a comment quoting a
 *    comparison in order to say it was deliberately removed - DraftBoard.jsx
 *    does exactly that - is not reported as the thing it warns about.
 *  - Test files. A test asserting on an identity comparison is the point.
 *
 * The guard has two callers, one per suite, because the code it scans has two
 * homes: server/test/identityComparisonGuard.test.js runs it over the server
 * under `npm run test:server`, and src/lib/identityComparisonGuard.test.js
 * runs it over the client in the CRA suite. Neither suite alone covers both,
 * and a guard that only runs where half its subject lives is the kind of green
 * that certifies nothing.
 *
 * Run standalone: `npm run lint:identity-comparisons`, which runs the server
 * half of the guard's own tests first, the way `lint:colors` does.
 *
 * `stripComments` is imported from check-color-literals.js rather than
 * reimplemented, because getting it right is genuinely hard (strings, template
 * literals, regex literals, JSX comments) and it is already tested. `walk` and
 * `toPosix` below are NOT shared with that module, deliberately: its `walk`
 * closes over its own extension set and skips only `node_modules`, so sharing
 * would mean parameterising a checker that sits on a CI gate in order to save
 * a dozen lines here. Two small correct walks beat one walk with two callers'
 * options threaded through it.
 */
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./check-color-literals');

const REPO = path.join(__dirname, '..');
const EXTENSIONS = new Set(['.js', '.jsx']);

const SERVER_ROOTS = ['server/routes', 'server/services', 'server/modules'];
const CLIENT_ROOTS = ['src'];
const ROOT_DIRECTORIES = Object.freeze({
  'server/routes': path.join(REPO, 'server', 'routes'),
  'server/services': path.join(REPO, 'server', 'services'),
  'server/modules': path.join(REPO, 'server', 'modules'),
  src: path.join(REPO, 'src'),
});

/**
 * One comparison the codebase is allowed to make, and the rule it implements.
 *
 * `file` is repo-relative posix. `code` is the comparison as the scanner
 * normalizes it (single-spaced). `count` is how many times that exact
 * comparison may appear in that file, so a second copy of a listed one is
 * still a new decision. `rule` is the whole point of the entry.
 *
 * Deliberately not keyed on line numbers: they move, and an allowlist that
 * needs re-deriving after every unrelated edit is one people stop reading.
 *
 * BEWARE WHEN COUNTING: every `code` below is a VERBATIM source excerpt, so
 * grepping the tree for a comparison finds it twice - once where it lives and
 * once quoted here - and an auditor counting hits concludes the sweep missed
 * some. Exclude this file from any such count, and say that you did. The
 * danger is not that the number is wrong but that it CORROBORATES the wrong
 * conclusion, and a count confirming what you already suspected does not send
 * you looking for a second opinion.
 */
const ALLOWLIST = [
  // --- The three sanctioned owner-shaped actions -------------------------
  {
    file: 'server/routes/league.router.js',
    code: 'SQL `DELETE FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2 RETURNING "id"`,',
    rule: 'sanctioned-owner: deleting the league. The gate IS the WHERE clause - no row deleted means not the owner, answered as 403',
  },
  {
    file: 'server/routes/league.router.js',
    code: 'SQL ("leagues"."owner_id" = $1) AS "is_owner",',
    rule: 'sanctioned-owner: the per-viewer is_owner flag on the leagues list, derived from the caller\'s own id ($1) so no card has to rebuild it (#188)',
  },
  {
    file: 'server/services/leagueRole.service.js',
    code: 'league.owner_id !== userId',
    rule: 'sanctioned-owner: granting or revoking co-commissioners (requireOwner)',
  },
  {
    file: 'server/services/leagueRole.service.js',
    code: 'targetUserId === league.owner_id',
    rule: 'sanctioned-owner: granting a co-commissioner - the creator already holds the role, so they are never a grantee',
  },
  {
    file: 'server/services/leagueRole.service.js',
    // Every `code` here is a verbatim excerpt of the source line it matches,
    // so this one carries the `${n}` commissionerPredicate interpolates. It is
    // quoted source, not a template literal that lost its backticks.
    // eslint-disable-next-line no-template-curly-in-string
    code: 'SQL return `("leagues"."owner_id" = $${n} OR EXISTS (',
    rule: 'NOT an owner check: this is commissionerPredicate\'s owner LEG. The owner is a commissioner, so the predicate every commissioner-gated action authorizes through is `owner OR a league_commissioners row`. The role module is the sanctioned home for it',
  },
  {
    file: 'server/services/leagueRole.service.js',
    code: 'SQL `SELECT 1 FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2`,',
    rule: 'sanctioned-owner: isLeagueOwner, the role module\'s own creator-alone read. NOTE for the next reader: it currently has no call sites. Left in place because it is the module\'s sanctioned way to ask an owner-only question, but a new owner check should be scrutinised for whether the rule is really owner-shaped before reaching for it',
  },
  {
    file: 'server/services/commissioner.service.js',
    code: 'team.owner_id === league.owner_id',
    rule: 'sanctioned-owner: the creator\'s Team cannot be removed, by anyone',
  },
  {
    file: 'src/components/LeagueDashboard/CommissionerTools.jsx',
    code: 'team.owner_id !== league.owner_id',
    rule: 'sanctioned-owner: granting a co-commissioner - the creator is never a candidate. Stays account-id-shaped because POST /api/league/:id/co-commissioners takes a userId',
  },

  // --- Caller identity: is this row the signed-in manager's own? ---------
  {
    file: 'server/routes/draft.router.js',
    code: 'team.owner_id === req.user.id',
    rule: 'caller: the team\'s own manager may toggle its autodraft, OR the commissioner may (checked separately through isLeagueCommissioner)',
  },
  {
    file: 'server/routes/league.router.js',
    code: 'matchup.home_owner_id === req.user.id',
    rule: 'caller: deriving the viewer\'s own team in a matchup, from a server-side query rather than a shared payload',
  },
  {
    file: 'server/routes/league.router.js',
    code: 'matchup.away_owner_id === req.user.id',
    rule: 'caller: deriving the viewer\'s own team in a matchup, from a server-side query rather than a shared payload',
  },
  {
    file: 'server/services/commissioner.service.js',
    code: 'team.owner_id === userId',
    rule: 'caller: no commissioner of either kind may remove their OWN team (#187 - this compares the target against the CALLER, never against the owner)',
  },
  {
    file: 'server/services/draft.service.js',
    code: 't.owner_id === userId',
    rule: 'caller: the drafting manager\'s own team, by the caller\'s own id',
  },
  {
    file: 'server/services/teamIdentity.js',
    code: 'team.owner_id === userId',
    rule: 'caller: viewerTeamIdOf picks the viewer\'s own Team out of rows the caller already holds - this is the function every per-viewer response uses INSTEAD of shipping account ids',
  },
  {
    file: 'server/services/trade.service.js',
    code: 'receiving.owner_id !== userId',
    count: 2,
    rule: 'caller: only the receiving team\'s own manager may respond to or counter a trade',
  },
  {
    file: 'server/services/trade.service.js',
    code: 'teams.get(trade.proposing_team_id).owner_id !== userId',
    rule: 'caller: only the proposing team\'s own manager may cancel their proposal',
  },

  // --- Single-recipient notifications ------------------------------------
  {
    file: 'server/services/commissioner.service.js',
    code: 'NOTIFY userId: result.rows[0].owner_id,',
    rule: 'not a role: this is a TEAM\'s own manager being told their team was locked or unlocked. The query two lines up is `FROM "teams"`, and the news is about that one team, so one recipient is the whole of the rule',
  },
  {
    file: 'server/services/trophy.service.js',
    code: 'NOTIFY userId: owner.rows[0].owner_id,',
    rule: 'not a role: notifyOwner tells a TEAM\'s own manager they earned a trophy. `SELECT "owner_id" FROM "teams" WHERE "id" = $1` - a team row, and nobody else has any stake in it',
  },

  // --- Recorded rather than changed --------------------------------------
  {
    file: 'server/services/discovery.service.js',
    code: 'SQL AND "owner_team"."owner_id" = "leagues"."owner_id") AS "ownerTeamName"`,',
    rule: 'NOT authorization: a JOIN predicate reaching the creator\'s Team so the invite preview can NAME them by Team rather than by account (#112). Nothing is gated on it',
  },
  {
    file: 'server/services/privacy.service.js',
    code: 'SQL WHERE "leagues"."owner_id" = $1',
    rule:
      'RESOLVED, creator-alone by ruling (#188 recorded it, #275 settled it). Account deletion is refused while the caller still owns a league they '
      + 'created, and this comparison is that rule: leagues.owner_id, the creator alone. A co-commissioner is not blocked. #188 found the copy disagreeing with '
      + 'it - "Delete your commissioned leagues before deleting your account", where "commissioned" reads as commissioner and takes in co-commissioners '
      + '- and left both halves alone, because widening the rule and rewording the copy are both defensible and the choice is a product decision about '
      + 'a string a user reads. The maintainer chose: the RULE stays creator-only, the COPY changed to say created. This comparison is therefore '
      + 'unchanged and correct as it stands. BEWARE the wording: FIVE hand-maintained sentences state this one rule, with nothing enforcing their '
      + 'agreement. Three now say "created" - the throw beside this query, and two in src/components/Nav/ProfileSettingsModal.jsx (the refusal toast, '
      + 'which pre-empts the throw, and the dialog warning read before the attempt). Two were left saying otherwise BY RULING, both in '
      + 'src/components/public/pages/LegalPage.jsx: the Terms of Service Termination clause ("resolving leagues you commission") and the privacy '
      + 'policy\'s Your choices and rights sentence ("Commissioners must first delete leagues they own", which has the rule right and the actor wrong). '
      + 'Published policy text is not an IC\'s to reword and the verbs differ, so it is filed for Cory rather than fixed. The privacy policy sentence '
      + 'also enumerates what deletion removes and is now stale, since deletion revokes co-commissioner grants too - a knowing trade, not an oversight.',
  },
  {
    file: 'src/components/Nav/ProfileSettingsModal.jsx',
    code: 'deletionConfirmation !== user.username',
    count: 2,
    rule:
      'NOT an identity check: a typed confirmation phrase, which #188 puts out of scope by name. The username is the string the human is asked to '
      + 'retype before deleting their account, not an answer to who they are - they are already authenticated. Listed rather than excluded so the '
      + 'distinction is written down where the next username comparison will be judged against it.',
  },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // `entry.name` comes from fs.readdirSync of a fixed repo directory, not
    // from user or network input, so there is no traversal here.
    const full = path.join(dir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'build') continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const toPosix = (rel) => rel.split(path.sep).join('/');
const isTestFile = (rel) => /\.test\.(js|jsx)$/.test(rel);

// An operand is an identifier followed by any run of member, index and call
// steps: `userId`, `req.user.id`, `user?.id`, `teams[0].owner_id`,
// `row['owner_id']`, `teams.get(id).owner_id`. The call step matters: without
// it the scanner matches only the tail of
// `teams.get(trade.proposing_team_id).owner_id !== userId` and reports a
// truncated expression no allowlist entry can be written against.
const OPERAND = "[A-Za-z_$][\\w$]*(?:\\s*(?:\\??\\.\\s*[A-Za-z_$][\\w$]*|\\[[^\\]]*\\]|\\([^()]*\\)))*";
const EQUALITY = new RegExp(`(${OPERAND})\\s*(===|!==|==(?!=)|!=(?!=))\\s*(${OPERAND})`, 'g');

// A null guard is not an identity question.
const NON_IDENTITY = /^(null|undefined|true|false|NaN)$/;

// Matches the whole tail of the operand, so a prefixed column counts:
// `matchup.home_owner_id` and `away_owner_id` are owner references as surely
// as `owner_id` is, and an underscore is a word character, so a boundary-based
// test would have skipped exactly the two the matchup route uses.
const mentionsOwnerId = (operand) => /(owner_id|ownerId)$/i.test(operand);
const mentionsUsername = (operand) => /username$/i.test(operand);

// A SQL line that compares an `owner_id` while a `leagues` table is in view.
//
// Both halves are needed. Matching `"leagues"."owner_id" =` alone misses the
// unqualified form these queries actually use - `DELETE FROM "leagues" WHERE
// "id" = $1 AND "owner_id" = $2` names no table on the column - and matching
// `"owner_id" =` alone drags in the twenty-odd `"teams"."owner_id" = $n`
// membership lookups, which are the everyday "this caller's own team" shape
// and would bury the handful of comparisons that decide a role.
//
// Line-scoped, which is what makes this honest rather than clever: it claims
// only that a leagues reference and an owner comparison sit on the same line,
// which is true of every authorization case here because these queries are
// written one clause per line.
const SQL_LEAGUES = /"leagues"/;
const SQL_OWNER_COMPARISON = /"owner_id"\s*=/;

// Addressing ONE notification recipient by an owner id that might be a
// LEAGUE's rather than a TEAM's.
//
// Not a comparison at all, which is why it needs its own rule: #188 found two
// of these (correction.service's playoff-flip alert, discovery.service's
// join-request alert) and nothing above would have caught either. Both
// resolved the COMMISSIONER role as `leagues.owner_id` and notified that one
// account, so a co-commissioner holding the very power the alert was about
// never heard it. Nothing throws when a notification reaches too few people,
// so this class has no failure mode of its own at all.
//
// The narrowing is the whole design problem. `userId: <x>.owner_id` is the
// CORRECT everyday shape - eighteen places notify a team's own manager that
// way - so flagging all of them would bury the two that matter, exactly as
// scanning `"teams"."owner_id" = $n` would. Nothing syntactic separates a
// league row from a team row, so this keys on the two shapes the real defects
// took: a variable named for a league, and an owner id pulled straight out of
// a query result to be notified. That is two allowlist entries today, both
// genuine team-owner notifications, and it catches both #188 instances.
//
// It is a partial guard and says so: `userId: row.owner_id` where `row` came
// from a `leagues` query would still slip through. Comparisons are the class
// this script covers properly.
//
// Written as "userId: <anything up to the next comma or brace>" rather than
// reusing OPERAND, because that pattern's member chain swallows the
// `.owner_id` it is meant to be looking for and leaves the alternation nothing
// to match. Bounded to one property so it cannot reach across a whole object
// literal onto an unrelated field.
const NOTIFY_ONE_OWNER = /\buserId:\s*[^,}\n]*(?:\b\w*[Ll]eague\w*\.owner_id|\.rows\[\d+\]\.owner_id)\b/;

/**
 * Every scannable comparison in one file's source, as `{ code, line }` with
 * `code` single-spaced so formatting does not decide whether an allowlist
 * entry still matches.
 *
 * Takes RAW source and strips comments itself, deliberately. An earlier
 * version took already-stripped text and left the stripping to its callers,
 * which is a seam a caller can get wrong silently: pass raw source and every
 * comparison quoted in a comment is reported as real code, with nothing to say
 * the input was wrong. The first test written against that version made
 * exactly that mistake.
 */
function findComparisons(rawText, { includeUsername, ext = '.js' }) {
  const found = [];
  stripComments(rawText, ext).split(/\r?\n/).forEach((line, i) => {
    for (const match of line.matchAll(EQUALITY)) {
      const [whole, left, , right] = match;
      if (NON_IDENTITY.test(left) || NON_IDENTITY.test(right)) continue;
      const isIdentity =
        mentionsOwnerId(left) || mentionsOwnerId(right) ||
        (includeUsername && (mentionsUsername(left) || mentionsUsername(right)));
      if (isIdentity) found.push({ code: whole.replace(/\s+/g, ' ').trim(), line: i + 1 });
    }
    if (SQL_LEAGUES.test(line) && SQL_OWNER_COMPARISON.test(line)) {
      // The whole normalized line, not just the matched fragment: several of
      // these are the bare `"owner_id" = $2`, which would make every entry
      // read the same and tell a reader nothing about which query it is.
      found.push({ code: `SQL ${line.replace(/\s+/g, ' ').trim()}`, line: i + 1 });
    }
    if (NOTIFY_ONE_OWNER.test(line)) {
      found.push({ code: `NOTIFY ${line.replace(/\s+/g, ' ').trim()}`, line: i + 1 });
    }
  });
  return found;
}

/** Every comparison under `roots`, keyed by repo-relative posix path. */
function scan(roots, { includeUsername }) {
  const byFile = new Map();
  for (const root of roots) {
    const directory = ROOT_DIRECTORIES[root];
    if (!directory) throw new Error(`identity comparison scan root is not allowed: ${root}`);
    for (const file of walk(directory)) {
      const rel = toPosix(path.relative(REPO, file));
      if (isTestFile(rel)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      const found = findComparisons(raw, { includeUsername, ext: path.extname(file) });
      if (found.length) byFile.set(rel, found);
    }
  }
  return byFile;
}

/**
 * Compare what is there against what is allowed. Reports BOTH directions:
 * an unlisted comparison is the guard doing its job, and a listed one that no
 * longer exists is an allowlist entry outliving its code, which is how an
 * allowlist quietly stops describing the codebase.
 */
function check(roots, { includeUsername, allowlist = ALLOWLIST }) {
  const byFile = scan(roots, { includeUsername });
  const scannedFiles = new Set(byFile.keys());
  const relevant = allowlist.filter((entry) =>
    roots.some((root) => entry.file.startsWith(`${root}/`))
  );

  const unlisted = [];
  // The pair is the key, serialised rather than joined with a separator: the
  // code itself contains spaces and quotes, so no separator is safely absent.
  const keyOf = (file, code) => JSON.stringify([file, code]);
  const budget = new Map();
  for (const entry of relevant) {
    const key = keyOf(entry.file, entry.code);
    budget.set(key, (budget.get(key) || 0) + (entry.count || 1));
  }

  for (const [file, comparisons] of byFile) {
    for (const { code, line } of comparisons) {
      const key = keyOf(file, code);
      const left = budget.get(key) || 0;
      if (left > 0) budget.set(key, left - 1);
      else unlisted.push(`${file}:${line}: ${code}`);
    }
  }

  const stale = [];
  for (const [key, left] of budget) {
    if (left <= 0) continue;
    const [file, code] = JSON.parse(key);
    // Only call an entry stale when its file was actually scanned; a root the
    // caller did not ask for is not evidence of anything.
    if (!scannedFiles.has(file) && !fs.existsSync(path.join(REPO, file))) {
      stale.push(`${file}: file no longer exists (allowlisted: ${code})`);
    } else {
      stale.push(`${file}: ${left} allowlisted occurrence(s) of \`${code}\` no longer present`);
    }
  }

  return { unlisted, stale };
}

function main() {
  const server = check(SERVER_ROOTS, { includeUsername: false });
  const client = check(CLIENT_ROOTS, { includeUsername: true });
  const unlisted = [...server.unlisted, ...client.unlisted];
  const stale = [...server.stale, ...client.stale];

  if (unlisted.length === 0 && stale.length === 0) {
    console.log('✅ Every identity comparison on an authorization path is on the allowlist with its rule.');
    return;
  }
  if (unlisted.length) {
    console.error(
      `\n❌ ${unlisted.length} identity comparison(s) with no rule recorded.\n` +
        'Read server/services/leagueRole.service.js\'s module docstring, decide which rule\n' +
        'each one implements, then add it to ALLOWLIST in scripts/check-identity-comparisons.js.\n' +
        'If you cannot name the rule, that is the finding (#188).\n'
    );
    unlisted.forEach((v) => console.error(`  ${v}`));
  }
  if (stale.length) {
    console.error(`\n❌ ${stale.length} allowlist entr(ies) no longer describe the code:\n`);
    stale.forEach((v) => console.error(`  ${v}`));
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWLIST,
  SERVER_ROOTS,
  CLIENT_ROOTS,
  findComparisons,
  scan,
  check,
};
