const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001; // Utilise 3001 comme dans votre .env
const EVOLUTION_URL = "http://localhost:8080"; 
const EVO_API_KEY = "429683C4C977415CAAFCCE10F7D57E11";
const INSTANCE = "Titanex";

// Initialisation de la mémoire (Supabase)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.post('/webhook-relay', async (req, res) => {
    const body = req.body;

    // Vérification du message entrant
    if (body.data && body.data.message) {
        const from = body.data.key.remoteJid;
        const msgBody = body.data.message.conversation || body.data.message.extendedTextMessage?.text;
        
        if (!msgBody) return res.sendStatus(200);

        console.log("📩 Message reçu de " + from + " : " + msgBody);

        try {
            // 1. Sauvegarde du message entrant dans Supabase
            await supabase.from('messages').insert({ 
                client_phone: from, 
                direction: 'entrant', 
                contenu: msgBody 
            });

            // --- LOGIQUE IA ICI ---
            // Puisque Gemini est retiré, vous pouvez ici appeler une autre API (DeepSeek, OpenAI, etc.)
            let aiResponse = "Désolé, mon module de réponse est en cours de maintenance."; 
            
            // Exemple placeholder pour votre futur moteur :
            // aiResponse = await monNouveauMoteurIA(msgBody);
            // ----------------------

            // 2. Envoi de la réponse via Evolution API
            await axios.post(`${EVOLUTION_URL}/message/sendText/${INSTANCE}`, {
                number: from,
                text: aiResponse
            }, {
                headers: { 'apikey': EVO_API_KEY }
            });

            // 3. Sauvegarde de la réponse de l'IA dans Supabase
            await supabase.from('messages').insert({ 
                client_phone: from, 
                direction: 'sortant', 
                contenu: aiResponse 
            });

            res.sendStatus(201);
        } catch (error) {
            console.error("❌ Erreur lors du traitement :", error.message);
            res.sendStatus(500);
        }
    } else {
        res.sendStatus(200);
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Titanex AI Core tourne sur le port ${PORT}`);
});
