
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const EVOLUTION_URL = "http://localhost:8080"; 
const EVO_API_KEY = "429683C4C977415CAAFCCE10F7D57E11";
const INSTANCE = "Titanex";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/webhook-relay', async (req, res) => {
    const body = req.body;
    if (body.data && body.data.message) {
        const from = body.data.key.remoteJid;
        const msgBody = body.data.message.conversation || body.data.message.extendedTextMessage?.text;
        if (!msgBody) return res.sendStatus(200);

        console.log("📩 Message reçu : " + msgBody);

        try {
            await supabase.from('messages').insert({ client_phone: from, direction: 'entrant', contenu: msgBody });
            
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const prompt = "Tu es Titanex AI, l'assistant de Titan Arena. Réponds brièvement : " + msgBody;
            const result = await model.generateContent(prompt);
            const aiResponse = result.response.text();

            await axios.post(EVOLUTION_URL + "/message/sendText/" + INSTANCE, {
                number: from,
                text: aiResponse
            }, { headers: { "apikey": EVO_API_KEY } });

            await supabase.from('messages').insert({ client_phone: from, direction: 'sortant', contenu: aiResponse });
            console.log("✅ Réponse envoyée !");
        } catch (e) { console.error("❌ Erreur:", e.message); }
    }
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log("-----------------------------------------");
    console.log("🚀 Titanex AI est EN LIGNE sur le port " + PORT);
    console.log("-----------------------------------------");
});
