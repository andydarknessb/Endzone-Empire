-- ===========================================================================
-- GATE 1: create the temporary, read-only backtest role.
--
-- THIS FILE IS THE AUTHORIZATION ARTIFACT. It is the exact, complete set of
-- privilege mutations Gate 1 performs against production. There is no other
-- source: the runner (server/scripts/run-backtest-role.js) reads this file and
-- substitutes ONLY validated identifiers and timestamps into the psql-style
-- placeholders below. It never assembles a privilege list, a role flag, or a
-- GRANT target in JavaScript. If a privilege is not written out here, the kit
-- cannot grant it.
--
-- PLACEHOLDERS. The tokens below are psql variable references, so a DBA can
-- review, and if they choose run, this file with psql directly. Note that psql
-- reads ONE variable per name: `:"role_ident"` interpolates the variable
-- `role_ident` as a quoted identifier, `:'role_name'` interpolates `role_name`
-- as a quoted literal. A name used both ways would need setting twice.
--
--   psql -v role_ident=backtest_ro_pit01 -v role_name=backtest_ro_pit01 \
--        -v database_ident=endzone_empire -v valid_until='2026-08-02T00:00:00Z' \
--        -v password_verifier='SCRAM-SHA-256$4096:...' -f create-role.sql
--
-- @placeholders: role_ident, role_name, database_ident, valid_until, password_verifier
--
--   :"role_ident"        the role, as a quoted IDENTIFIER
--   :'role_name'         the role, as a quoted string LITERAL
--   :"database_ident"    the database, as a quoted IDENTIFIER
--   :'valid_until'       the expiry timestamp, as a quoted string LITERAL
--   :'password_verifier' the SCRAM-SHA-256 verifier, as a quoted string LITERAL
--
-- The `-- @placeholders:` line is machine-checked:
-- `backtestGate1Role.test.js` parses each .sql file, extracts the placeholders
-- it actually uses, and fails if the two sets differ. An earlier version of
-- this header documented `database_name` and omitted `database_ident`, so the
-- psql command above did not work - which mattered, because a file whose whole
-- claim is "reviewable, and runnable, as SQL" has to be both.
--
-- Running this file with any of those variables UNSET is a syntax error, not a
-- partial execution. That is deliberate.
--
-- STATEMENT BLOCKS. The `-- @statement: name` markers are ordinary SQL
-- comments; psql ignores them. The runner uses them to execute one block at a
-- time so it can assert on each result and abort before the next. The blocks
-- whose names begin `preflight_` return rows and mutate nothing; the runner
-- checks all of them BEFORE issuing any DDL.
--
-- TRANSACTIONALITY. CREATE ROLE, ALTER ROLE and GRANT are all transactional in
-- PostgreSQL. The runner wraps every block after the preflight in a single
-- transaction, so a failure part-way leaves no half-created role.
--
-- AUTHORIZATION. Executing this against production requires the user's
-- explicit Gate 1 approval. Nothing in the repository is permitted to run it
-- automatically.
-- ===========================================================================


