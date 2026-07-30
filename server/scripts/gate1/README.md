# Gate 1: the temporary read-only backtest role

**Executing any of this against production requires the user's explicit Gate 1
approval, given at the time.** Nothing in this repository may run it
automatically, and no agent, script, CI job or hook is permitted to. This
directory exists so that the approval is given against exact SQL rather than a
prose description of a privilege list.

Gate 1 is the first of three separate approvals:

| Gate | What it authorizes | Where it lives |
| --- | --- | --- |
| 1 | Creating this temporary read-only role | here |
| 2 | Running the snapshot extraction as that role | `server/scripts/run-backtest-extraction.js` |
| 3 | Publishing the resulting snapshot | out of scope for this directory |

## What is in here

| File | What it is |
| --- | --- |
| `create-role.sql` | The complete set of privilege mutations. **This is the artifact to review.** |
| `grant-rls-policies.sql` | The row-level-security policies those grants turned out to need. **Also an artifact to review.** Runs as the table owner, not the admin. |
| `verify-role.sql` | Read-only. Proves the role has exactly the intended privileges, the intended policies, and nothing else. |
| `drop-rls-policies.sql` | The exact inverse of `grant-rls-policies.sql`. Runs as the table owner. Must run **before** the teardown. |
| `teardown-role.sql` | The exact inverse of `create-role.sql`, plus session termination and the drop. |
| `../run-backtest-role.js` | The runner. Reads these files and substitutes validated identifiers and timestamps into their placeholders. |

The runner never assembles a privilege list. `renderStatement` accepts a fixed
allowlist of placeholder names and refuses everything else, so a value has no
route to becoming a privilege. If a grant is not written out in
`create-role.sql`, or a policy in `grant-rls-policies.sql`, the kit cannot make
it.

## What the role can do

- Log in, from **one** connection at a time, until a stated expiry at most seven
  days out.
- `CONNECT` to one named database.
- `USAGE` on schema `public`.
- `SELECT` on exactly `players`, `player_stats`, `player_season_stats`,
  `nfl_games`.
- `EXECUTE` on `public.fn_normalize_nfl_team(text)`.
- Once `grant-rls-policies.sql` has run: read **all rows** of those same four
  tables, through one `PERMISSIVE ... FOR SELECT ... USING (true)` policy per
  table, named `<role>_select` and naming that role and no other.

It is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
and defaults every transaction to read-only.

### Why the policies exist

The first real Gate 1 run created the role, and verify proved all five grants
present. Gate 2's extraction dry run then read **zero rows** from `players`,
`player_stats` and `nfl_games`, and real rows from `player_season_stats`.
Nothing was wrong with the grants. Those three tables have row-level security
enabled and **no policies at all**, which is deny-all for every role that is not
the table owner. `relforcerowsecurity` is false, so the application, which
connects as the owner, is exempt and never noticed. No migration in this
repository enables RLS on them, so it was done out of band.

A privilege decides whether the role may ask. A policy decides which rows it is
answered with. Gate 1 measured only the first, which is why it passed over an
empty read surface; `verify-role.sql` now measures both.

`BYPASSRLS` is not the fix, for two independent reasons: only a superuser may
grant it and the Gate 1 operator is not one, and it is a **role** attribute that
would exempt the role from row-level security on every protected table in the
database rather than on the four it is granted. Both are written out in
`grant-rls-policies.sql`.

Four honest caveats, all also stated in the SQL:

- **On PostgreSQL 16+ the role's creator ends up holding ADMIN on it, and that
  is expected.** When a non-superuser role with `CREATEROLE` creates a role, the
  server automatically grants the new role back to the creator - `ADMIN TRUE`,
  `INHERIT FALSE`, `SET FALSE`, with the *bootstrap superuser* recorded as
  grantor - so that a role-creator can still administer what it just made. That
  is what happens in production, where the operator is Supabase's hosted
  `postgres` (`rolsuper=false`, `rolcreaterole=true`). It does **not** happen
  when the creator is a superuser, which is why CI, whose operator is the
  bootstrap superuser itself, never produces one.

  `verify` allows exactly one such relationship and identifies it structurally,
  not by trusting a role name: the member must be the connected role, the
  grantor must be the bootstrap superuser, `ADMIN` must be true, and `INHERIT`
  and `SET` must both be false. The accepted signature is one only the
  bootstrap superuser can create; the kit does not attempt to distinguish the
  implicit creator grant from an explicit superuser grant of the same shape,
  because at that level of access the distinction has no security content. A
  second membership, either direction, a different member or grantor,
  `ADMIN FALSE`, or any `INHERIT`/`SET` widening - which a non-default
  `createrole_self_grant` can mint, and which would let the creator read as or
  become this role - all fail. When present it is printed in the run output.
  `teardown` tolerates the same one row and **does not revoke it**: the creator
  cannot modify a bootstrap-superuser grant, and it carries the `ADMIN OPTION`
  that authorizes the `DROP ROLE`. Dropping the role removes it.

