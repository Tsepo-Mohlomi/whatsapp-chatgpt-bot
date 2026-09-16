#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if [[ "${PREFIX:-}" != /data/data/com.termux/files/usr ]]; then
  echo "Run this script inside Termux."
  exit 1
fi

pkg update -y
pkg upgrade -y
pkg install -y git nodejs-lts openssh tmux

# Optional shared-storage access. The bot keeps auth in its private Termux home.
if command -v termux-setup-storage >/dev/null 2>&1; then
  termux-setup-storage || true
fi

npm ci --no-audit --no-fund

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env. Edit it now and set OPENAI_API_KEY and OWNER_NUMBER."
else
  echo ".env already exists; leaving it unchanged."
fi

chmod +x deploy/termux-run.sh
cat <<'EOF'

Termux setup is complete.
Next:
  1. Edit .env with nano .env
  2. Start the bot with ./deploy/termux-run.sh
  3. Scan the QR code printed in the terminal

For a longer-running session, install Termux:API if desired and run:
  termux-wake-lock
EOF
