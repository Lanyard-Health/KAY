#!/bin/bash
# Replit dev startup: builds backend TS, runs migrations, starts both services

set -e

echo "==> Installing/checking dependencies..."
npm install --if-present 2>/dev/null || true

echo "==> Building backend TypeScript..."
cd packages/backend
npx tsc --noEmit 2>/dev/null || true
npx tsc 2>&1 | tail -5 || true
cp -R src/static dist/ 2>/dev/null || true
cd ../..

echo "==> Running database migrations..."
npm run db:migrate --workspace=packages/backend 2>&1 || {
  echo "Migration failed, trying db push..."
  cd packages/backend && npx prisma db push --skip-generate && cd ../..
}

echo "==> Starting backend (port 3002)..."
npm run dev --workspace=packages/backend &
BACKEND_PID=$!

echo "==> Waiting for backend to be ready..."
sleep 5

echo "==> Starting frontend (port 5000)..."
npm run dev --workspace=packages/frontend
