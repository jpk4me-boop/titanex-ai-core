"use strict";
require("dotenv").config();
const {processIncomingMessage,processOutgoingMessage}=require("./translationMiddleware");
const express=require("express"),axios=require("axios"),{createClient}=require("@supabase/supabase-js"),OpenAI=require("openai");
const cron = require('node-cron');
const moment = require('moment-timezone');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
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

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://accounts.google.com", "https://apis.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://accounts.google.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.groq.com", "https://www.googleapis.com", "https://accounts.google.com", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://fkhbkxaqlehdlqnybqxt.supabase.co"],
      frameSrc: ["https://accounts.google.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
    }
  }
}));

// CORS — restrict to your domain
app.use(cors({
  origin: [
    'https://titanexai.com',
    'https://www.titanexai.com',
    process.env.CORS_ORIGIN
  ].filter(Boolean),
  credentials: true
}));

// Global rate limit: 100 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requetes, reessayez plus tard' }
});
app.use('/auth', globalLimiter);
app.use('/payment', globalLimiter);

// Strict rate limit on auth endpoints: 10 attempts per 15 min
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, reessayez dans 15 minutes' }
});
app.use('/auth/login', authLimiter);
app.use('/auth/login-phone', authLimiter);
app.use('/auth/register', authLimiter);

app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true,limit:'1mb'}));
app.use("/dashboard", require("express").static(__dirname + "/dashboard"));
const adminRouter = require("./admin");
app.use("/admin", adminRouter);
const paymentRouter = require("./payment");
app.use("/payment", paymentRouter);
const cooldowns=new Map();
const pendingMsgs=new Map();
const debounceTimers=new Map();

// ── Envoi image produit via Evolution API ───────────────────────────────────
async function sendProductImage(instance, phone, imageUrl, caption) {
  try {
    const isBase64 = imageUrl && imageUrl.startsWith("data:");
    const mediaPayload = isBase64 ? {
      number: phone,
      mediatype: "image",
      mimetype: "image/jpeg",
      media: imageUrl.split(",")[1],
      caption: caption
    } : {
      number: phone,
      mediatype: "image",
      media: imageUrl,
      caption: caption
    };
    await axios.post(process.env.EVOLUTION_API_URL + "/message/sendMedia/" + instance, mediaPayload, {
      headers: { apikey: process.env.EVOLUTION_API_KEY }
    });
    console.log("[IMG SENT]", caption.substring(0, 40));
  } catch (imgErr) {
    console.log("[IMG ERR]", imgErr.message);
  }
}

