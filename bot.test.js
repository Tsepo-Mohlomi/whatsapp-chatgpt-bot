const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  createReplyQueue,
  createHealthServer,
  formatMenu,
  getQuotedMessageKey,
  getMessageText,
  normalizeJid,
  parseCommand,
  getStatusReactionOptions,
  validateConfig,
} = require("./bot");

test("normalizes phone numbers and JIDs", () => {
  assert.equal(normalizeJid("+27 736 266 768"), "27736266768@s.whatsapp.net");
  assert.equal(normalizeJid("27736266768@s.whatsapp.net"), "27736266768@s.whatsapp.net");
});

test("extracts supported WhatsApp text messages", () => {
  assert.equal(getMessageText({ conversation: " hello " }), "hello");
  assert.equal(getMessageText({ extendedTextMessage: { text: "reply" } }), "reply");
  assert.equal(getMessageText(null), "");
});

test("rejects missing required configuration", () => {
  assert.throws(() => validateConfig({ OPENAI_API_KEY: "", OWNER_NUMBER: "" }), /OPENAI_API_KEY, OWNER_NUMBER/);
  assert.doesNotThrow(() => validateConfig({ OPENAI_API_KEY: "key", OWNER_NUMBER: "1@s.whatsapp.net" }));
});

test("queues replies per chat in order", async () => {
  const enqueue = createReplyQueue();
  const events = [];
  await Promise.all([
    enqueue("chat", async () => { events.push("first"); await new Promise((r) => setTimeout(r, 10)); events.push("first-done"); }),
    enqueue("chat", async () => { events.push("second"); }),
  ]);
  assert.deepEqual(events, ["first", "first-done", "second"]);
});

test("serves a JSON health endpoint", async () => {
  const server = createHealthServer(() => ({ status: "ok", whatsapp: "starting" }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const response = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/health`, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    }).on("error", reject);
  });
  server.close();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { status: "ok", whatsapp: "starting" });
});

test("parses colon commands and preserves arguments", () => {
  assert.deepEqual(parseCommand(":react ❤️"), { name: "react", args: ["❤️"], rawArgs: "❤️" });
  assert.deepEqual(parseCommand(":ai explain this clearly"), { name: "ai", args: ["explain", "this", "clearly"], rawArgs: "explain this clearly" });
  assert.equal(parseCommand("hello"), null);
});

test("formats the command menu", () => {
  const menu = formatMenu(":");
  assert.match(menu, /:menu/);
  assert.match(menu, /:status/);
  assert.match(menu, /:react/);
  assert.match(menu, /:autoread/);
});

test("extracts the quoted message key for reactions", () => {
  const key = getQuotedMessageKey({
    key: { remoteJid: "1@s.whatsapp.net" },
    message: { extendedTextMessage: { contextInfo: { stanzaId: "ABC", participant: "2@s.whatsapp.net" } } },
  });
  assert.deepEqual(key, { remoteJid: "1@s.whatsapp.net", fromMe: false, id: "ABC", participant: "2@s.whatsapp.net" });
});

test("builds a status reaction with statusJidList", () => {
  const result = getStatusReactionOptions({ remoteJid: "status@broadcast", id: "STATUS1", participant: "2@s.whatsapp.net" }, "1@s.whatsapp.net");
  assert.equal(result.jid, "status@broadcast");
  assert.equal(result.message.react.text, "💚");
  assert.deepEqual(result.message.react.key, { remoteJid: "status@broadcast", id: "STATUS1", participant: "2@s.whatsapp.net" });
  assert.deepEqual(result.options.statusJidList, ["2@s.whatsapp.net", "1@s.whatsapp.net"]);
});
