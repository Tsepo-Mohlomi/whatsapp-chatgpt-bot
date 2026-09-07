# WhatsApp ChatGPT Bot

A private WhatsApp bot that replies to the configured owner using OpenAI. It uses the WhatsApp Web protocol through Baileys, so it links to an ordinary WhatsApp account by QR code rather than requiring the Meta Cloud API.

## Requirements

- Node.js 18 or newer
- An OpenAI API key
- A WhatsApp account used for the bot

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and set OPENAI_API_KEY and OWNER_NUMBER
npm start
```

On first launch, scan the QR code shown in the terminal from WhatsApp on your phone under **Linked devices**. Credentials are stored in `auth/` and reused on later launches.

## Behavior

- Only `OWNER_NUMBER` can use the bot.
- Group chats and messages sent by the bot itself are ignored.
- `!ping` returns `pong`; `!help` shows the available commands.
- Messages from the same chat are processed in order to prevent overlapping replies.
- The bot reconnects after an unexpected WhatsApp disconnect, but does not loop after logout.
- The OpenAI model and system prompt can be changed through `.env`.

## Security

Never commit `.env` or `auth/`. The repository ignores both. If an API key was previously committed, revoke it and create a replacement because removing it from the latest working tree does not remove it from Git history.

## Validation

```bash
npm run check
npm test
```

To run the bot continuously in production, use a process manager such as systemd, PM2, or Docker on a machine that remains online. Do not expose the QR code or the `auth/` directory publicly.
