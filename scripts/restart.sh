#!/usr/bin/env bash
# Stop whatever holds the port, reseed clean, start fresh.
cd "$(dirname "$0")/.."
PID=$(ss -lptn 'sport = :3000' 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
[ -n "$PID" ] && kill "$PID" && sleep 1
if [ "$1" = "--fresh" ]; then
  rm -f data/hunger-house.db data/hunger-house.db-shm data/hunger-house.db-wal
  node --env-file-if-exists=.env server/seed.js >/dev/null
fi
nohup env PORT=3000 node --env-file-if-exists=.env server/index.js > /tmp/hh-server.log 2>&1 &
sleep 2
curl -sf localhost:3000/api/health >/dev/null && echo "running on :3000" || { echo "FAILED"; tail -5 /tmp/hh-server.log; }
