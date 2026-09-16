const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  createReplyQueue,
  createHealthServer,
  getMessageText,
  normalizeJid,
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
