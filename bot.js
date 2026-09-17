const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const OpenAI = require("openai");
const P = require("pino");
const http = require("node:http");
require("dotenv").config();

const AUTH_DIR = process.env.AUTH_DIR || "auth";
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ||
  "You are a helpful WhatsApp assistant. Keep replies clear, friendly, and reasonably concise.";
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || ":";
const DEFAULT_AUTO_VIEW_STATUS = process.env.AUTO_VIEW_STATUS !== "false";
let healthServer;
let whatsappConnected = false;
const startedAt = Date.now();

function normalizeJid(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (raw.includes("@")) return raw.split(":")[0].toLowerCase();
  const digits = raw.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}

function getMessageText(message) {
  if (!message) return "";
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.ephemeralMessage?.message?.conversation ||
    message.ephemeralMessage?.message?.extendedTextMessage?.text ||
    message.documentWithCaptionMessage?.message?.conversation ||
    message.documentWithCaptionMessage?.message?.extendedTextMessage?.text ||
    ""
  ).trim();
}

function getSenderJid(msg) {
  if (msg.key?.participant) return msg.key.participant;
  return msg.key?.remoteJid || "";
}

function parseCommand(text, prefix = COMMAND_PREFIX) {
  const normalized = String(text || "").trim();
  if (!normalized.startsWith(prefix)) return null;
  const withoutPrefix = normalized.slice(prefix.length).trim();
  if (!withoutPrefix) return null;
  const [name, ...args] = withoutPrefix.split(/\s+/);
  return { name: name.toLowerCase(), args, rawArgs: args.join(" ") };
}

function getQuotedMessageKey(msg) {
  const context = msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo;
  if (!context?.stanzaId) return null;
  return {
    remoteJid: msg.key.remoteJid,
    fromMe: false,
    id: context.stanzaId,
    participant: context.participant,
  };
}

function formatMenu(prefix = COMMAND_PREFIX) {
  return [
    "*WhatsApp ChatGPT Bot*",
    "",
    `*AI*\n${prefix}ai <question> — ask ChatGPT\n${prefix}ask <question> — same as AI`,
    `*Bot*\n${prefix}menu — show this menu\n${prefix}status — connection and runtime status\n${prefix}ping — test the bot\n${prefix}time — current server time\n${prefix}id — show the current chat ID\n${prefix}about — bot information`,
    `*WhatsApp*\n${prefix}react <emoji> — react to a quoted message\n${prefix}autoread on|off — toggle automatic status viewing\n${prefix}help — show this menu`,
    "",
    `Prefix: ${prefix} | Example: ${prefix}react ❤️ (reply to a message)`,
  ].join("\n");
}

function formatRuntimeStatus(autoViewStatus) {
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  return [
    "*Bot status*",
    `WhatsApp: ${whatsappConnected ? "connected" : "starting"}`,
    `Auto status view: ${autoViewStatus ? "on" : "off"}`,
    `Model: ${MODEL}`,
    `Uptime: ${uptimeSeconds}s`,
  ].join("\n");
}

function validateConfig(env = process.env) {
  const missing = [];
  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === "your_openai_api_key" || env.OPENAI_API_KEY === "replace_with_your_openai_api_key") missing.push("OPENAI_API_KEY");
  if (!env.OWNER_NUMBER) missing.push("OWNER_NUMBER");
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}

