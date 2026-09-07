const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createReplyQueue,
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
