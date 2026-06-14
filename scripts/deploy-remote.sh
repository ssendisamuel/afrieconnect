#!/usr/bin/env bash
# Deploy from your Mac/laptop over SSH (one command).
#
# First time — set your server (or export before running):
#   export DEPLOY_SSH=root@YOUR_SERVER_IP
#
# Then:
#   ./scripts/deploy-remote.sh
#
# Or one line:
#   DEPLOY_SSH=root@YOUR_SERVER_IP ./scripts/deploy-remote.sh

set -euo pipefail

DEPLOY_SSH="${DEPLOY_SSH:-}"
APP_DIR="${APP_DIR:-/home/afriezon/afrieconnect.afriezon.com}"

if [[ -z "$DEPLOY_SSH" ]]; then
  echo "Set your server SSH target, e.g.:"
  echo "  export DEPLOY_SSH=root@123.45.67.89"
  echo "  ./scripts/deploy-remote.sh"
  exit 1
fi

echo "Deploying to $DEPLOY_SSH:$APP_DIR"
ssh "$DEPLOY_SSH" "cd '$APP_DIR' && git pull origin main && bash deploy.sh"
