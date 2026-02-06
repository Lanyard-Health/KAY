#!/bin/bash

cd /Users/kay/KAY

# Clean up both servers on Ctrl+C
cleanup() {
    echo ""
    echo "Shutting down dev servers..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo "Done."
    exit 0
}
trap cleanup INT TERM

# Check that Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Please open Docker Desktop and try again."
    exit 1
fi

# Start containers
echo "Starting Docker containers..."
docker compose up -d

# Wait for database to be ready
echo "Waiting for database..."
until docker exec credentials-db pg_isready -U postgres >/dev/null 2>&1; do
    sleep 1
done
echo "Database is ready."

# Start backend
echo "Starting backend server..."
npm run dev --workspace=packages/backend &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend server..."
npm run dev --workspace=packages/frontend &
FRONTEND_PID=$!

echo ""
echo "========================================="
echo "  Frontend: http://localhost:5190"
echo "  Backend:  http://localhost:3002"
echo "  Press Ctrl+C to stop everything"
echo "========================================="
echo ""

# Wait for either process to exit
wait $BACKEND_PID $FRONTEND_PID
