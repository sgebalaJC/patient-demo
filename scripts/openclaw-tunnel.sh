#!/bin/bash
# Open SSH tunnel to OpenClaw gateway on Vultr
# Dashboard: http://localhost:18789
# WebSocket: ws://localhost:18789

SERVER="YOUR_VPS_IP"
KEY="$HOME/.ssh/vps-key"
PORT=18789

# Kill existing tunnel if running
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "Closing existing tunnel on port $PORT..."
  kill $(lsof -ti:$PORT) 2>/dev/null
  sleep 1
fi

echo "Opening tunnel to OpenClaw gateway..."
echo "  Server: $SERVER"
echo "  Local:  http://localhost:$PORT"
echo ""

ssh -i "$KEY" -f -N -L $PORT:localhost:$PORT root@$SERVER

if [ $? -eq 0 ]; then
  echo "Tunnel open. Opening dashboard..."
  echo "To close: kill \$(lsof -ti:$PORT)"
  open "http://localhost:$PORT"
else
  echo "Failed to open tunnel."
  exit 1
fi
