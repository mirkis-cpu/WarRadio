#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="solutionbox2"
LOCAL_SESSION="engine/data/sessions/storageState.json"

if [ ! -f "${LOCAL_SESSION}" ]; then
  echo "Error: Local session file not found: ${LOCAL_SESSION}"
  echo "Run 'npm run suno:login' in engine/ first."
  exit 1
fi

echo "Copying Suno session to ${REMOTE_HOST}..."

# Get volume mount point
VOLUME_PATH=$(ssh "${REMOTE_HOST}" "docker volume inspect radiowar-engine-data --format '{{.Mountpoint}}'")

# Copy session into the volume
scp "${LOCAL_SESSION}" "${REMOTE_HOST}:/tmp/storageState.json"
ssh "${REMOTE_HOST}" "sudo mkdir -p ${VOLUME_PATH}/sessions && sudo cp /tmp/storageState.json ${VOLUME_PATH}/sessions/ && rm /tmp/storageState.json"

echo "Done. Restart engine to pick it up:"
echo "  ssh ${REMOTE_HOST} 'cd /opt/radiowar && docker compose restart engine'"
