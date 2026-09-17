# WhatsApp ChatGPT Bot

A private WhatsApp bot that replies to the configured owner using OpenAI. It uses the WhatsApp Web protocol through Baileys, so it links to an ordinary WhatsApp account by QR code rather than requiring the Meta Cloud API.

## Requirements

- Node.js 18 or newer (Node.js 22 is recommended)
- An OpenAI API key
- A WhatsApp account used for the bot

## Quick start on Linux

```bash
sudo apt update && sudo apt install -y nodejs npm
npm ci
cp .env.example .env
# Edit .env and set OPENAI_API_KEY and OWNER_NUMBER
npm start
```

On first launch, scan the QR code shown in the terminal from WhatsApp on your phone under **Linked devices**. Credentials are stored in `auth/` and reused on later launches.

For a long-running native Linux service, copy [`deploy/whatsapp-chatgpt-bot.service`](deploy/whatsapp-chatgpt-bot.service) to `/etc/systemd/system/`, edit its `WorkingDirectory` and `User`, then run `sudo systemctl enable --now whatsapp-chatgpt-bot`.

## Run on Android with Termux

Install Termux from [F-Droid](https://f-droid.org/packages/com.termux/) or the official Termux release source, then clone this repository inside Termux:

```bash
pkg update -y
pkg install -y git
git clone https://github.com/Tsepo-Mohlomi/whatsapp-chatgpt-bot.git
cd whatsapp-chatgpt-bot
bash deploy/termux-install.sh
nano .env
./deploy/termux-run.sh
```

Set `OPENAI_API_KEY` and `OWNER_NUMBER` in `.env`, then scan the QR code printed in the Termux terminal. WhatsApp credentials remain in Termux's private app storage under `auth/`, so they survive ordinary app restarts. The installer also requests shared-storage permission when available, although the bot does not need shared storage.

For longer sessions, keep Termux open in a persistent terminal such as `tmux`, disable Android battery optimization for Termux, and use `termux-wake-lock` before starting the bot. To start it after a phone reboot, install the **Termux:Boot** add-on and create a boot script that changes to this directory and runs `./deploy/termux-run.sh`.

Termux is convenient for personal use and testing, but Android can still stop background apps or network connections. It is therefore not a guaranteed 24/7 host; use Render, a Linux server, or Docker for unattended production operation. Do not expose the health endpoint publicly from your phone.

## Deploy with Render

This repository includes [`render.yaml`](render.yaml), so Render can create the service from **New > Blueprint** after connecting the GitHub repository. The Blueprint uses `npm ci`, `npm start`, `/health`, and a 1 GB persistent disk mounted at `/var/lib/whatsapp` so the WhatsApp login survives restarts.

Set `OPENAI_API_KEY` and `OWNER_NUMBER` when Render prompts for them. The service binds to Render's `PORT` and listens on `0.0.0.0`. A persistent disk is required for a reliable Render deployment; choose a Render plan that supports persistent disks.

After the first deploy, open the service logs and scan the printed QR code. Keep the service running while linking the account. Do not expose the auth directory or QR code publicly.

## Use GitHub Codespaces

Open the repository in a Codespace. The included [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json) installs Node.js 22, runs `npm ci`, and forwards port 3000 for the health endpoint.

Add `OPENAI_API_KEY` and `OWNER_NUMBER` as **Codespaces secrets** or create a local `.env` inside the Codespace:

```bash
cp .env.example .env
npm start
```

Scan the QR code in the Codespaces terminal. Codespaces storage persists for that Codespace, but it is not a production always-on host; use Render or a Linux server for continuous operation.

## Docker on Linux

Docker keeps WhatsApp credentials in a named volume:

```bash
cp .env.example .env
# Edit .env
sudo docker compose up -d --build
sudo docker compose logs -f whatsapp-bot
```

Scan the QR code from the logs. Check the health endpoint with `curl http://localhost:3000/health`. Stop it with `sudo docker compose down`; the named volume remains until explicitly removed.

## Behavior

- Only `OWNER_NUMBER` can use the bot.
- Group chats and messages sent by the bot itself are ignored.
- `!ping` returns `pong`; `!help` shows the available commands.
- Messages from the same chat are processed in order to prevent overlapping replies.
- The bot reconnects after an unexpected WhatsApp disconnect, but does not loop after logout.
- `/health` returns a JSON liveness response for Render, Docker, and monitoring tools.
- The OpenAI model, system prompt, auth directory, port, log level, command prefix, and automatic status viewing can be changed through `.env`.

## Commands

Commands use `:` by default. Send `:menu` for the in-chat menu.

| Command | Usage | Description |
| --- | --- | --- |
| `:menu` / `:help` | `:menu` | Show all commands. |
| `:status` | `:status` | Show WhatsApp connection, uptime, model, and auto-view state. |
| `:react` | Reply to a message, then send `:react ❤️` | React to the quoted message. |
| `:autoread` | `:autoread on` or `:autoread off` | Enable or disable automatic WhatsApp status viewing during the current bot session. |
| `:ai` / `:ask` | `:ai write a short greeting` | Ask ChatGPT explicitly. Plain messages still go to ChatGPT. |
| `:ping` | `:ping` | Check whether the bot responds. |
| `:time` | `:time` | Show the bot server time. |
| `:id` | `:id` | Show the current chat ID. |
| `:about` | `:about` | Show bot information. |

Automatic status viewing and the default green-heart status reaction are enabled by default. Configure them in `.env`:

```env
AUTO_VIEW_STATUS=true
AUTO_STATUS_REACT=true
STATUS_REACTION=💚
```

The status reaction uses Baileys' status-specific `statusJidList` option and sends to `status@broadcast`, targeting both the status author's participant JID and the bot's own JID. This is different from a normal chat reaction, which is why sending a regular reaction to `msg.key.remoteJid` can appear successful in logs without displaying on the status.

The bot only processes commands from `OWNER_NUMBER`; group messages remain ignored.

## Security

Never commit `.env` or `auth/`. The repository ignores both. If an API key was previously committed, revoke it and create a replacement because removing it from the latest working tree does not remove it from Git history.

## Validation

```bash
npm run check
npm test
```