// ── Notification admin WhatsApp ──────────────────────────────────────────────
async function notifyAdmin(message) {
  try {
    const adminPhone = process.env.ADMIN_PHONE;
    const adminInstance = process.env.WHATSAPP_INSTANCE || "prospect_1774206371368";
    if (!adminPhone) return;
    await axios.post(
      EVO_URL + "/message/sendText/" + adminInstance,
      { number: adminPhone + "@s.whatsapp.net", text: message, delay: 1000 },
      { headers: { apikey: EVO_KEY } }
    );
    console.log("[NOTIFY ADMIN] OK");
  } catch (e) {
    console.error("[NOTIFY ADMIN ERROR]", e.message);
  }
}
// Export pour auth.js et payment.js
app.set("notifyAdmin", notifyAdmin);

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
    const botNumbers=["237672482763"];
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

      // ─── Détection de langue via Groq ─────────────────────────────────
      let clientLang = "français";
      let clientLangCode = "fr";
      try {
        const langRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
          model: "llama-3.3-70b-versatile",
          messages: [{role:"system",content:"Tu es un détecteur de langue. Réponds UNIQUEMENT avec le JSON: {\"code\":\"XX\",\"name\":\"Nom de la langue\"}. Codes: fr=Français, en=English, ar=Arabe, es=Español, pt=Português, de=Deutsch, zh=中文, sw=Swahili, ha=Hausa, yo=Yoruba, tr=Türkçe, it=Italiano, ru=Русский"},
            {role:"user",content:"Détecte la langue: \""+combinedText.substring(0,200)+"\""}],
          max_tokens:60, temperature:0
        }, {headers:{Authorization:"Bearer "+process.env.GROQ_API_KEY}});
        const langJson = JSON.parse(langRes.data.choices[0].message.content.trim());
        clientLangCode = langJson.code || "fr";
        clientLang = langJson.name || "français";
      } catch(langErr) { console.log("[LANG DETECT] fallback fr:", langErr.message); }
      console.log("[LANG]", clientLangCode, clientLang);

      // Vérifier mode agent global (tenant)
      const {data:tenantData}=await supabaseAdmin.from('tenants').select('agent_mode,statut,date_fin,credits').eq('instance_name',instance).maybeSingle();
      if(tenantData && tenantData.agent_mode==='inactif'){console.log('[SKIP] agent désactivé pour',instance);return;}
      // ─── Guard essai/expiration/crédits ────────────────────────────────
      if(tenantData){
        const isExpired = tenantData.statut==='expiré' || tenantData.statut==='expire' || tenantData.statut==='suspendu' || tenantData.statut==='bloqué' || tenantData.statut==='banni';
        const isTrialExpired = tenantData.statut==='essai' && tenantData.date_fin && new Date(tenantData.date_fin) < new Date();
        const noCredits = typeof tenantData.credits==='number' && tenantData.credits <= 0;
        if(isExpired || isTrialExpired){
          console.log('[BLOCKED] essai expiré pour',instance,'statut:',tenantData.statut,'date_fin:',tenantData.date_fin);
          if(isTrialExpired){
            await supabaseAdmin.from('tenants').update({statut:'expiré'}).eq('instance_name',instance);
          }
          await axios.post(process.env.EVOLUTION_API_URL+"/message/sendText/"+instance,{
            number:jid,text:"⚠️ Ce service est temporairement indisponible. Contactez le marchand."
          },{headers:{apikey:process.env.EVOLUTION_API_KEY}}).catch(()=>{});
          return;
        }
        if(noCredits){
          console.log('[BLOCKED] crédits épuisés pour',instance,'credits:',tenantData.credits);
          await axios.post(process.env.EVOLUTION_API_URL+"/message/sendText/"+instance,{
            number:jid,text:"⚠️ Service temporairement suspendu. Contactez le marchand."
          },{headers:{apikey:process.env.EVOLUTION_API_KEY}}).catch(()=>{});
          return;
        }
      }
      // Vérifier mode par contact (conversation individuelle)
      const phoneCleanMode = jid.replace(/@s\.whatsapp\.net$/i,'').replace(/\D/g,'');
      const {data:convMode}=await supabaseAdmin.from('conversations').select('conv_mode').eq('phone',phoneCleanMode).eq('instance',instance).maybeSingle();
      if(convMode && convMode.conv_mode==='manuel'){console.log('[SKIP] mode manuel pour',phoneCleanMode,'sur',instance);return;}
      // Cooldown 15s
      const lastReply=cooldowns.get(coolKey)||0;
      if(Date.now()-lastReply<15000){console.log("[SKIP] cooldown",coolKey);return;}
      // Charger le store
      const {data:store}=await supabaseAdmin.from("stores").select("catalog_details,system_prompt").eq("instance_name",instance).single();
      console.log("[STORE]",instance,"err:",!store?"NULL":"OK");
      if(!store)return;
      // Charger le catalogue (condensé: nom + prix + stock pour rester dans la limite du prompt)
      const {data:produits}=await supabaseAdmin.from("catalogue").select("nom,description,prix,stock,image_url").eq("instance_name",instance);
      let catalogueTexte="";
      if(produits&&produits.length>0){
        catalogueTexte=produits.map(p=>"- "+p.nom+" | Prix: "+(p.prix?p.prix+" FCFA":"a demander")+" | "+(p.stock>0?"disponible":"epuise")+(p.image_url?" | 📸":"")).join("\n");
        // Descriptions condensées (max 200 chars) pour que TOUS les produits rentrent dans la limite du prompt
        const catalogueDetail=produits.map(p=>{
          const desc=(p.description||"Pas de description").replace(/\s+/g," ").substring(0,200);
          return "- "+p.nom+": "+desc+" | Prix: "+(p.prix?p.prix+" FCFA":"a demander");
        }).join("\n");
        catalogueTexte+="\n\nDÉTAILS PRODUITS (utilise quand le client demande plus d'infos):\n"+catalogueDetail;
      } else {
        catalogueTexte=store.catalog_details||"Catalogue en cours de configuration.";
      }
      // System prompt
      // Heure locale Cameroun (UTC+1)
      const now = new Date(Date.now() + 60*60*1000);
      const heure = now.getUTCHours();
      const minutes = now.getUTCMinutes();
      const jours = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
      const mois = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
      const jourSemaine = jours[now.getUTCDay()];
      const dateComplete = now.getUTCDate()+" "+mois[now.getUTCMonth()]+" "+now.getUTCFullYear();
      const heureFormatee = heure+":"+(minutes<10?"0":"")+minutes;
      let momentJournee;
      if(heure>=5 && heure<12) momentJournee="matin";
      else if(heure>=12 && heure<14) momentJournee="midi";
      else if(heure>=14 && heure<18) momentJournee="après-midi";
      else if(heure>=18 && heure<22) momentJournee="soir";
      else momentJournee="nuit";
      const salutationCorrecte = (heure>=5 && heure<12)?"Bonjour":"Bonsoir";

      const promptUniversel = store.system_prompt ||
        "Tu es un agent commercial IA professionnel et chaleureux. Guide les clients vers les produits du catalogue.";

      // Historique — chercher par instance+phone dans la colonne messages[]
      const phoneClean = jid.replace(/@s\.whatsapp\.net$/i,'').replace(/\D/g,'');
      let history = [];
      const {data:convRow} = await supabaseAdmin.from("conversations").select("messages").eq("phone",phoneClean).eq("instance",instance).single();
      if (convRow && Array.isArray(convRow.messages) && convRow.messages.length > 0) {
        // Prendre les 3 derniers messages pour limiter la contamination par d'anciens faux prix
        history = convRow.messages.slice(-3);
      } else {
        // Fallback: chercher sans filtre instance (anciennes données)
        const {data:convFallback} = await supabaseAdmin.from("conversations").select("messages").eq("phone",phoneClean).order("updated_at",{ascending:false}).limit(1).single();
        if (convFallback && Array.isArray(convFallback.messages)) {
          history = convFallback.messages.slice(-3);
        }
      }
      const nbMessages = history.length;
      const estNouvelleConv = nbMessages === 0;

      const sys = promptUniversel +
        "\n\n=== LANGUE DU CLIENT ===" +
        "\nLe client écrit en " + clientLang + " (code: " + clientLangCode + ")." +
        "\nRÈGLE ABSOLUE: Réponds TOUJOURS dans la langue du client (" + clientLang + ")." +
        "\nSi la langue est inconnue, réponds en français." +
        "\nAdapte les noms de produits, descriptions et instructions de paiement dans la langue du client." +

        "\n\n=== PRÉSENTATION DES PRODUITS ===" +
        "\nQuand tu présentes un produit, utilise TOUJOURS ce format:" +
        "\n*[Nom du produit]* (traduit dans la langue du client)" +
        "\n💰 Prix: [montant] FCFA" +
        "\n📝 [Description traduite dans la langue du client]" +
        "\n➡️ [Call-to-action professionnel dans la langue du client]" +
        "\nCite le NOM EXACT du produit (en français original) pour que l'image s'envoie automatiquement." +

        "\n\n=== RÈGLE PRIX ABSOLUE ===" +
        "\nLes SEULS prix valides sont ceux listés dans le CATALOGUE ci-dessous. N'INVENTE JAMAIS un prix." +
        "\nSi un prix dans l'historique de conversation contredit le catalogue, le CATALOGUE a toujours raison." +
        "\nNe confonds JAMAIS deux produits différents. Vérifie le NOM EXACT avant de donner un prix." +
        "\nExemple: 'Bague de Mami Wata' et 'Bague de richesse (Major)' sont DEUX produits DIFFÉRENTS avec des prix DIFFÉRENTS." +
        "\nNe présente QUE les produits qui existent dans le CATALOGUE ci-dessous. N'invente JAMAIS un produit, une potion, une amulette ou un talisman qui n'est pas listé." +
        "\nSi le client demande un produit absent du catalogue, réponds : 'Je n'ai pas ce produit dans ma boutique, mais voici ce que je propose : [liste les produits du catalogue].'" +

        "\n\n=== CONTEXTE TEMPOREL ===" +
        "\nNous sommes le "+jourSemaine+" "+dateComplete+", il est "+heureFormatee+" (heure de Douala/Cameroun)." +
        "\nMoment de la journée: "+momentJournee+". Salutation correcte: "+salutationCorrecte+"." +
        "\nNombre d'échanges: "+nbMessages+". "+(estNouvelleConv?"Nouvelle conversation: salue le client.":"Conversation en cours: NE PAS recommencer par Bonjour/Bonsoir, continue directement le sujet.") +

        "\n\n=== IDENTITÉ ET COMPORTEMENT ===" +
        "\nTu es un(e) vendeur(se) humain(e) expert(e), naturel(le), chaleureux(se) et persuasif(ve)." +
        "\nTu n'es PAS une IA. Ne mentionne JAMAIS que tu es une IA, un bot ou un agent automatique." +
        "\nTu parles comme un ami qui connaît bien ses produits, pas comme un robot." +

        "\n\n=== RÈGLE ANTI-RÉPÉTITION ===" +
        "\nNe présente JAMAIS deux fois le même produit dans la même conversation. Si un produit a déjà été présenté dans l'historique des messages, ne le représente plus. Consulte l'historique avant toute présentation produit." +

        "\n\n=== IDENTITÉ BOUTIQUE ===" +
        "\nTu représentes physiquement la boutique de Grand Maître Sango Montana. Quand un client parle de livraison, Finex Voyage, DHL, expédition ou coordonnées, tu dois répondre naturellement comme un vendeur réel : accepter les coordonnées, confirmer la livraison, demander le nom complet, l'adresse exacte et le numéro de téléphone pour l'expédition. Ne dis JAMAIS que tu es un assistant IA incapable d'envoyer des produits." +

        "\n\n=== RÈGLES DE CONVERSATION ===" +
        "\n1) SALUTATIONS: Si nouvelle conversation → salue avec "+salutationCorrecte+". Si conversation en cours → NE JAMAIS recommencer par Bonjour/Bonsoir." +
        "\n2) CONSCIENCE DU TEMPS: Corrige gentiment si le client utilise la mauvaise salutation (ex: il dit Bonsoir à 9h → 'Petite correction, il est "+heureFormatee+" ici, on est encore le matin 😄 Bonjour !')." +
        "\n3) LONGUEUR: Réponses courtes 1-3 phrases. Plus long seulement si le client demande des détails." +
        "\n4) UNE seule question à la fois. Ne bombarde pas le client." +
        "\n5) HONNÊTETÉ: Si tu n'as pas l'info → 'Je vais vérifier ça pour vous.' Jamais inventer." +
        "\n6) Utilise UNIQUEMENT les produits du catalogue. Cite le nom EXACT pour que l'image s'envoie." +

        "\n\n=== STRATÉGIE DE VENTE INTELLIGENTE ===" +
        "\nPHASE 1 - DÉCOUVERTE: Comprends le besoin du client en 1-2 questions max." +
        "\nPHASE 2 - PRÉSENTATION: Présente le produit adapté avec NOM EXACT + prix + avantage clé." +
        "\nPHASE 3 - PAIEMENT: Dès que le client montre de l'intérêt, propose IMMÉDIATEMENT: 'Pour commander, c'est simple: Orange Money ou MTN MoMo. Quel réseau vous convient?' Ne pas attendre qu'il demande." +
        "\nPHASE 4 - CLOSING: Quand le client accepte → donne les instructions de paiement précises et confirme la commande avec enthousiasme." +
        "\nPHASE 5 - RELANCE (si silence ou hésitation): Après une réponse sans engagement, relance intelligemment." +

        "\n\n=== TECHNIQUES DE RELANCE (après hésitation ou silence) ===" +
        "\nSi le client hésite sur le prix → 'C'est un excellent rapport qualité-prix. Et je peux vous confirmer la livraison rapide 😊'" +
        "\nSi le client dit 'je réfléchis' → 'Bien sûr, prenez votre temps. Pour info, le stock est limité. Qu'est-ce qui vous retient ?'" +
        "\nSi le client pose une question hors catalogue → 'Je n'ai pas encore cette info mais je peux vérifier. En attendant, ce produit vous intéresse toujours ?'" +
        "\nSi conversation inactive (le client ne conclut pas) → 'Je voulais juste m'assurer que vous avez toutes les infos. Des questions sur [produit mentionné] ?'" +
        "\nPropose une alternative si un produit ne convient pas → 'Si ce modèle ne vous convient pas, j'ai aussi [autre produit du catalogue] qui pourrait vous intéresser.'" +

        "\n\n=== CLOSING (conclure la vente) ===" +
        "\nDès que le client dit OUI ou montre un accord clair:" +
        "\n→ 'Super choix ! Voici comment procéder: envoyez [montant] FCFA au [numéro] via [Orange Money/MTN MoMo], puis envoyez-moi la capture du reçu. Je prépare votre commande dès confirmation 🎉'" +
        "\nAprès paiement confirmé → 'Parfait ! Commande enregistrée. Vous recevrez votre [produit] dans [délai]. Merci pour votre confiance 🙏'" +

        "\n\n=== MOYENS DE PAIEMENT ===" +
        "\nOrange Money et MTN MoMo UNIQUEMENT. Jamais Western Union, virement ou autre." +
        "\nPropose le paiement dès que le client s'intéresse à un produit, sans attendre qu'il demande." +

        "\n\n=== LIVRAISON ===" +
        "\nLocale (Cameroun): bus ou coursier - frais à la charge du client." +
        "\nInternationale: DHL/avion - frais à la charge du client." +

        "\n\n=== CATALOGUE DE LA BOUTIQUE ===\n" + catalogueTexte;
      // Tronquer le system prompt à 8000 caractères max (Llama 3.3 70B supporte 128k tokens)
      const sysFinal = sys.length > 8000 ? sys.substring(0, 8000) + "\n[catalogue tronqué]" : sys;
      // Délai humain 2-4s
      await new Promise(r=>setTimeout(r,Math.floor(Math.random()*2000)+2000));
      // Appel Groq avec retry
      let reply;
      try {
        const groqRes=await axios.post("https://api.groq.com/openai/v1/chat/completions",{
          model:"llama-3.3-70b-versatile",
          messages:[{role:"system",content:sysFinal},...history,{role:"user",content:combinedText}],
          max_tokens:300,temperature:0.7
        },{headers:{Authorization:"Bearer "+process.env.GROQ_API_KEY}});
        reply=groqRes.data.choices[0].message.content.trim();
      } catch(groqErr) {
        const status = groqErr.response?.status;
        if (status === 400 || status === 413) {
          console.log("[GROQ RETRY] status", status, "- retry avec history vide et sys tronqué, history_len:", history.length, "sys_len:", sys.length, "err_detail:", JSON.stringify(groqErr.response?.data?.error || groqErr.message).substring(0, 200));
          try {
            const retrySys = sys.length > 4000 ? sys.substring(0, 4000) + "\n[catalogue tronqué]" : sys;
            const retryRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
              model: "llama-3.3-70b-versatile",
              messages: [{role:"system",content:retrySys}, {role:"user",content:combinedText}],
              max_tokens: 300, temperature: 0.7
            }, {headers:{Authorization:"Bearer "+process.env.GROQ_API_KEY}});
            reply = retryRes.data.choices[0].message.content.trim();
          } catch(retryErr) {
            console.error("[GROQ FATAL]", retryErr.message);
            reply = "Bonjour ! Je reviens vers vous dans un instant. 🙏";
          }
        } else {
          console.error("[GROQ ERROR]", groqErr.message);
          reply = "Bonjour ! Je reviens vers vous dans un instant. 🙏";
        }
      }
      console.log("[AI REPLY]",reply.substring(0,60));
      // Envoyer la réponse texte
      await axios.post(process.env.EVOLUTION_API_URL+"/message/sendText/"+instance,{
        number:jid,text:reply
      },{headers:{apikey:process.env.EVOLUTION_API_KEY}});
      console.log("[SENT] OK to",jid);
      // Décrémenter 1 crédit par réponse agent
      try {
        await supabaseAdmin.rpc('decrement_credit', { p_instance: instance });
      } catch(creditErr) {
        console.warn("[CREDITS] decrement_credit RPC failed:", creditErr.message);
      }
      // Envoyer images si produit mentionné (match NOM COMPLET, pas substring)
      if(produits&&produits.length>0){
        // Trier par longueur de nom décroissante pour matcher le plus spécifique d'abord
        const produitsTries=[...produits].sort((a,b)=>(b.nom||"").length-(a.nom||"").length);
        for(const p of produitsTries){
          if(p.image_url&&p.nom&&reply.toLowerCase().includes(p.nom.toLowerCase())){
            const caption = "*"+p.nom+"*"+(p.prix?"\n💰 Prix: "+p.prix+" FCFA":"")+(p.description?"\n📝 "+p.description:"");
            await sendProductImage(instance, jid, p.image_url, caption);
            break;
          }
        }
      }
      // Sauvegarder conversation — upsert par phone+instance pour accumuler dans messages[]
      // phoneClean already declared above in historique section
      let existing = null;
      // D'abord chercher par phone+instance
      const {data:exact} = await supabaseAdmin.from("conversations").select("id,messages").eq("phone",phoneClean).eq("instance",instance).single();
      if (exact) {
        existing = exact;
      } else {
        // Fallback: anciennes lignes avec instance=null pour ce phone
        const {data:legacy} = await supabaseAdmin.from("conversations").select("id,messages").eq("phone",phoneClean).is("instance",null).single();
        if (legacy) existing = legacy;
      }
      // Traduction française pour le dashboard (si client non francophone)
      let translatedText = combinedText;
      if (clientLangCode !== "fr") {
        try {
          const trRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{role:"system",content:"Traduis ce texte en français. Réponds UNIQUEMENT avec la traduction, rien d'autre."},
              {role:"user",content:combinedText}],
            max_tokens:300, temperature:0.1
          }, {headers:{Authorization:"Bearer "+process.env.GROQ_API_KEY}});
          translatedText = trRes.data.choices[0].message.content.trim();
          console.log("[TRANSLATED]", translatedText.substring(0,60));
        } catch(trErr) { console.log("[TRANSLATE ERR]", trErr.message); }
      }

      if (existing) {
        const msgs = Array.isArray(existing.messages) ? existing.messages : [];
        msgs.push({role:"user",content:combinedText,translated_text:translatedText,lang:clientLangCode},{role:"assistant",content:reply});
        await supabaseAdmin.from("conversations").update({messages:msgs,instance,from:jid,user_message:combinedText,ai_reply:reply,client_language:clientLangCode,updated_at:new Date().toISOString()}).eq("id",existing.id);
      } else {
        await supabaseAdmin.from("conversations").insert({phone:phoneClean,instance,from:jid,user_message:combinedText,ai_reply:reply,client_language:clientLangCode,messages:[{role:"user",content:combinedText,translated_text:translatedText,lang:clientLangCode},{role:"assistant",content:reply}]});
        // Notification admin: nouveau prospect
        const heureDouala = moment().tz("Africa/Douala").format("DD/MM/YYYY HH:mm");
        const {data:tenantInfo} = await supabaseAdmin.from("tenants").select("nom").eq("instance_name",instance).maybeSingle();
        const nomBoutique = tenantInfo?.nom || instance;
        notifyAdmin(
          "💬 Nouveau prospect !\n" +
          "📱 Numéro: +" + phoneClean + "\n" +
          "🏪 Boutique: " + nomBoutique + "\n" +
          "💬 Message: " + combinedText.substring(0, 100) + "\n" +
          "🕐 " + heureDouala
        ).catch(()=>{});
      }
      cooldowns.set(coolKey,Date.now());
      setTimeout(()=>cooldowns.delete(coolKey),15000);
    },3000);
    debounceTimers.set(coolKey,timer);
  }catch(e){console.error("[WEBHOOK ERR]",e.message);}
});


