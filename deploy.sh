#!/usr/bin/env bash
# AfrieConnect production deploy — run on the VPS from the app folder.
#
#   cd /home/afriezon/afrieconnect.afriezon.com && ./deploy.sh
#
# Optional env overrides:
#   APP_DIR  APP_USER  BRANCH  PM2_APP  PORT

set -euo pipefail

APP_DIR="${APP_DIR:-/home/afriezon/afrieconnect.afriezon.com}"
APP_USER="${APP_USER:-afriezon}"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-afrieconnect}"
PORT="${PORT:-3600}"

cd "$APP_DIR"

echo "========================================"
echo " AfrieConnect deploy"
echo " Directory: $APP_DIR"
echo " Branch:    $BRANCH"
echo "========================================"

if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found. Clone the repo into this folder first."
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "WARNING: .env missing. Copy .env.production.example to .env and configure it."
fi

run_git() {
  if [[ "$(id -u)" -eq 0 ]] && [[ -d .git ]]; then
    git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
    if [[ "$(stat -c '%U' . 2>/dev/null || echo root)" != "root" ]]; then
      sudo -u "$APP_USER" git "$@"
      return
    fi
  fi
  git "$@"
}

echo "==> Git pull (origin/$BRANCH)"
run_git fetch origin "$BRANCH"
run_git pull origin "$BRANCH"

echo "==> npm install (--omit=dev)"
npm install --omit=dev

echo "==> File permissions (Apache + app)"
chmod 755 .
[[ -f .htaccess ]] && chmod 644 .htaccess
if command -v find >/dev/null; then
  find . -type d \
    ! -path './node_modules*' \
    ! -path './wa_sessions*' \
    ! -path './.git*' \
    -exec chmod 755 {} + 2>/dev/null || true
  find . -type f \
    ! -path './node_modules/*' \
    ! -path './wa_sessions/*' \
    ! -path './.git/*' \
    -exec chmod 644 {} + 2>/dev/null || true
fi
chown -R "$APP_USER:$APP_USER" . 2>/dev/null || true

echo "==> PM2"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP" --update-env
else
  pm2 start ecosystem.config.js --env production
fi
pm2 save

echo "==> Health check (http://127.0.0.1:$PORT/api/health)"
sleep 2
if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  curl -s "http://127.0.0.1:${PORT}/api/health"
  echo ""
  echo "Deploy successful."
else
  echo "ERROR: App did not respond on port $PORT."
  echo "Check logs: pm2 logs $PM2_APP --lines 30"
  exit 1
fi
