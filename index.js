"use strict";
require("dotenv").config();
const {processIncomingMessage,processOutgoingMessage}=require("./translationMiddleware");
const express=require("express"),axios=require("axios"),{createClient}=require("@supabase/supabase-js"),OpenAI=require("openai");
const REQUIRED=["SUPABASE_URL","SUPABASE_KEY","GROQ_API_KEY","EVOLUTION_API_URL","EVOLUTION_API_KEY"];
const miss=REQUIRED.filter(k=>!process.env[k]?.trim());
if(miss.length){console.error("Variables manquantes:",miss.join(", "));process.exit(1);}
const PORT=parseInt(process.env.PORT)||3001;
const EVO_URL=process.env.EVOLUTION_API_URL.replace(/\/$/,"");
const EVO_KEY=process.env.EVOLUTION_API_KEY;
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_KEY);
const supabaseAdmin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY||process.env.SUPABASE_KEY);
const groq=new OpenAI({apiKey:process.env.GROQ_API_KEY,baseURL:"https://api.groq.com/openai/v1"});
const app=express();
app.use(express.json());
app.use("/dashboard", require("express").static(__dirname + "/dashboard"));
const adminRouter = require("./admin");
app.use("/admin", adminRouter);
const paymentRouter = require("./payment");
app.use("/payment", paymentRouter);
const cooldowns=new Map();
const pendingMsgs=new Map();
const debounceTimers=new Map();

app.get("/", (req, res) => res.sendFile(require("path").join(__dirname, "landing.html")));;

app.post("/webhook",async(req,res)=>{
  res.sendStatus(200);
  try{
    const {event,instance,data}=req.body;
    if(event!=="messages.upsert")return;
    const jid=data?.key?.remoteJid;
    const fromMe=data?.key?.fromMe;
    const txt=data?.message?.conversation||data?.message?.extendedTextMessage?.text||"";
    console.log("[MSG] from:",jid,"text:",txt.substring(0,50),"fromMe:",fromMe);
    if(!txt||!jid||fromMe)return;
    const botNumbers=["237680094766","237672482763"];
    const senderNum=jid.replace("@s.whatsapp.net","").replace(/\D/g,"");
    if(botNumbers.some(n=>senderNum.endsWith(n.replace(/\D/g,"")))){
      console.log("[SKIP] bot ignore");return;
    }
    // Debounce: accumuler les messages 3s
    const coolKey=instance+":"+jid;
    const existing=pendingMsgs.get(coolKey)||[];
    existing.push(txt);
    pendingMsgs.set(coolKey,existing);
    if(debounceTimers.has(coolKey))clearTimeout(debounceTimers.get(coolKey));
    const timer=setTimeout(async()=>{
      const msgs=pendingMsgs.get(coolKey)||[];
      pendingMsgs.delete(coolKey);
      debounceTimers.delete(coolKey);
      if(!msgs.length)return;
      const combinedText=msgs.join(". ");
      // Vérifier mode agent/humain
      const {data:tenantMode}=await supabaseAdmin.from('stores').select('instance_name').eq('instance_name',instance).single();
      const {data:tenantData}=await supabaseAdmin.from('tenants').select('agent_mode').eq('instance_name',instance).single();
      if(tenantData && tenantData.agent_mode==='humain'){console.log('[MODE HUMAIN] pas de reponse IA pour',instance);return;}
      // Cooldown 15s
      const lastReply=cooldowns.get(coolKey)||0;
      if(Date.now()-lastReply<15000){console.log("[SKIP] cooldown",coolKey);return;}
      // Charger le store
      const {data:store}=await supabaseAdmin.from("stores").select("catalog_details,system_prompt").eq("instance_name",instance).single();
      console.log("[STORE]",instance,"err:",!store?"NULL":"OK");
      if(!store)return;
      // Charger le catalogue
      const {data:produits}=await supabaseAdmin.from("catalogue").select("nom,description,prix,stock,image_url").eq("instance_name",instance);
      let catalogueTexte="";
      if(produits&&produits.length>0){
        catalogueTexte=produits.map(p=>"- "+p.nom+": "+(p.description||"")+" | Prix: "+(p.prix?p.prix+" FCFA":"a demander")+" | Stock: "+(p.stock>0?"disponible":"epuise")).join("\n");
      } else {
        catalogueTexte=store.catalog_details||"Catalogue en cours de configuration.";
      }
      // System prompt
      const sys=(store.system_prompt||"Tu es un agent commercial IA professionnel. Tu aides les clients a decouvrir les produits, tu reponds a leurs questions et tu les guides vers l'achat.")+
        "\n\nREGLES: Reponds TOUJOURS en francais. Sois COURT (2-3 phrases max). Ne te repetes JAMAIS. Ne resalue pas si conversation en cours."+
        "\n\nCATALOGUE (utilise UNIQUEMENT ces produits):\n"+catalogueTexte;
      // Historique
      const {data:hist}=await supabaseAdmin.from("conversations").select("user_message,ai_reply").eq("instance",instance).eq("from",jid).order("created_at",{ascending:false}).limit(6);
      const history=((hist||[]).reverse()).flatMap(h=>[{role:"user",content:h.user_message},{role:"assistant",content:h.ai_reply}]);
      // Délai humain 2-4s
      await new Promise(r=>setTimeout(r,Math.floor(Math.random()*2000)+2000));
      // Appel Groq
      const groqRes=await axios.post("https://api.groq.com/openai/v1/chat/completions",{
        model:"llama-3.3-70b-versatile",
        messages:[{role:"system",content:sys},...history,{role:"user",content:combinedText}],
        max_tokens:300,temperature:0.7
      },{headers:{Authorization:"Bearer "+process.env.GROQ_API_KEY}});
      const reply=groqRes.data.choices[0].message.content.trim();
      console.log("[AI REPLY]",reply.substring(0,60));
      // Envoyer la réponse texte
      await axios.post(process.env.EVOLUTION_API_URL+"/message/sendText/"+instance,{
        number:jid,text:reply
      },{headers:{apikey:process.env.EVOLUTION_API_KEY}});
      console.log("[SENT] OK to",jid);
      // Envoyer images si produit mentionné
      if(produits&&produits.length>0){
        for(const p of produits){
          if(p.image_url&&reply.toLowerCase().includes(p.nom.toLowerCase().substring(0,6))){
            try{
              await axios.post(process.env.EVOLUTION_API_URL+"/message/sendMedia/"+instance,{
                number:jid,mediaType:"image",media:p.image_url,caption:p.nom+" - "+(p.prix?p.prix+" FCFA":"")
              },{headers:{apikey:process.env.EVOLUTION_API_KEY}});
            }catch(imgErr){console.log("[IMG ERR]",imgErr.message);}
            break;
          }
        }
      }
      // Sauvegarder conversation
      await supabaseAdmin.from("conversations").insert({instance,from:jid,user_message:combinedText,ai_reply:reply});
      cooldowns.set(coolKey,Date.now());
      setTimeout(()=>cooldowns.delete(coolKey),15000);
    },3000);
    debounceTimers.set(coolKey,timer);
  }catch(e){console.error("[WEBHOOK ERR]",e.message);}
});


