#!/bin/bash
set -e

# Post-merge setup: install deps, rebuild shared package, apply DB migrations.

npm install --no-audit --no-fund

# Build shared package (backend imports its compiled output)
(cd packages/shared && npx tsc)

# Apply Prisma migrations and regenerate client
(cd packages/backend && npx prisma migrate deploy && npx prisma generate)
