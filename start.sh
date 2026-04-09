#!/usr/bin/env bash
# Claude Stats - start both API and UI servers

# Kill existing processes on our ports
fuser -k 3001/tcp 2>/dev/null
fuser -k 5173/tcp 2>/dev/null
sleep 0.5

cd "$(dirname "$0")"

echo "🚀 Starting Claude Stats..."
echo ""

# Start API server
bun --hot run server.ts &
API_PID=$!

# Start Vite
bun run vite --port 5173 &
UI_PID=$!

sleep 2
echo ""
echo "✦  Claude Stats running at http://localhost:5173"
echo "   API: http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop"

trap "kill $API_PID $UI_PID 2>/dev/null; exit 0" INT TERM
wait