app.post('/qr/create', async (req, res) => {
  const { instance_name } = req.body;
  if (!instance_name) return res.status(400).json({error:'instance_name requis'});
  try {
    await axios.post(EVO_URL + '/instance/create', {instanceName: instance_name, integration: 'WHATSAPP-BAILEYS', qrcode: true}, { headers: { apikey: EVO_KEY } }).catch(e => {});
    await new Promise(r => setTimeout(r, 2000));
    const qr = await axios.get(EVO_URL + '/instance/connect/' + instance_name, { headers: { apikey: EVO_KEY } });
    if (qr.data.base64) return res.json({ qr: qr.data.base64 });
    if (qr.data.instance && qr.data.instance.state === 'open') return res.json({ connected: true });
    res.json({ waiting: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/qr/status', async (req, res) => {
  const { instance } = req.query;
  if (!instance) return res.status(400).json({error:'instance requis'});
  try {
    const r = await axios.get(EVO_URL + '/instance/connectionState/' + instance, { headers: { apikey: EVO_KEY } });
    const state = r.data && r.data.instance && r.data.instance.state;
    if (state === 'open') return res.json({ connected: true });
    try {
      const qr = await axios.get(EVO_URL + '/instance/connect/' + instance, { headers: { apikey: EVO_KEY } });
      if (qr.data && qr.data.base64) return res.json({ connected: false, qr: qr.data.base64 });
    } catch(e2) {}
    res.json({ connected: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
const authRouter = require("./auth");
app.use("/auth", authRouter);
app.listen(PORT,"0.0.0.0",()=>console.log("Titanex AI actif sur le port "+PORT));
