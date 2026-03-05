const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require('@supabase/supabase-js'); 

const app = express();
app.use(express.json());

// --- CONFIGURATION ---
const GEMINI_KEY = "AIzaSyDQbg5L9eZng3Q8d3UXDJsMj9fBsD3G9tQ"; 
const EVO_URL = "http://148.230.114.82:8080"; 
const EVO_APIKEY = "429683C4C977415CAAFCCE10F7D57E11";
const INSTANCE_ID = "Titanex_User_aefe5bb7_1";

// --- CONFIGURATION SUPABASE ---
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZraGJreGFxbGVoZGxxbnlicXh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NDM1MTUsImV4cCI6MjA4NjUxOTUxNX0.2w42p0OGIpdYqK_CY1zWObDQblww6FoZHondualRb8Q";
const SUPABASE_URL = "https://fkhbkxaqlehdlqnybqxt.supabase.co"; 

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: "Tu es Sango, l'agent IA de Titanex. Ton auto-répondeur est en phase finale de déploiement technique."
});

// --- ROUTE WEBHOOK ---
app.post('/webhook', async (req, res) => {
    console.log("\n=========================================");
    console.log("📩 NOUVEAU SIGNAL REÇU !");
    console.log("=========================================");
    
    const data = req.body;
    res.sendStatus(200);

    // 🚨 LE SCANNER : Affiche tout le contenu du message brut
    console.dir(data, { depth: null });
    console.log("=========================================\n");

    const text = data.data?.message?.conversation || data.data?.message?.extendedTextMessage?.text;
    const remoteJid = data.data?.key?.remoteJid;

    if (text && !data.data?.key?.fromMe) {
        console.log(`📩 MESSAGE de ${remoteJid} : ${text}`);
        
        try {
            await supabase.from('chat_history').insert([
                { remote_jid: remoteJid, sender: 'user', message: text }
            ]);
            console.log("💾 Message utilisateur sauvegardé.");

            console.log("🧠 Sango génère une réponse...");
            const result = await model.generateContent(text);
            const aiResponse = result.response.text();

            await supabase.from('chat_history').insert([
                { remote_jid: remoteJid, sender: 'ai', message: aiResponse }
            ]);
            console.log("💾 Réponse IA sauvegardée.");

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

// --- DÉMARRAGE ET MAINTIEN EN VIE ---
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🔥 SERVEUR SANGO ACTIF SUR LE PORT ${PORT}`);
    console.log(`📡 EN ATTENTE DE MESSAGES... (Ne pas fermer ce terminal)\n`);
});

// --- FORCE LE PROCESSUS À RESTER OUVERT ---
process.stdin.resume(); 
setInterval(() => {}, 1000 * 60 * 60);