- `default_transaction_read_only` is a `USERSET` GUC. A client can turn it off.
  The real guarantee is that the role holds no write privilege on anything, which
  `verify-role.sql` proves by **enumerating** every privilege the role holds
  rather than by checking the ones it expects. That enumeration covers relations,
  **columns**, functions, schemas, databases and default privileges. Column
  grants get their own check because they live in `pg_attribute.attacl` and are
  completely invisible to a `pg_class.relacl` scan. `verify-role.sql`'s header
  lists the ACL classes it does *not* read, and why.
- Privileges granted to the `PUBLIC` pseudo-role apply to every role in the
  cluster, this one included, and typically include database `CONNECT`, schema
  `USAGE` and `EXECUTE` on functions. **This kit does not revoke anything from
  PUBLIC and must not** - that would change behaviour for the application and
  every other role. `NOINHERIT` does not affect PUBLIC either; it governs role
  membership, and PUBLIC is not a membership. What PUBLIC does *not* carry here
  is any table privilege, which is what makes the four-table read surface real.
- **The four kit policies are the only policies allowed on those four tables**,
  and `verify` fails on any other. That is stricter than it may look, and
  deliberately so: a `RESTRICTIVE` policy narrows what the role reads with no
  error anywhere, so a foreign policy on a granted table would shrink Gate 2's
  snapshot in silence. If the application ever grows its own policies on these
  tables, this kit stops and a human decides. `verify` **reports**
  `relrowsecurity` per table rather than asserting it, because whether RLS is on
  is the database owner's decision and can change between two runs without
  anything about the role changing. It does assert `relforcerowsecurity` is
  false, because `FORCE` applies RLS to the table owner as well, which is the
  application itself.

## Operator sequence

### 1. Generate a password, out of band

```sh
export BACKTEST_RO_ROLE_PASSWORD="$(openssl rand -base64 33)"
```

Printable ASCII, no spaces, at least 24 characters - the runner enforces all
three. The ASCII rule is a correctness constraint, not a policy one: the SCRAM
verifier is computed without a SASLprep implementation, which is equivalent to
SASLprep for printable ASCII and only for printable ASCII.

The password never becomes SQL. The runner derives the SCRAM-SHA-256 verifier
client-side and sends only that, so the plaintext cannot reach `log_statement`,
`pg_stat_activity`, or an error message. Both the password and the verifier are
redacted from every line the runner prints.

Keep the password: Gate 2 needs it as `BACKTEST_RO_DATABASE_URL`.

### 2. Set the admin credential and the CA

```sh
export BACKTEST_ADMIN_DATABASE_URL='postgres://admin:...@host/endzone_empire'
export DB_SSL_CA_PATH=/path/to/supabase-ca.crt
```

`BACKTEST_ADMIN_DATABASE_URL` is the only variable the admin credential is read
from. There is no fallback to `DATABASE_URL` or `PG*`, and it may not be passed
on the command line. The run refuses to start unless the resolved TLS config
verifies the server certificate.

The two policy phases in steps 6 and 8 need a **second, different** credential:

```sh
export BACKTEST_OWNER_DATABASE_URL='postgres://endzone_app:...@host/endzone_empire'
```

`CREATE POLICY` and `DROP POLICY` are gated on ownership of the table, and
`CREATEROLE` is not ownership - in production the four tables are owned by the
application role, so the admin credential above simply cannot perform those two
phases. Same rules as the admin one: that variable only, never argv, no fallback
to `DATABASE_URL` even though the owner is the application role. Export it when
you reach step 6 and unset it afterwards; nothing else in the sequence reads it.

### 3. Review the exact SQL that will run

```sh
node server/scripts/run-backtest-role.js --phase create \
  --database endzone_empire --role backtest_ro_pit01 \
  --valid-until 2026-08-06T00:00:00Z --print-sql
```

`--print-sql` connects to nothing **and reads no credentials at all** - run it
with an empty environment. A reviewer asked to approve a production privilege
change must be able to render the exact SQL without holding the admin password.
It substitutes the real role, database and expiry, and replaces the verifier and
the runtime role OID with self-describing markers.

Every `.sql` file also carries a `-- @placeholders:` line and a worked `psql`
invocation, and a test asserts that the documented set is exactly the set the
file's statements use - so the command in the header is one you can actually
run.

Do the same for the policy phase, which is a second privilege mutation and a
second thing to approve:

```sh
node server/scripts/run-backtest-role.js --phase grant-policies \
  --database endzone_empire --role backtest_ro_pit01 --print-sql
```

### 4. Create (this is the gated step)

```sh
node server/scripts/run-backtest-role.js --phase create \
  --database endzone_empire --role backtest_ro_pit01 \
  --valid-until 2026-08-06T00:00:00Z
```

`--database` and `--role` are not secrets; they are the accident guard. The run
aborts unless the server reports exactly the database named. Preflight then
fails closed if the role already exists, if any of the four tables is missing or
is not an ordinary table, or if the function is absent - all before any DDL. The
DDL runs in one transaction, and `create` runs `verify` automatically when it
finishes.

