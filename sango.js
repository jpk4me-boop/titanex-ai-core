require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const GEMINI_KEY   = process.env.GEMINI_KEY;
const EVO_URL      = process.env.EVO_URL;
const EVO_APIKEY   = process.env.EVO_APIKEY;
const INSTANCE_ID  = process.env.INSTANCE_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PORT         = process.env.PORT || 3000;

const requiredEnv = ['GEMINI_KEY','EVO_URL','EVO_APIKEY','INSTANCE_ID','SUPABASE_URL','SUPABASE_KEY'];
const missingEnv = requiredEnv.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
    console.error('Variables manquantes : ' + missingEnv.join(', '));
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: "Tu es Sango, l'agent IA de Titanex. Tu reponds toujours en francais, de maniere claire et concise."
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    const data = req.body;
    const text = data.data?.message?.conversation || data.data?.message?.extendedTextMessage?.text;
    const remoteJid = data.data?.key?.remoteJid;
    if (!text || data.data?.key?.fromMe) return;
    if (remoteJid?.endsWith('@g.us')) return;
    console.log('MESSAGE de ' + remoteJid + ' : ' + text);
    try {
        await supabase.from('chat_history').insert([{ remote_jid: remoteJid, sender: 'user', message: text }]);
        const { data: history } = await supabase.from('chat_history').select('sender, message').eq('remote_jid', remoteJid).order('created_at', { ascending: true }).limit(20);
        const chatHistory = (history || []).slice(0, -1).map(row => ({
            role: row.sender === 'user' ? 'user' : 'model',
            parts: [{ text: row.message }]
        }));
        const chat = model.startChat({ history: chatHistory });
        const result = await chat.sendMessage(text);
        const aiResponse = result.response.text();
        await supabase.from('chat_history').insert([{ remote_jid: remoteJid, sender: 'ai', message: aiResponse }]);
        await axios.post(EVO_URL + '/message/sendText/' + INSTANCE_ID,
            { number: remoteJid, text: aiResponse },
            { headers: { apikey: EVO_APIKEY, 'Content-Type': 'application/json' } }
        );
        console.log('REPONSE ENVOYEE a ' + remoteJid);
    } catch (err) {
        console.error('ERREUR : ' + err.message);
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', agent: 'Sango - Titanex', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('SERVEUR SANGO ACTIF SUR LE PORT ' + PORT);
    console.log('EN ATTENTE DE MESSAGES WHATSAPP...');
});
