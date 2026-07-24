---
name: Render staging DB migrations
description: How to apply Prisma migrations — dev DATABASE_URL lacks DDL rights; use DATABASE_URL_ADMIN with external hostname suffix
---

The rule: to apply Prisma migrations from the Replit workspace, run
`DATABASE_URL="$ADMIN_EXT" npx prisma migrate deploy` where `ADMIN_EXT` is
`DATABASE_URL_ADMIN` with `.oregon-postgres.render.com` appended to its
hostname (the secret stores Render's *internal* hostname `dpg-…-a`, which is
unreachable from outside Render).

**Why:** the app's `DATABASE_URL` user (`lanyard_app`) has no CREATE rights on
schema public ("permission denied for schema public"), and `prisma migrate dev`
can't create a shadow database at all. Also the live DB has schema drift vs the
migrations folder, so `prisma migrate diff --from-url $DATABASE_URL` emits
dangerous unrelated DROPs — never paste that diff wholesale into a migration.

**How to apply:** generate table SQL with
`prisma migrate diff --from-empty --to-schema-datamodel`, extract only your new
objects into a hand-written `prisma/migrations/<ts>_<name>/migration.sql`, then
`migrate deploy` with the admin URL. If a deploy fails partway, mark it rolled
back with `prisma migrate resolve --rolled-back <name>` before retrying.
