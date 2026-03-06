require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// --- CONFIGURATION ---
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const EVO_URL = process.env.EVO_URL;
const EVO_APIKEY = process.env.EVO_API_KEY;
const INSTANCE_ID = process.env.EVO_INSTANCE_ID;

// --- CONFIGURATION SUPABASE ---
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;

// Initialisation du client Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: "Tu es Sango, l'agent IA de Titanex. Ton auto-répondeur est en phase finale de déploiement technique."
});

// --- ROUTE SANTÉ ---
app.get('/', (req, res) => {
    res.status(200).send('Server is running');
});

// --- ROUTE WEBHOOK ---
app.post('/webhook', async (req, res) => {
    console.log("📩 Signal reçu d'Evolution API !");
    const data = req.body;

    // Répondre immédiatement à l'API pour éviter les timeouts
    res.sendStatus(200);

    const text = data.data?.message?.conversation || data.data?.message?.extendedTextMessage?.text;
    const remoteJid = data.data?.key?.remoteJid;

    if (text && !data.data?.key?.fromMe) {
        console.log(`📩 MESSAGE de ${remoteJid} : ${text}`);

        try {
            // 1. Sauvegarder le message de l'utilisateur dans Supabase
            await supabase.from('chat_history').insert([
                { remote_jid: remoteJid, sender: 'user', message: text }
            ]);
            console.log("💾 Message utilisateur sauvegardé.");

            // 2. Générer la réponse de Sango
            console.log("🧠 Sango génère une réponse...");
            const result = await model.generateContent(text);
            const aiResponse = result.response.text();

            // 3. Sauvegarder la réponse de l'IA dans Supabase
            await supabase.from('chat_history').insert([
                { remote_jid: remoteJid, sender: 'ai', message: aiResponse }
            ]);
            console.log("💾 Réponse IA sauvegardée.");

            // 4. Envoyer le message via Evolution API
            await axios.post(`${EVO_URL}/message/sendText/${INSTANCE_ID}`, {
                number: remoteJid,
                text: aiResponse
            }, { headers: { "apikey": EVO_APIKEY, "Content-Type": "application/json" } });

            console.log(`✅ RÉPONSE ENVOYÉE sur WhatsApp`);

        } catch (err) {
            console.error("❌ ERREUR :", err.message);
        }
    }
});

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🔥 SERVEUR SANGO ACTIF SUR LE PORT ${PORT}`);
    console.log(`📡 EN ATTENTE DE MESSAGES...\n`);
});
