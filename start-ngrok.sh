#!/bin/bash
# Start backend + ngrok for IRIS Grocery Health Assistant

echo "🥦 Starting IRIS backend on port 3001..."
cd "$(dirname "$0")/backend"
node server.js &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# Wait for backend to be ready
echo "   Waiting for backend..."
for i in {1..15}; do
  if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "   ✅ Backend is up!"
    break
  fi
  sleep 1
done

echo ""
echo "🌐 Starting ngrok tunnel on port 3001..."
echo "   (Press Ctrl+C to stop everything)"
echo ""
ngrok http 3001

# Cleanup backend when ngrok exits
kill $BACKEND_PID 2>/dev/null
echo "Stopped."
