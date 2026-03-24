"use strict";
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const router = express.Router();
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || "titanex-admin-2026";
const auth = (req, res, next) => { if (req.headers["x-admin-key"] !== ADMIN_KEY) return res.status(401).json({ error: "Non autorise" }); next(); };
router.get("/tenants", auth, async (req, res) => { const { data, error } = await supabaseAdmin.from("tenants").select("*").order("created_at", { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
router.post("/tenants", auth, async (req, res) => { const { nom, email, telephone, instance_name, plan } = req.body; if (!nom || !email || !instance_name) return res.status(400).json({ error: "Champs requis manquants" }); const { data, error } = await supabaseAdmin.from("tenants").insert({ nom, email, telephone, instance_name, plan: plan || "basic", statut: "essai", date_debut: new Date().toISOString() }).select().single(); if (error) return res.status(500).json({ error: error.message }); await supabaseAdmin.from("stores").insert({ instance_name, tenant_id: data.id, system_prompt: "Tu es un agent de vente IA pour " + nom + ". Reponds en francais, sois poli et vends efficacement.", catalog_details: "Catalogue en cours de configuration." }); res.json({ success: true, tenant: data }); });
router.patch("/tenants/:id/statut", auth, async (req, res) => { const { statut } = req.body; if (!["actif","inactif","suspendu","essai"].includes(statut)) return res.status(400).json({ error: "Statut invalide" }); const { data, error } = await supabaseAdmin.from("tenants").update({ statut }).eq("id", req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json({ success: true, tenant: data }); });
router.delete("/tenants/:id", auth, async (req, res) => { const { error } = await supabaseAdmin.from("tenants").delete().eq("id", req.params.id); if (error) return res.status(500).json({ error: error.message }); res.json({ success: true }); });

router.get("/catalogue/:instance", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("catalogue").select("*").eq("instance_name", req.params.instance).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
router.post("/catalogue", async (req, res) => {
  const { instance_name, nom, description, prix, stock, image_url } = req.body;
  if (!instance_name || !nom) return res.status(400).json({ error: "instance_name et nom requis" });
  const { data, error } = await supabaseAdmin.from("catalogue").insert({ instance_name, nom, description, prix, stock: stock || 100, image_url }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, produit: data });
});
router.delete("/catalogue/:id", async (req, res) => {
  const { error } = await supabaseAdmin.from("catalogue").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});


router.post("/ai/description", async (req, res) => {
  const { nom, categorie } = req.body;
  if (!nom) return res.status(400).json({ error: "nom requis" });
  try {
    const r = await require("axios").post("https://api.groq.com/openai/v1/chat/completions", {
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: "Ecris une description commerciale courte et percutante (2-3 phrases max) pour ce produit: " + nom + (categorie ? " (categorie: " + categorie + ")" : "") + ". Public cible: acheteurs africains francophones. Sois direct et mets en valeur les benefices. Ne mets pas de guillemets." }],
      max_tokens: 150
    }, { headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY } });
    res.json({ text: r.data.choices[0].message.content.trim() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


router.patch("/catalogue/:id", async (req, res) => {
  const { nom, description, prix, stock, image_url } = req.body;
  const update = {};
  if(nom !== undefined) update.nom = nom;
  if(description !== undefined) update.description = description;
  if(prix !== undefined) update.prix = prix;
  if(stock !== undefined) update.stock = stock;
  if(image_url !== undefined) update.image_url = image_url;
  update.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("catalogue").update(update).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, produit: data });
});
router.post("/catalogue/:id/dup", async (req, res) => {
  const { data: orig, error: e1 } = await supabaseAdmin.from("catalogue").select("*").eq("id", req.params.id).single();
  if (e1) return res.status(500).json({ error: e1.message });
  const { id, created_at, ...copy } = orig;
  copy.nom = copy.nom + " (copie)";
  const { data, error } = await supabaseAdmin.from("catalogue").insert(copy).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, produit: data });
});


router.get("/catalogue/:id/get", async (req, res) => {
  const { data, error } = await supabaseAdmin.from("catalogue").select("*").eq("id", req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});


// Setup profil après inscription
router.patch('/tenants/:id/setup', async (req, res) => {
  try {
    const { nom, telephone, plan, system_prompt } = req.body;
    const { data, error } = await supabaseAdmin.from('tenants').update({ nom, telephone, plan }).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    if (system_prompt) {
      await supabaseAdmin.from('stores').update({ system_prompt }).eq('instance_name', data.instance_name);
    }
    res.json({ success: true, tenant: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Routes /api/admin/* (superadmin dashboard) ──────────────────────────────

// Stats globales
router.get('/stats', auth, async (req, res) => {
  try {
    const { data: tenants } = await supabaseAdmin.from('tenants').select('id,email,statut,plan');
    const { data: convs } = await supabaseAdmin.from('conversations').select('id');
    res.json({
      users: (tenants||[]).length,
      points_used: 0,
      points_total: 0,
      referrals: 0,
      visites: (convs||[]).length
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Liste utilisateurs
router.get('/users', auth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('tenants').select('id,email,telephone,created_at,updated_at,nom,statut,plan,role,instance_name,date_debut,date_fin,prix_mensuel,moyen_paiement').order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data||[]).map(t => ({
      id: t.id,
      email: t.email,
      phone: t.telephone,
      nom: t.nom || '',
      created_at: t.created_at,
      last_login: t.updated_at || t.created_at,
      credits: 0,
      agents: 1,
      plan: t.plan || 'starter',
      role: t.role === 'admin' ? 'admin' : 'user',
      statut: t.statut,
      instance_name: t.instance_name,
      date_debut: t.date_debut,
      date_fin: t.date_fin,
      prix_mensuel: t.prix_mensuel,
      moyen_paiement: t.moyen_paiement || '—'
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Suspendre utilisateur
router.post('/users/:id/suspend', auth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('tenants').update({ statut: 'suspendu' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Ajouter des crédits (statut actif + prolongation date_fin)
router.post('/users/:id/credits', auth, async (req, res) => {
  try {
    const { days } = req.body;
    const dateFin = new Date(Date.now() + ((Number(days)||30) * 24 * 60 * 60 * 1000));
    const { error } = await supabaseAdmin.from('tenants').update({ statut: 'actif', date_fin: dateFin.toISOString().split('T')[0] }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true, date_fin: dateFin.toISOString().split('T')[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Codes promos
router.get('/promo-codes', auth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('promo_codes').select('*').order('created_at', { ascending: false });
    res.json(data || []);
  } catch(e) { res.json([]); }
});

router.post('/promo-codes', auth, async (req, res) => {
  try {
    const { code, reduction, expiration, max } = req.body;
    if (!code || !reduction) return res.status(400).json({ error: 'code et reduction requis' });
    const { data, error } = await supabaseAdmin.from('promo_codes').insert({ code: code.toUpperCase(), reduction: Number(reduction), expiration: expiration||null, max: max||null, used: 0 }).select().single();
    if (error) throw error;
    res.json({ success: true, promo: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/promo-codes/:id', auth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('promo_codes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Activer un tenant (statut actif + date_fin +30j)
router.post('/users/:id/activate', auth, async (req, res) => {
  try {
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const { error } = await supabaseAdmin.from('tenants').update({
      statut: 'actif',
      date_fin: dateFin.toISOString().split('T')[0]
    }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true, statut: 'actif', date_fin: dateFin.toISOString().split('T')[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;


// Route publique — infos tenant par ID (pour page paiement)
router.get('/tenant/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id,nom,telephone,instance_name,plan,statut,date_fin')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Introuvable' });
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Route QR — proxifie Evolution API
// Gère 3 cas : instance inexistante (404) → crée ; instance connectée → déconnecte ; retourne QR
router.get('/qr/:instance', async (req, res) => {
  const axios = require('axios');
  const EVO_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
  const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
  const instance = req.params.instance;

  async function getQR() {
    const r = await axios.get(EVO_URL + '/instance/connect/' + instance, {
      headers: { apikey: EVO_KEY }
    });
    return r.data;
  }

  async function createInstance() {
    await axios.post(EVO_URL + '/instance/create', {
      instanceName: instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true
    }, { headers: { apikey: EVO_KEY } });
    await new Promise(r => setTimeout(r, 2000));
  }

  async function logoutInstance() {
    await axios.delete(EVO_URL + '/instance/logout/' + instance, {
      headers: { apikey: EVO_KEY }
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
  }

  try {
    let data = await getQR();

    // Instance connectée → déconnecter pour forcer un nouveau QR
    if (!data.base64 && !data.code) {
      const state = (data.instance && data.instance.state) || data.state || '';
      if (state === 'open' || state === 'connecting') {
        await logoutInstance();
        data = await getQR();
      }
    }

    res.json({ base64: data.base64 || null, code: data.code || null });
  } catch(e) {
    // Instance inexistante (404) → créer puis récupérer QR
    if (e.response && e.response.status === 404) {
      try {
        await createInstance();
        const data = await getQR();
        return res.json({ base64: data.base64 || null, code: data.code || null });
      } catch(e2) {
        return res.json({ error: e2.message });
      }
    }
    res.json({ error: e.message });
  }
});

router.post('/qr/:instance/logout', async (req, res) => {
  try {
    const axios = require('axios');
    const EVO_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
    const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
    await axios.delete(EVO_URL + '/instance/logout/' + req.params.instance, {
      headers: { apikey: EVO_KEY }
    });
    res.json({ success: true });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

router.post('/qr/:instance/refresh', async (req, res) => {
  try {
    const axios = require('axios');
    const EVO_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
    const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
    await axios.delete(EVO_URL + '/instance/logout/' + req.params.instance, {
      headers: { apikey: EVO_KEY }
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    const r = await axios.get(EVO_URL + '/instance/connect/' + req.params.instance, {
      headers: { apikey: EVO_KEY }
    });
    res.json({ base64: r.data.base64 || null, code: r.data.code || null });
  } catch(e) {
    res.json({ error: e.message });
  }
});

router.get('/qr/:instance/status', async (req, res) => {
  try {
    const EVO_URL = (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/$/, '');
    const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
    const r = await require('axios').get(EVO_URL + '/instance/connectionState/' + req.params.instance, {
      headers: { apikey: EVO_KEY }
    });
    const state = (r.data && r.data.instance && r.data.instance.state) || r.data.state || '';
    res.json({ connected: state === 'open' });
  } catch(e) {
    res.json({ connected: false });
  }
});

// Stats globales super admin
router.get('/stats', auth, async (req, res) => {
  try {
    const { data: tenants } = await supabaseAdmin.from('tenants').select('*');
    const { data: convs } = await supabaseAdmin.from('conversations').select('id,instance,created_at');
    const plans = { starter: 9900, pro: 24900, business: 49900 };
    const t = tenants || [];
    const actifs = t.filter(x => x.statut === 'actif');
    const mrr = actifs.reduce((s, x) => s + (plans[x.plan] || 24900), 0);
    const now = new Date();
    const thisMonth = (convs || []).filter(c => new Date(c.created_at).getMonth() === now.getMonth()).length;
    res.json({ tenants_total: t.length, actifs: actifs.length, essais: t.filter(x => x.statut === 'essai').length, suspendus: t.filter(x => x.statut === 'suspendu').length, mrr, arr: mrr * 12, conversations_total: (convs || []).length, conversations_ce_mois: thisMonth, tenants: t });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Toutes les conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('conversations').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Conversations par instance (dashboard client)
router.get('/conversations/:instance', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('conversations').select('*').eq('instance', req.params.instance).order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Envoyer message WhatsApp depuis admin
router.post('/send-message', auth, async (req, res) => {
  try {
    const { instance, number, text } = req.body;
    if (!instance || !number || !text) return res.status(400).json({ error: 'instance, number, text requis' });
    const EVO_URL = (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/$/, '');
    const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
    await require('axios').post(EVO_URL + '/message/sendText/' + instance, { number: number.includes('@') ? number : number + '@s.whatsapp.net', text }, { headers: { apikey: EVO_KEY } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Changer mode agent/humain
router.patch('/tenants/:id/mode', auth, async (req, res) => {
  try {
    const { mode } = req.body;
    if (!['agent', 'humain'].includes(mode)) return res.status(400).json({ error: 'mode invalide' });
    const { data, error } = await supabaseAdmin.from('tenants').update({ mode }).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ success: true, tenant: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Infos tenant par ID (page paiement)
router.get('/tenant/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('tenants').select('id,nom,telephone,instance_name,plan,statut,date_fin').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Introuvable' });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Setup profil après inscription
router.patch('/tenants/:id/setup', async (req, res) => {
  try {
    const { nom, telephone, plan, system_prompt } = req.body;
    const { data, error } = await supabaseAdmin.from('tenants').update({ nom, telephone, plan }).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    if (system_prompt) {
      await supabaseAdmin.from('stores').update({ system_prompt }).eq('instance_name', data.instance_name);
    }
    res.json({ success: true, tenant: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;


// ── Auth login tenant ─────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { email, telephone } = req.body;
  if (!email && !telephone) return res.status(400).json({ error: 'Email ou téléphone requis' });
  try {
    let query = supabaseAdmin.from('tenants').select('id,nom,email,telephone,instance_name,plan,statut,date_fin');
    if (email) query = query.ilike('email', email.trim());
    else query = query.eq('telephone', telephone.trim());
    const { data, error } = await query.single();
    if (error || !data) return res.status(404).json({ error: 'Compte introuvable. Vérifiez vos informations.' });
    if (data.statut === 'suspendu') return res.status(403).json({ error: 'Compte suspendu. Contactez le support.' });
    res.json({ success: true, session: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Stats tenant (pour dashboard marchand) ────────────────────────────────
router.get('/tenant-stats/:instance', async (req, res) => {
  try {
    const instance = req.params.instance;
    const [convs, prods] = await Promise.all([
      supabaseAdmin.from('conversations').select('id', { count: 'exact' }).eq('instance', instance),
      supabaseAdmin.from('catalogue').select('id', { count: 'exact' }).eq('instance_name', instance)
    ]);
    res.json({
      conversations: convs.count || 0,
      produits: prods.count || 0
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Auth admin
router.post('/auth/admin-login', (req, res) => {
  const { password } = req.body;
  const ADMIN_PW = process.env.ADMIN_SECRET_KEY || 'titanex-admin-2026';
  if (password !== ADMIN_PW) return res.status(401).json({ error: 'Mot de passe incorrect' });
  res.json({ success: true });
});

// Conversations (admin)
router.get('/conversations', auth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const { data, error } = await supabaseAdmin
    .from('conversations').select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Comptage conversations
router.get('/conv-count', auth, async (req, res) => {
  const { count, error } = await supabaseAdmin
    .from('conversations').select('*', { count: 'exact', head: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ count: count || 0 });
});

// Instances WhatsApp
router.get('/instances', auth, async (req, res) => {
  try {
    const axios = require('axios');
    const r = await axios.get(process.env.EVOLUTION_API_URL + '/instance/fetchInstances', {
      headers: { apikey: process.env.EVOLUTION_API_KEY }
    });
    res.json(r.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Instances WhatsApp
router.get('/instances', auth, async (req, res) => {
  try {
    const axios = require('axios');
    const r = await axios.get(process.env.EVOLUTION_API_URL + '/instance/fetchInstances', {
      headers: { apikey: process.env.EVOLUTION_API_KEY }
    });
    res.json(r.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/instances', auth, async (req, res) => {
  try {
    const axios = require('axios');
    const r = await axios.get(process.env.EVOLUTION_API_URL + '/instance/fetchInstances', { headers: { apikey: process.env.EVOLUTION_API_KEY } });
    res.json(r.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