### 5. Verify, at any time

```sh
node server/scripts/run-backtest-role.js --phase verify \
  --database endzone_empire --role backtest_ro_pit01 \
  --valid-until 2026-08-06T00:00:00Z
```

Standalone and read-only. Run it again days later to confirm nothing has been
widened. `--valid-until` is required because the expiry is one of the things
being checked; passing a different one is a failure, not a re-statement.

Verify now also prints one line per granted table with its `rowsecurity` and
`force` flags and whether anything admits the role. Before step 6 those lines
read `RLS ON WITH NO KIT POLICY: the role reads ZERO rows here despite its
SELECT grant` for `players`, `player_stats` and `nfl_games`. That is a report,
not a failure, because it is the correct state at this point in the sequence.
It is also the line whose absence let the original run reach Gate 2.

**Verify's exit code is not a Gate 2 readiness signal.** It exits 0 in the
pre-grant state above - loudly reporting `RLS ON WITH NO KIT POLICY` while doing
so - because "no kit policy yet" is exactly where the sequence is meant to be
between steps 4 and 6. Read the per-table lines, not the exit status. What
actually gates Gate 2 is the extraction's own fail-closed check on the rows it
read: a deny-all read surface yields no players at any position, and the oracle
cohort refuses to be built from one, whatever verify's exit code said.

### 6. Grant the RLS policies, as the table owner

```sh
node server/scripts/run-backtest-role.js --phase grant-policies \
  --database endzone_empire --role backtest_ro_pit01
```

Added after the Gate 2 extraction dry run returned zero rows from three of the
four tables. See "Why the policies exist" above; `grant-rls-policies.sql` is the
artifact to review, on the same terms as `create-role.sql`.

This phase reads `BACKTEST_OWNER_DATABASE_URL`, not the admin credential, and
aborts unless `current_user` is the resolved owner of all four tables. It creates
four policies or none, in one transaction whose post-conditions are asserted
before the commit. Re-running it when all four already exist in exactly the
expected shape is a no-op; a same-named policy of a *different* shape, a policy
this kit did not create sitting on a granted table, or a partial set all abort
with nothing changed. It contains no `ALTER TABLE`, so it never enables,
disables or forces row-level security, and the runner rolls back if either flag
moves while it runs.

Then re-run step 5. The same lines should now read `RLS on, and the kit policy
admits the role`.

### 7. Run Gate 2

Out of scope for this directory. See `server/scripts/run-backtest-extraction.js`.

### 8. Drop the policies, as the table owner

```sh
node server/scripts/run-backtest-role.js --phase drop-policies \
  --database endzone_empire --role backtest_ro_pit01
```

**Before** the teardown, and PostgreSQL enforces that ordering for itself: a
policy that names a role records a shared dependency on it, and `DROP ROLE`
refuses while one exists (SQLSTATE `2BP01`). Skipping this step therefore cannot
orphan the policies; it just stops the teardown, which reports the fact and names
this command as the fix.

Dropping policies that are not there is a no-op and exit 0. A policy of the kit's
name whose shape does not match is never dropped: something else made it, so
nothing here describes what it permits.

### 9. Tear down, as soon as Gate 2 is done

```sh
node server/scripts/run-backtest-role.js --phase teardown \
  --database endzone_empire --role backtest_ro_pit01
```

Do not wait for the expiry. `VALID UNTIL` stops new logins; it does not remove
the role, its grants, its ACL entries, or a session already open.

Teardown aborts, having dropped nothing, if the role owns any object or is named
by an RLS policy or has any role membership. It never auto-drops owned objects.
Tearing down a role that does not exist prints a no-op message and exits 0, so
it is safe to run when you are not sure whether it already ran.

It captures the role's OID before dropping anything, because the final
"confirmed absent" check has to probe `pg_shdepend` and `pg_stat_activity` for
residue after the `pg_roles` row is gone. Running the file by hand with `psql`
means reading `role_oid` out of the first statement's output and setting
`-v role_oid=` before the last one.

## Tests

- `server/test/backtestGate1Role.test.js` - validation, redaction, the RFC 7677
  SCRAM vector, placeholder rendering, argv guards, env-only credentials, the
  policy-shape predicate and the policy-state classifier. No database.
- `server/test/backtestGate1Role.pg.test.js` - the full create -> verify ->
  grant-policies -> drop-policies -> teardown lifecycle against the disposable
  Postgres in CI's migration-smoke job, including verify catching an extra grant,
  create refusing a pre-existing role, teardown aborting on an owned object, and
  the RLS half: a valid `SELECT` grant reading zero rows on an RLS-enabled table
  with no policy, the same read returning rows once the policy exists, the
  dormant policy on the RLS-off table changing nothing, and `DROP ROLE` being
  refused by the server with `2BP01` while the policies stand. Gated on
  `BACKTEST_PG_TESTS=1`; a visible skip locally, never silent green.
