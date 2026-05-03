#!/usr/bin/env bash
# One-time bootstrap on the server. Run as the animnia user.
#   sudo bash deploy/scripts/bootstrap.sh
#
# Idempotent — safe to re-run.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-animnia}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/home/${DEPLOY_USER}/wavesynagent}"
REPO_DIR="${DEPLOY_ROOT}/repo"
FRONTEND_DIR="${DEPLOY_ROOT}/frontend"
AGENT_DIR="${DEPLOY_ROOT}/agent-server"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

echo "==> Installing system packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  nginx \
  python3.11 python3.11-venv python3.11-dev \
  build-essential \
  rsync curl ca-certificates

echo "==> Creating directories"
install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" \
  "${DEPLOY_ROOT}" "${REPO_DIR}" "${FRONTEND_DIR}" "${AGENT_DIR}"

# Seed an empty .env if not present so systemd EnvironmentFile= doesn't fail.
if [[ ! -f "${AGENT_DIR}/.env" ]]; then
  cat > "${AGENT_DIR}/.env" <<'EOF'
# Filled in by GitHub Actions deploy. Manual edits OK; service will be restarted.
HOST=127.0.0.1
PORT=3002
DEFAULT_PROVIDER=deepseek
DEEPSEEK_API_KEY=
EOF
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${AGENT_DIR}/.env"
  chmod 600 "${AGENT_DIR}/.env"
fi

echo "==> Installing nginx config"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

install -m 0644 "${DEPLOY_REPO_DIR}/nginx/upgrade-map.conf"  /etc/nginx/conf.d/upgrade-map.conf
install -m 0644 "${DEPLOY_REPO_DIR}/nginx/wavesynagent.conf" /etc/nginx/sites-available/wavesynagent
ln -sf /etc/nginx/sites-available/wavesynagent /etc/nginx/sites-enabled/wavesynagent
# Disable default site if present so our default_server takes over.
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> Installing systemd unit"
install -m 0644 "${DEPLOY_REPO_DIR}/systemd/wavesyn-agent.service" /etc/systemd/system/wavesyn-agent.service
systemctl daemon-reload
# Don't start it yet — first deploy needs to copy code + create venv.
systemctl enable wavesyn-agent.service || true

echo "==> Granting passwordless sudo for service control"
SUDOERS_FILE="/etc/sudoers.d/wavesyn-deploy"
cat > "${SUDOERS_FILE}" <<EOF
${DEPLOY_USER} ALL=(root) NOPASSWD: /bin/systemctl restart wavesyn-agent.service, /bin/systemctl reload nginx, /bin/systemctl status wavesyn-agent.service, /usr/sbin/nginx -t, /usr/sbin/nginx
EOF
chmod 0440 "${SUDOERS_FILE}"
visudo -c -f "${SUDOERS_FILE}"

echo "==> Allowing HTTP through firewall (best-effort)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
fi

echo
echo "Bootstrap done."
echo "Next:"
echo "  1) Edit ${AGENT_DIR}/.env with real API keys (or let the workflow inject them)."
echo "  2) Push to GitHub main branch — Actions will deploy and start the service."