-- @statement: preflight_context
-- The accident guard. The runner refuses to continue unless the server reports
-- exactly the database named on the command line, so a correct command aimed at
-- the wrong connection string stops here rather than creating a login role on
-- some other cluster.
SELECT
  current_database()                                    AS database_name,
  current_user                                          AS admin_role,
  (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS admin_is_superuser,
  (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS admin_can_create_role;


-- @statement: preflight_role_absent
-- FAIL CLOSED if the role already exists. An existing role is never adopted:
-- its flags, its expiry, its password and its grants were set by something
-- other than this file, so nothing below could be said to describe it. The
-- operator must tear the old one down first, deliberately.
SELECT
  rolname,
  rolcanlogin,
  rolvaliduntil,
  rolconnlimit
FROM pg_roles
WHERE rolname = :'role_name';


-- @statement: preflight_objects_present
-- Every object the role will be granted on must already exist, as the expected
-- KIND of object, in the expected schema. Granting SELECT on a name that does
-- not resolve is an error, but granting on a name that resolves to something
-- unexpected (a view over more than the four tables, say) would silently widen
-- the read surface, so the relkind is pinned too:
--   r = ordinary table, p = partitioned table.
SELECT
  n.nspname   AS schema_name,
  c.relname   AS object_name,
  c.relkind   AS object_kind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('players', 'player_stats', 'player_season_stats', 'nfl_games')
ORDER BY c.relname;


-- @statement: preflight_function_present
-- The one function the role may execute, resolved by EXACT SIGNATURE.
--
-- to_regprocedure() is the match criterion, and the reason is a defect this
-- preflight actually hit on its first contact with CI. The earlier version
-- compared pg_get_function_identity_arguments(oid) against the literal 'text'.
-- That rendering INCLUDES the parameter name, and the real function is declared
-- `fn_normalize_nfl_team(raw_team text)`, so the identity string is
-- "raw_team text", the comparison failed, and the fail-closed preflight refused
-- a perfectly good database. Renaming a parameter is not a signature change,
-- and nothing that decides whether to proceed may depend on it.
--
-- to_regprocedure is parameter-name-insensitive, resolves the one overload
-- whose argument TYPES match, and returns NULL - rather than raising - when no
-- such function exists. The NULL case stays fail-closed: the runner treats it
-- exactly as "not found" and changes nothing.
--
-- overloads_present is DIAGNOSTICS ONLY. It is what makes a failure readable
-- (it is how the CI defect was diagnosed), and it must never become a match
-- criterion again.
SELECT
  to_regprocedure('public.fn_normalize_nfl_team(text)') IS NOT NULL AS function_resolved,
  to_regprocedure('public.fn_normalize_nfl_team(text)')::text       AS resolved_signature,
  (SELECT array_agg(pg_get_function_identity_arguments(p.oid) ORDER BY p.oid)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_normalize_nfl_team')                      AS overloads_present;


-- ---------------------------------------------------------------------------
-- Everything below MUTATES. The runner has verified all four preflight blocks
-- before reaching this point, and runs the rest inside one transaction.
-- ---------------------------------------------------------------------------


-- @statement: create_role
-- Every attribute is stated explicitly, including the ones that are already the
-- default. A reader of this file should not have to know PostgreSQL's defaults
-- to know what the role can do, and a future PostgreSQL that changes a default
-- cannot change what this grants.
--
-- NOINHERIT means the role does not automatically use the privileges of roles
-- it is a MEMBER OF. Verify asserts it is a member of nothing, so today this is
-- belt-and-braces.
--
-- What the role is a member of is a different question from who is a member of
-- IT, and the second one is not always "nobody". On PostgreSQL 16 and later, if
-- the role running this file is a non-superuser holding CREATEROLE, the server
-- automatically grants the new role BACK to that creator with ADMIN OPTION, so
-- that a role-creator can still administer what it just made. That is the
-- direction Gate 1 actually meets in production, where the operator is
-- Supabase's hosted `postgres` (rolsuper=false, rolcreaterole=true). A
-- superuser-created role gets no such grant, which is why CI, whose operator is
-- the bootstrap superuser, never sees one. verify-role.sql allows exactly that
-- one relationship, identified structurally, and nothing else.
--
-- NOINHERIT does NOT limit the PUBLIC pseudo-role either: privileges granted to
-- PUBLIC apply to every role unconditionally. See the note in verify-role.sql.
--
-- CONNECTION LIMIT 1 keeps the snapshot extraction to a single session, which
-- is also what makes "one connection, one transaction, one snapshot" true.
--
-- PASSWORD receives a pre-computed SCRAM-SHA-256 VERIFIER, never a plaintext
-- password. PostgreSQL stores a well-formed verifier verbatim. This matters
-- because `log_statement` and `pg_stat_activity` can both expose statement
-- text: a plaintext `PASSWORD 'hunter2'` would land in the server log in
-- cleartext, where it would outlive the role's own expiry. The verifier is not
-- a password equivalent for login purposes over the wire, and it is redacted
-- from every line the runner prints regardless.
CREATE ROLE :"role_ident"
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS
  CONNECTION LIMIT 1
  VALID UNTIL :'valid_until'
  PASSWORD :'password_verifier';


-- @statement: set_read_only
-- Default every transaction this role opens to read-only. This is defence in
-- depth and NOT the guarantee: a client can still issue
-- `SET default_transaction_read_only = off`, because the setting is USERSET.
-- The actual guarantee that nothing can be written is that the role holds no
-- INSERT, UPDATE, DELETE or TRUNCATE privilege on any object anywhere, which
-- the verify phase proves by enumeration rather than by assertion.
ALTER ROLE :"role_ident" SET default_transaction_read_only = on;


-- @statement: grant_connect
GRANT CONNECT ON DATABASE :"database_ident" TO :"role_ident";


-- @statement: grant_usage
GRANT USAGE ON SCHEMA public TO :"role_ident";


-- @statement: grant_select
-- Exactly four tables, named individually. Deliberately NOT
-- `GRANT SELECT ON ALL TABLES IN SCHEMA public`, which would grant on every
-- table that exists today (users, sessions, holdout ledgers, everything) and is
-- the single most likely way this kit could quietly become a full-database read
-- grant.
GRANT SELECT ON TABLE
  public.players,
  public.player_stats,
  public.player_season_stats,
  public.nfl_games
TO :"role_ident";


-- @statement: grant_execute
-- fn_normalize_nfl_team is how production joins team keys, so the extraction
-- must call the real one rather than a JS twin. EXECUTE on functions is granted
-- to PUBLIC by default, so this grant is very likely redundant TODAY; it is
-- made explicitly so that the role keeps the privilege if EXECUTE is ever
-- revoked from PUBLIC, and so that the privilege appears in the role's own ACL
-- enumeration rather than being inherited invisibly.
GRANT EXECUTE ON FUNCTION public.fn_normalize_nfl_team(text) TO :"role_ident";
