# db — schema bootstrap

Creates a **new database** in the running Postgres container and builds **all schema** (23 tables + enums +
indexes + FKs) from the frozen Prisma contract.

## Files
- `create-schema.js` — the runnable bootstrap (creates the DB + applies the DDL + F7 partial-unique index).
- `schema.sql` — the DDL, **generated** from `../prisma/schema.prisma`. Do not hand-edit; regenerate with:
  ```bash
  npx prisma migrate diff --from-empty --to-schema-datamodel ../prisma/schema.prisma --script > schema.sql
  ```

## Run it
```bash
cd db
npm install
node create-schema.js
```

### Connection (defaults suit the local container `local-postgres` on 5432)
Set only what differs from the defaults. `pg` reads the `PG*` vars natively.

| Var | Default | Meaning |
|-----|---------|---------|
| `PGHOST` | `127.0.0.1` | container host |
| `PGPORT` | `5432` | published port |
| `PGUSER` | `postgres` | superuser |
| `PGPASSWORD` | `postgres` | **set this to your container's password** |
| `TARGET_DB` | `parking_poc` | the new database it creates |
| `ADMIN_DB` | `postgres` | maintenance DB used to issue `CREATE DATABASE` |
| `RESET` | — | `true` → drop the target DB first (clean rebuild) |

**PowerShell**
```powershell
$env:PGPASSWORD="postgres"; node create-schema.js
# clean rebuild:
$env:PGPASSWORD="postgres"; $env:RESET="true"; node create-schema.js
```
**bash**
```bash
PGPASSWORD=postgres node create-schema.js
PGPASSWORD=postgres RESET=true node create-schema.js   # clean rebuild
```

## Notes
- Idempotent-ish: re-running without `RESET` detects existing objects and changes nothing. Use `RESET=true`
  to rebuild from scratch.
- This is the Phase-2 bootstrap. Later, the backend uses `prisma migrate` for versioned migrations; this
  script is the quick "just put the schema in a fresh DB" path.
- To also load seed data, the backend seed (`../prisma/seed.ts`) runs via Prisma once the backend workspace
  exists (needs `@prisma/client` + `argon2`).
