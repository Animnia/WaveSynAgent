#!/usr/bin/env bash
# Server-side deploy: receives staged artifacts under /tmp/wavesyn-stage and
# atomically swaps them into place, then restarts services.
#
# Layout expected in stage:
#   /tmp/wavesyn-stage/frontend/        (built dist/)
#   /tmp/wavesyn-stage/agent-server/    (source tree, no .venv)
#
# Optional env: DEPLOY_ROOT (default /home/animnia/wavesynagent)
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/home/animnia/wavesynagent}"
STAGE_DIR="${STAGE_DIR:-/tmp/wavesyn-stage}"
FRONTEND_DIR="${FRONTEND_DIR:-/var/www/wavesynagent}"
AGENT_DIR="${DEPLOY_ROOT}/agent-server"

if [[ ! -d "${STAGE_DIR}" ]]; then
  echo "Stage dir ${STAGE_DIR} not found." >&2
  exit 1
fi

echo "==> Syncing frontend"
mkdir -p "${FRONTEND_DIR}"
rsync -a --delete "${STAGE_DIR}/frontend/" "${FRONTEND_DIR}/"

echo "==> Syncing agent-server source"
mkdir -p "${AGENT_DIR}"
# Preserve .venv and .env across deploys.
rsync -a --delete \
  --exclude='.venv/' \
  --exclude='.env' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  "${STAGE_DIR}/agent-server/" "${AGENT_DIR}/"

echo "==> Ensuring Python venv (uv-managed Python 3.11)"
export PATH="${HOME}/.local/bin:${PATH}"
if [[ ! -x "${AGENT_DIR}/.venv/bin/python" ]]; then
  uv venv --python 3.11 "${AGENT_DIR}/.venv"
fi

echo "==> Installing/updating Python deps"
uv pip install --python "${AGENT_DIR}/.venv/bin/python" -e "${AGENT_DIR}"

echo "==> Restarting agent service"
sudo systemctl restart wavesyn-agent.service
sleep 1
sudo systemctl --no-pager --full status wavesyn-agent.service | head -n 20

echo "==> Reloading nginx"
sudo nginx -t
sudo systemctl reload nginx

echo "==> Cleaning up stage"
rm -rf "${STAGE_DIR}"

echo "Deploy OK."
