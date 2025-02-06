const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // QR Code for WhatsApp linking
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || !msg.key.remoteJid) return;

        const sender = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!messageText) return;

        console.log(`Received from ${sender}: ${messageText}`);

        // Verify owner
        if (sender !== process.env.OWNER_NUMBER) {
            sock.sendMessage(sender, { text: "Unauthorized user." });
            return;
        }

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: messageText }],
            });

            const reply = response.choices[0].message.content.trim();
            sock.sendMessage(sender, { text: reply });
        } catch (error) {
            console.error("Error:", error);
            sock.sendMessage(sender, { text: "An error occurred." });
        }
    });
}

startBot();
