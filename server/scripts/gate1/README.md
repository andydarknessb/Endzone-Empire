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
| `verify-role.sql` | Read-only. Proves the role has exactly the intended privileges and nothing else. |
| `teardown-role.sql` | The exact inverse of `create-role.sql`, plus session termination and the drop. |
| `../run-backtest-role.js` | The runner. Reads the three files and substitutes validated identifiers and timestamps into their placeholders. |

The runner never assembles a privilege list. `renderStatement` accepts exactly
six placeholder names and refuses everything else, so a value has no route to
becoming a privilege. If a grant is not written out in `create-role.sql`, the
kit cannot make it.

## What the role can do

- Log in, from **one** connection at a time, until a stated expiry at most seven
  days out.
- `CONNECT` to one named database.
- `USAGE` on schema `public`.
- `SELECT` on exactly `players`, `player_stats`, `player_season_stats`,
  `nfl_games`.
- `EXECUTE` on `public.fn_normalize_nfl_team(text)`.

It is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
and defaults every transaction to read-only.

Two honest caveats, both also stated in the SQL:

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

### 6. Tear down, as soon as Gate 2 is done

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
  SCRAM vector, placeholder rendering, argv guards, env-only credentials. No
  database.
- `server/test/backtestGate1Role.pg.test.js` - the full create -> verify ->
  teardown lifecycle against the disposable Postgres in CI's migration-smoke
  job, including verify catching an extra grant, create refusing a pre-existing
  role, and teardown aborting on an owned object. Gated on
  `BACKTEST_PG_TESTS=1`; a visible skip locally, never silent green.