function createOpenAI(env = process.env) {
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

function createReplyQueue() {
  const queues = new Map();
  return (key, task) => {
    const previous = queues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    queues.set(key, current.finally(() => {
      if (queues.get(key) === current) queues.delete(key);
    }));
    return current;
  };
}

function createHealthServer(getStatus = () => ({ status: "ok" })) {
  return http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(getStatus()));
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

async function startBot() {
  validateConfig();
  const openai = createOpenAI();
  const ownerJid = normalizeJid(process.env.OWNER_NUMBER);
  const enqueueReply = createReplyQueue();
  let autoViewStatus = DEFAULT_AUTO_VIEW_STATUS;
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  if (!healthServer) healthServer = createHealthServer(() => ({
    status: "ok",
    whatsapp: whatsappConnected ? "connected" : "starting",
    autoViewStatus,
  }));
  if (!healthServer.listening) healthServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Health server listening on 0.0.0.0:${PORT}`);
  });

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: process.env.LOG_LEVEL || "info" }),
    browser: ["WhatsApp ChatGPT Bot", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) console.log("Scan the QR code above with WhatsApp to link this bot.");
    if (connection === "open") {
      whatsappConnected = true;
      console.log("WhatsApp bot connected.");
    }
    if (connection === "close") {
      whatsappConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.error(`WhatsApp connection closed${shouldReconnect ? "; reconnecting" : "; logged out"}.`);
      if (shouldReconnect) setTimeout(() => startBot().catch(console.error), 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages?.[0];
    if (!msg?.key) return;

    // Status messages are delivered using the special status@broadcast chat.
    // Viewing is opt-out by default and does not send a reply.
    if (msg.key.remoteJid === "status@broadcast") {
      if (autoViewStatus && msg.message && !msg.key.fromMe) {
        await sock.readMessages([msg.key]).catch((error) => console.error("Could not view status:", error.message));
      }
      return;
    }
    if (!msg.message || msg.message.protocolMessage || msg.key.fromMe) return;

    const senderJid = getSenderJid(msg);
    const chatJid = msg.key.remoteJid;
    const text = getMessageText(msg.message);
    if (!senderJid || !chatJid || !text) return;

    // Only the configured owner can use this bot. Group chats are ignored by default.
    if (normalizeJid(senderJid) !== ownerJid || chatJid.endsWith("@g.us")) {
      console.log(`Ignored message from ${senderJid}`);
      return;
    }

    const command = parseCommand(text);
    if (command) {
      const { name, args, rawArgs } = command;
      if (name === "menu" || name === "help") return sock.sendMessage(chatJid, { text: formatMenu() });
      if (name === "ping") return sock.sendMessage(chatJid, { text: "pong" });
      if (name === "status") return sock.sendMessage(chatJid, { text: formatRuntimeStatus(autoViewStatus) });
      if (name === "time") return sock.sendMessage(chatJid, { text: new Date().toString() });
      if (name === "id") return sock.sendMessage(chatJid, { text: `Chat ID: ${chatJid}` });
      if (name === "about") return sock.sendMessage(chatJid, { text: "A private WhatsApp assistant powered by OpenAI and Baileys." });
      if (name === "autoread" || name === "autostatus") {
        const setting = args[0]?.toLowerCase();
        if (!["on", "off"].includes(setting)) return sock.sendMessage(chatJid, { text: `Usage: ${COMMAND_PREFIX}autoread on|off\nCurrent: ${autoViewStatus ? "on" : "off"}` });
        autoViewStatus = setting === "on";
        return sock.sendMessage(chatJid, { text: `Automatic status viewing is now ${autoViewStatus ? "on" : "off"}.` });
      }
      if (name === "react") {
        const reaction = args[0];
        const quotedKey = getQuotedMessageKey(msg);
        if (!reaction || !quotedKey) return sock.sendMessage(chatJid, { text: `Reply to a message with ${COMMAND_PREFIX}react ❤️` });
        return sock.sendMessage(chatJid, { react: { text: reaction, key: quotedKey } });
      }
      if (name === "ai" || name === "ask") {
        if (!rawArgs) return sock.sendMessage(chatJid, { text: `Usage: ${COMMAND_PREFIX}ai <question>` });
      } else {
        return sock.sendMessage(chatJid, { text: `Unknown command. Send ${COMMAND_PREFIX}menu to see available commands.` });
      }
    }

    const prompt = command?.rawArgs || text;
    await enqueueReply(chatJid, async () => {
      try {
        await sock.sendPresenceUpdate("composing", chatJid);
        const response = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        });
        const reply = response.choices?.[0]?.message?.content?.trim();
        if (!reply) throw new Error("OpenAI returned an empty response");
        await sock.sendMessage(chatJid, { text: reply });
      } catch (error) {
        console.error("Failed to process message:", error);
        await sock.sendMessage(chatJid, { text: "Sorry, I couldn’t process that message. Please try again." });
      } finally {
        await sock.sendPresenceUpdate("paused", chatJid).catch(() => {});
      }
    });
  });

  return sock;
}

if (require.main === module) {
  startBot().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createHealthServer,
  createOpenAI,
  createReplyQueue,
  formatMenu,
  formatRuntimeStatus,
  getMessageText,
  getQuotedMessageKey,
  normalizeJid,
  parseCommand,
  validateConfig,
};
