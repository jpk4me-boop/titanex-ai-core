const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
app.use(express.json());

// CONFIGURATION
const PORT = process.env.PORT || 3000;
const EVOLUTION_URL = "http://localhost:8080"; 
const API_KEY_EVO = "429683C4C977415CAAFCCE10F7D57E11";
const INSTANCE_NAME = "Titanex";

// INITIALISATION GEMINI & SUPABASE
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.post('/webhook-relay', async (req, res) => {
    const body = req.body;
    
    // Vérification du message entrant
    if (body.data && body.data.message) {
        const from = body.data.key.remoteJid;
        const msgBody = body.data.message.conversation || body.data.message.extendedTextMessage?.text;

        if (!msgBody) return res.sendStatus(200);

        console.log(`📩 De ${from} : ${msgBody}`);

        try {
            // 1. Sauvegarde message entrant
            await supabase.from('messages').insert({ client_phone: from, direction: 'entrant', contenu: msgBody });

            // 2. Récupération de l'historique pour le contexte (5 derniers messages)
            const { data: history } = await supabase
                .from('messages')
                .select('direction, contenu')
                .eq('client_phone', from)
                .order('created_at', { ascending: false })
                .limit(5);

            const context = history?.reverse().map(m => 
                `${m.direction === 'entrant' ? 'Client' : 'Titanex AI'}: ${m.contenu}`
            ).join('\n');

            // 3. Appel à Gemini
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const prompt = `Tu es Titanex AI, l'assistant intelligent du projet Titan Arena. 
            Voici l'historique récent :\n${context}\n
            Réponds de manière concise et pro au dernier message : ${msgBody}`;

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();

            // 4. Envoi via Evolution API
            await axios.post(`${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`, {
                number: from,
                text: responseText
            }, {
                headers: { "apikey": API_KEY_EVO }
            });

            // 5. Sauvegarde message sortant
            await supabase.from('messages').insert({ client_phone: from, direction: 'sortant', contenu: responseText });

            console.log(`✅ Titanex AI a répondu.`);
        } catch (error) {
            console.error("❌ Erreur:", error.message);
        }
    }
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`🚀 Titanex AI + Gemini actif sur le port ${PORT}`);
});