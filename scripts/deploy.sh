#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="solutionbox2"
REMOTE_DIR="/opt/radiowar"

echo "=== RadioWar Deploy to ${REMOTE_HOST} ==="

# 1. Ensure remote directory exists
ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"

# 2. Sync project files (excluding runtime data)
echo "Syncing files..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'engine/media/songs/*' \
  --exclude 'engine/media/podcasts/*' \
  --exclude 'engine/media/news/*' \
  --exclude 'engine/media/ads/*' \
  --exclude 'engine/data/*.db*' \
  --exclude 'engine/data/sessions/storageState.json' \
  --exclude '.claude' \
  --exclude '.playwright-mcp' \
  ./ "${REMOTE_HOST}:${REMOTE_DIR}/"

# 3. Build and restart
echo "Building containers..."
ssh "${REMOTE_HOST}" "cd ${REMOTE_DIR} && docker compose build --parallel"

echo "Starting containers..."
ssh "${REMOTE_HOST}" "cd ${REMOTE_DIR} && docker compose up -d"

# 4. Status
echo ""
ssh "${REMOTE_HOST}" "cd ${REMOTE_DIR} && docker compose ps"

echo ""
echo "=== Deploy complete ==="
echo "Dashboard: http://${REMOTE_HOST}:3000"
echo "Engine:    http://${REMOTE_HOST}:3001"
echo ""
echo "Post-deploy (first time only):"
echo "  1. Claude auth:    ssh ${REMOTE_HOST} 'docker exec -it radiowar-engine claude auth'"
echo "  2. Suno session:   ./scripts/copy-suno-session.sh"
echo "  3. YouTube key:    ssh ${REMOTE_HOST} 'nano ${REMOTE_DIR}/.env.production'"