const ADMIN_KEY_IDX = process.env.ADMIN_SECRET_KEY;
const adminAuthIdx = (req, res, next) => {
  if (req.headers["x-admin-key"] !== ADMIN_KEY_IDX) return res.status(401).json({ error: "Non autorise" });
  next();
};

app.post('/qr/create', adminAuthIdx, async (req, res) => {
  const { instance_name } = req.body;
  if (!instance_name) return res.status(400).json({error:'instance_name requis'});
  try {
    await axios.post(EVO_URL + '/instance/create', {instanceName: instance_name, integration: 'WHATSAPP-BAILEYS', qrcode: true}, { headers: { apikey: EVO_KEY } }).catch(e => {});
    await new Promise(r => setTimeout(r, 2000));
    const qr = await axios.get(EVO_URL + '/instance/connect/' + instance_name, { headers: { apikey: EVO_KEY } });
    if (qr.data.base64) return res.json({ qr: qr.data.base64 });
    if (qr.data.instance && qr.data.instance.state === 'open') return res.json({ connected: true });
    res.json({ waiting: true });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});
app.get('/qr/status', adminAuthIdx, async (req, res) => {
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
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});
const authRouter = require("./auth");
app.use("/auth", authRouter);
app.use("/api/tenant", authRouter);
const authJWT = authRouter.authJWT;

// ─── Tracking visites (public, fire-and-forget) ─────────────────────────────
app.post("/api/track/visit", async (req, res) => {
  res.json({ ok: true });
  try {
    const ua = (req.body.userAgent || req.headers['user-agent'] || '').toLowerCase();
    const ref = (req.body.referrer || '').toLowerCase();

    // Device detection
    let device = 'Desktop';
    if (/iphone|ipad|ipod/.test(ua)) device = 'iOS';
    else if (/android/.test(ua) && /mobile/.test(ua)) device = 'Android';
    else if (/android/.test(ua)) device = 'Tablet';
    else if (/mobile|phone/.test(ua)) device = 'Phone';
    else if (/tablet/.test(ua)) device = 'Tablet';

    // OS detection
    let os = 'Unknown';
    if (/windows/.test(ua)) os = 'Windows';
    else if (/macintosh|mac os/.test(ua)) os = 'macOS';
    else if (/iphone|ipad|ipod/.test(ua)) os = 'iOS';
    else if (/android/.test(ua)) os = 'Android';
    else if (/linux/.test(ua)) os = 'Linux';

    // Source detection
    let source = 'Direct';
    if (ref) {
      if (/google\./.test(ref)) source = 'Google';
      else if (/facebook\.com|fb\.com/.test(ref)) source = 'Facebook';
      else if (/instagram\.com/.test(ref)) source = 'Instagram';
      else if (/tiktok\.com/.test(ref)) source = 'TikTok';
      else if (/whatsapp\.com|wa\.me/.test(ref)) source = 'WhatsApp';
      else if (/twitter\.com|x\.com|t\.co/.test(ref)) source = 'Twitter/X';
      else if (/youtube\.com|youtu\.be/.test(ref)) source = 'YouTube';
      else if (/linkedin\.com/.test(ref)) source = 'LinkedIn';
      else source = 'Autre';
    }

    await supabaseAdmin.from('visits').insert({ device, os, source, created_at: new Date().toISOString() });
  } catch (e) {
    console.error('[TRACK VISIT]', e.message);
  }
});

// ─── Montage /api/admin → adminRouter ────────────────────────────────────────
app.use("/api/admin", adminRouter);

// ─── Route /api/tenant/whatsapp/qr ───────────────────────────────────────────
app.get('/api/tenant/whatsapp/qr', authJWT, async (req, res) => {
  try {
    const instance = req.query.instance;
    if (!instance) return res.status(400).json({ error: 'instance requis' });
    const r = await axios.get(EVO_URL + '/instance/connect/' + instance, {
      headers: { apikey: EVO_KEY }
    });
    if (r.data.base64) return res.json({ qr: r.data.base64 });
    const state = r.data.instance?.state || r.data.state || '';
    if (state === 'open') return res.json({ connected: true });
    res.json({ qr: null, state });
  } catch(e) {
    if (e.response && e.response.status === 404) return res.json({ error: 'Instance inexistante', qr: null });
    console.error('[ERROR]', e.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// ─── Routes /api/conversations ───────────────────────────────────────────────
app.patch('/api/conversations/:phone/mode', authJWT, async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g, '');
    const { mode } = req.body;
    if (!['auto', 'manuel'].includes(mode)) return res.status(400).json({ error: 'mode invalide (auto ou manuel)' });
    // Update all conversation rows for this phone
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .update({ conv_mode: mode })
      .eq('phone', phone)
      .select('id,phone,conv_mode');
    if (error) throw error;
    // If no row found, try partial match
    if (!data || data.length === 0) {
      const { data: d2, error: e2 } = await supabaseAdmin
        .from('conversations')
        .update({ conv_mode: mode })
        .like('phone', '%' + phone.slice(-9))
        .select('id,phone,conv_mode');
      if (e2) throw e2;
      return res.json({ success: true, updated: (d2 || []).length, mode });
    }
    console.log('[MODE]', phone, '->', mode, '(' + data.length + ' rows)');
    res.json({ success: true, updated: data.length, mode });
  } catch (e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

app.get('/api/conversations/:phone/messages', authJWT, async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g, '');
    const jid = phone + '@s.whatsapp.net';
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .or(`contact_id.eq.${phone},from.eq.${phone},from.eq.${jid},phone.eq.${phone}`)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── Route /payment/history ───────────────────────────────────────────────────
app.get('/payment/history', authJWT, async (req, res) => {
  try {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json([]);
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', tenant_id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── Route /api/health ────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── Bilan quotidien automatique ─────────────────────────────────────────────
const bilanEnvoye = new Map();

async function envoyerBilanTenant(tenant) {
  try {
    const tz = tenant.timezone || 'Africa/Douala';
    const now = moment().tz(tz);
    const aujourdhui = now.format('YYYY-MM-DD');
    const debutJour = aujourdhui + 'T00:00:00';
    const finJour = aujourdhui + 'T23:59:59';

    const jours = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
    const mois = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    const jourFr = jours[now.day()];
    const dateFr = now.date() + ' ' + mois[now.month()] + ' ' + now.year();

    // Messages du jour
    const {count: nbMessages} = await supabaseAdmin
      .from('conversations')
      .select('id', {count: 'exact', head: true})
      .eq('instance', tenant.instance_name)
      .gte('created_at', debutJour)
      .lte('created_at', finJour);

    // Prospects uniques du jour
    const {data: prospects} = await supabaseAdmin
      .from('conversations')
      .select('phone')
      .eq('instance', tenant.instance_name)
      .gte('created_at', debutJour)
      .lte('created_at', finJour);
    const phonesUniques = new Set((prospects || []).map(p => p.phone));
    const nbProspects = phonesUniques.size;

    // Transactions du jour
    const {data: txns} = await supabaseAdmin
      .from('transactions')
      .select('amount')
      .eq('user_id', tenant.id)
      .eq('status', 'SUCCESSFUL')
      .gte('created_at', debutJour)
      .lte('created_at', finJour);
    const nbCommandes = (txns || []).length;
    const totalRevenus = (txns || []).reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

    let message = `📊 *BILAN DU JOUR — ${tenant.nom}*\n📅 ${jourFr} ${dateFr}\n\n`;
    message += `📦 Commandes : ${nbCommandes}\n`;
    message += `💰 Revenus : ${totalRevenus} FCFA\n`;
    message += `👥 Nouveaux prospects : ${nbProspects}\n`;
    message += `💬 Messages reçus : ${nbMessages || 0}\n\n`;

    if (nbCommandes > 0 || totalRevenus > 0) {
      message += `Excellente journée ! Continuez sur cette lancée 🔥`;
    } else {
      message += `Aucune activité aujourd'hui. Partagez votre lien boutique sur vos réseaux pour attirer des clients !`;
    }
    message += `\n\nÀ demain ! 🚀`;

    await axios.post(EVO_URL + '/message/sendText/' + tenant.instance_name, {
      number: tenant.telephone,
      text: message
    }, {
      headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' }
    });

    console.log('[BILAN] Envoyé à', tenant.nom, '(' + tenant.telephone + ')');
  } catch(e) {
    console.error('[BILAN ERR]', tenant.nom, e.message);
  }
}

async function verifierBilans() {
  try {
    const {data: tenants} = await supabaseAdmin
      .from('tenants')
      .select('id,nom,telephone,instance_name,timezone')
      .eq('statut', 'actif');
    if (!tenants || !tenants.length) return;

    for (const tenant of tenants) {
      const tz = tenant.timezone || 'Africa/Douala';
      const now = moment().tz(tz);
      const heure = now.format('HH:mm');
      const dateLocale = now.format('YYYY-MM-DD');
      const cle = tenant.id + '_' + dateLocale;

      if (heure === '21:00' && !bilanEnvoye.has(cle)) {
        bilanEnvoye.set(cle, true);
        await envoyerBilanTenant(tenant);
      }
    }

    // Nettoyage des clés anciennes (garder seulement aujourd'hui)
    for (const [cle] of bilanEnvoye) {
      const dateCle = cle.split('_').pop();
      const hier = moment().subtract(1, 'day').format('YYYY-MM-DD');
      if (dateCle < hier) bilanEnvoye.delete(cle);
    }
  } catch(e) {
    console.error('[BILAN CRON ERR]', e.message);
  }
}

cron.schedule('* * * * *', verifierBilans);
console.log('[CRON] Vérification bilans quotidiens activée (chaque minute)');

// ─── CRON: Expiration des comptes essai ──────────────────────────────────────
async function expirerComptesEssai() {
  try {
    const now = new Date().toISOString();
    const {data: expired, error} = await supabaseAdmin
      .from('tenants')
      .select('id,nom,email,instance_name,date_fin')
      .eq('statut', 'essai')
      .lt('date_fin', now);
    if (error) { console.error('[CRON EXPIRE ERR]', error.message); return; }
    if (!expired || !expired.length) return;
    const ids = expired.map(t => t.id);
    await supabaseAdmin.from('tenants').update({statut: 'expiré'}).in('id', ids);
    console.log('[CRON EXPIRE]', expired.length, 'comptes expirés:', expired.map(t => t.instance_name).join(', '));
    // Notification admin WhatsApp
    const liste = expired.map(t => '• ' + t.nom + ' (' + (t.email || t.instance_name) + ') — fin: ' + (t.date_fin || '?').substring(0, 10)).join('\n');
    notifyAdmin('⏰ ' + expired.length + ' compte(s) essai expiré(s):\n' + liste).catch(() => {});
  } catch(e) {
    console.error('[CRON EXPIRE ERR]', e.message);
  }
}
cron.schedule('1 0 * * *', expirerComptesEssai);
// Aussi exécuter au démarrage pour rattraper les comptes déjà expirés
setTimeout(expirerComptesEssai, 5000);
console.log('[CRON] Expiration comptes essai activée (quotidien 00:01 + démarrage)');

// ─── Route test envoi bilans ─────────────────────────────────────────────────
app.post('/api/admin/send-bilans', async (req, res) => {
  const apikey = req.headers['x-admin-key'] || req.body.adminKey || req.query.adminKey;
  if (!process.env.ADMIN_SECRET_KEY || apikey !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({error: 'Non autorise'});

  try {
    const {data: tenants} = await supabaseAdmin
      .from('tenants')
      .select('id,nom,telephone,instance_name,timezone')
      .eq('statut', 'actif');
    if (!tenants || !tenants.length) return res.json({message: 'Aucun tenant actif', count: 0});

    let count = 0;
    for (const tenant of tenants) {
      await envoyerBilanTenant(tenant);
      count++;
    }
    res.json({message: `Bilans envoyés à ${count} tenant(s)`, count});
  } catch(e) {
    console.error('[ERROR]', e.message);
    res.status(500).json({error: 'Erreur interne'});
  }
});

// ─── Facebook Messenger Webhook ──────────────────────────────────────────────
const FB_VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN || 'titanex-fb-2026';

// GET — Meta webhook verification
app.get('/webhook/facebook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
    console.log('[FB WEBHOOK] Verification OK');
    return res.status(200).send(challenge);
  }
  console.log('[FB WEBHOOK] Verification FAILED — token mismatch');
  res.sendStatus(403);
});

// POST — Receive messages from Facebook Messenger
app.post('/webhook/facebook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== 'page') return;
    for (const entry of (body.entry || [])) {
      for (const event of (entry.messaging || [])) {
        const senderId = event.sender?.id;
        const message = event.message;
        if (!senderId || !message || !message.text || message.is_echo) continue;
        const txt = message.text;
        console.log('[FB MSG] from:', senderId, 'text:', txt.substring(0, 50));

        // Find tenant by facebook page token config
        const {data: fbConfig} = await supabaseAdmin.from('channel_configs')
          .select('instance_name,config')
          .eq('channel', 'facebook')
          .maybeSingle();
        if (!fbConfig) { console.log('[FB] No facebook config found'); continue; }
        const instance = fbConfig.instance_name;
        const pageToken = fbConfig.config?.page_token || process.env.FACEBOOK_PAGE_TOKEN || '';
        if (!pageToken) { console.log('[FB] No page token configured'); continue; }

        // Check tenant status (same guard as WhatsApp)
        const {data: tenantData} = await supabaseAdmin.from('tenants')
          .select('agent_mode,statut,date_fin,credits')
          .eq('instance_name', instance).maybeSingle();
        if (!tenantData) continue;
        if (tenantData.agent_mode === 'inactif') continue;
        const isBlocked = tenantData.statut === 'expiré' || tenantData.statut === 'suspendu' ||
          (tenantData.statut === 'essai' && tenantData.date_fin && new Date(tenantData.date_fin) < new Date());
        if (isBlocked) {
          await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: {id: senderId},
            message: {text: '⚠️ Ce service est temporairement indisponible. Contactez le marchand.'}
          }, {params: {access_token: pageToken}}).catch(() => {});
          continue;
        }
        if (typeof tenantData.credits === 'number' && tenantData.credits <= 0) {
          await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: {id: senderId},
            message: {text: '⚠️ Service temporairement suspendu. Contactez le marchand.'}
          }, {params: {access_token: pageToken}}).catch(() => {});
          continue;
        }

        // Load store + catalogue
        const {data: store} = await supabaseAdmin.from('stores')
          .select('catalog_details,system_prompt').eq('instance_name', instance).single();
        if (!store) continue;
        const {data: produits} = await supabaseAdmin.from('catalogue')
          .select('nom,description,prix,stock,image_url').eq('instance_name', instance);
        const catalogueTexte = (produits || []).map(p =>
          '• ' + p.nom + (p.prix ? ' — ' + p.prix + ' FCFA' : '') + ' | ' + (p.stock > 0 ? 'disponible' : 'épuisé')
        ).join('\n') + '\n\nDÉTAILS:\n' + (produits || []).map(p =>
          '• ' + p.nom + ': ' + (p.description || 'Pas de description')
        ).join('\n');

        // Load conversation history
        const {data: convData} = await supabaseAdmin.from('conversations')
          .select('messages').eq('phone', 'fb_' + senderId).eq('instance', instance).maybeSingle();
        const history = (convData?.messages || []).slice(-10);
        const messagesForAI = history.map(m => ({role: m.role, content: m.content}));
        messagesForAI.push({role: 'user', content: txt});

        // AI response via Groq
        const systemPrompt = (store.system_prompt || 'Tu es un assistant commercial.') +
          '\n\nCATALOGUE:\n' + (catalogueTexte || 'Aucun produit.');
        let reply = '';
        try {
          const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            messages: [{role: 'system', content: systemPrompt}, ...messagesForAI],
            max_tokens: 800, temperature: 0.7
          }, {headers: {Authorization: 'Bearer ' + process.env.GROQ_API_KEY}});
          reply = aiRes.data.choices[0].message.content.trim();
        } catch(aiErr) {
          console.error('[FB AI ERROR]', aiErr.message);
          reply = 'Bonjour ! Je reviens vers vous dans un instant. 🙏';
        }

        // Send reply via Facebook
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
          recipient: {id: senderId},
          message: {text: reply}
        }, {params: {access_token: pageToken}});
        console.log('[FB SENT] OK to', senderId);

        // Decrement credit
        await supabaseAdmin.rpc('decrement_credit', {p_instance: instance}).catch(() => {});

        // Save conversation
        const newMsgs = [...(convData?.messages || []),
          {role: 'user', content: txt, channel: 'facebook', timestamp: new Date().toISOString()},
          {role: 'assistant', content: reply, channel: 'facebook', timestamp: new Date().toISOString()}
        ];
        if (convData) {
          await supabaseAdmin.from('conversations').update({messages: newMsgs, updated_at: new Date().toISOString()})
            .eq('phone', 'fb_' + senderId).eq('instance', instance);
        } else {
          await supabaseAdmin.from('conversations').insert({
            phone: 'fb_' + senderId, instance, messages: newMsgs,
            contact_name: 'Facebook User', channel: 'facebook'
          });
        }
      }
    }
  } catch(e) {
    console.error('[FB WEBHOOK ERROR]', e.message);
  }
});

// ─── Facebook config save endpoint ───────────────────────────────────────────
app.post('/api/facebook/config', authJWT, async (req, res) => {
  try {
    const {page_token, instance} = req.body;
    if (!page_token) return res.status(400).json({error: 'page_token requis'});
    const inst = instance || req.user.instance_name;
    // Upsert into channel_configs
    const {error} = await supabaseAdmin.from('channel_configs').upsert({
      instance_name: inst, channel: 'facebook',
      config: {page_token}, updated_at: new Date().toISOString()
    }, {onConflict: 'instance_name,channel'});
    if (error) throw new Error(error.message);
    res.json({success: true});
  } catch(e) {
    console.error('[FB CONFIG ERROR]', e.message);
    res.status(500).json({error: e.message});
  }
});

app.listen(PORT,"0.0.0.0",()=>console.log("Titanex AI actif sur le port "+PORT));
