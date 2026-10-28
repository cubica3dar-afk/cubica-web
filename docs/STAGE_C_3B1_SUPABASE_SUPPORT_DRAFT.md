# Borrador para soporte de Supabase

## Summary

Managed migration calls terminate with `Connection terminated unexpectedly`
when the batch includes `private.stage_c_active_campaign(timestamptz)`. The
transaction rolls back, but the Postgres logs contain no corresponding ERROR or
FATAL entry.

## Impact

Stage C deployment is blocked. Production remains available and the failed
migrations left no partial objects.

## Expected behavior

The migration should commit or return a PostgreSQL error that identifies the
failing statement.

## Actual behavior

The client receives `Connection terminated unexpectedly`. A post-failure probe
shows no migration record, function, sentinel, or active migration session.

## Environment

- Project ref: `mymrbpwvghxmqqpzzdqk`
- Region: `sa-east-1`
- PostgreSQL: `17.11`
- Managed application: `mgmt-api`
- Latest attempt: `2026-10-19 02:39:39.178 UTC`
- PID: `1512537`
- Session: `6ad582ea.171459`
- Log severity / SQLSTATE: `LOG` / `00000`
- Batch size: 10,166 characters; source SQL: 4,708 bytes

## Troubleshooting completed

- Confirmed complete rollback after every failed attempt.
- Confirmed `statement_timeout=2min`, no lock/transaction/idle timeout, and no
  wait or blocking evidence.
- `rls_auto_enable` does not handle `CREATE FUNCTION`.
- The same pattern occurred in larger batches and then in this single-function
  migration.
- A PostgreSQL 17.5 isolated run reproduced an error while validating the exact
  original function: SQLSTATE `XX000`, message `nsitem not found (internal
  error)`, context `SQL function "stage_c_active_campaign"`, routine
  `GetNSItemByRangeTablePosn`. The function was not created.
- The source had a confirmed composite return-shape defect: 27-field anonymous
  record vs 26-field declared table type.
- A corrected version with an explicit 26-column projection creates and runs
  successfully in PostgreSQL 17.5.

## Request

Please identify why the managed connection was closed without returning or
logging the PostgreSQL `XX000` error reproduced above, and confirm any timeout,
payload, validator, or service limit applicable to this migration endpoint.
Please also advise the supported way to preserve managed migration history if
the corrected function is installed through SQL Editor or a direct connection.

