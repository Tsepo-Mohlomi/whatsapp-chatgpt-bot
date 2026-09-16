#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

BOT_DIR="${BOT_DIR:-$HOME/whatsapp-chatgpt-bot}"
cd "$BOT_DIR"

termux-wake-lock >/dev/null 2>&1 || true
nohup npm start >> "$BOT_DIR/termux-bot.log" 2>&1 &
