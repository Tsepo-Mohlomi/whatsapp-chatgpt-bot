const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const OpenAI = require("openai");
const P = require("pino");
require("dotenv").config();

const AUTH_DIR = process.env.AUTH_DIR || "auth";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ||
  "You are a helpful WhatsApp assistant. Keep replies clear, friendly, and reasonably concise.";

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

function isStatusOrProtocolMessage(msg) {
  return !msg?.message || msg.key?.remoteJid === "status@broadcast" || msg.message.protocolMessage;
}

function validateConfig(env = process.env) {
  const missing = [];
  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === "your_openai_api_key") missing.push("OPENAI_API_KEY");
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

async function startBot() {
  validateConfig();
  const openai = createOpenAI();
  const ownerJid = normalizeJid(process.env.OWNER_NUMBER);
  const enqueueReply = createReplyQueue();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: process.env.LOG_LEVEL || "info" }),
    browser: ["WhatsApp ChatGPT Bot", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) console.log("Scan the QR code above with WhatsApp to link this bot.");
    if (connection === "open") console.log("WhatsApp bot connected.");
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.error(`WhatsApp connection closed${shouldReconnect ? "; reconnecting" : "; logged out"}.`);
      if (shouldReconnect) setTimeout(() => startBot().catch(console.error), 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages?.[0];
    if (isStatusOrProtocolMessage(msg) || msg.key.fromMe) return;

    const senderJid = getSenderJid(msg);
    const chatJid = msg.key.remoteJid;
    const text = getMessageText(msg.message);
    if (!senderJid || !chatJid || !text) return;

    // Only the configured owner can use this bot. Group messages are ignored by default.
    if (normalizeJid(senderJid) !== ownerJid || chatJid.endsWith("@g.us")) {
      console.log(`Ignored message from ${senderJid}`);
      return;
    }

    if (text.toLowerCase() === "!ping") {
      await sock.sendMessage(chatJid, { text: "pong" });
      return;
    }
    if (text.toLowerCase() === "!help") {
      await sock.sendMessage(chatJid, { text: "Send me a message and I’ll reply using ChatGPT. Commands: !ping, !help" });
      return;
    }

    await enqueueReply(chatJid, async () => {
      try {
        await sock.sendPresenceUpdate("composing", chatJid);
        const response = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text },
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
  createOpenAI,
  createReplyQueue,
  getMessageText,
  normalizeJid,
  validateConfig,
};
