"use strict";
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error("FATAL: JWT_SECRET env var is required"); process.exit(1); }
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY;
if (!ADMIN_KEY) { console.error("FATAL: ADMIN_SECRET_KEY env var is required"); process.exit(1); }
const auth = (req, res, next) => { if (req.headers["x-admin-key"] !== ADMIN_KEY) return res.status(401).json({ error: "Non autorise" }); next(); };
// Accepts admin key OR valid JWT (sets req.tenantInstance for scope checks)
const authOrJWT = (req, res, next) => {
  if (req.headers["x-admin-key"] === ADMIN_KEY) { req.isAdmin = true; return next(); }
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: "Non autorise" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.tenantInstance = decoded.instance_name;
    req.isAdmin = false;
    next();
  } catch(e) { return res.status(401).json({ error: "Token invalide ou expire" }); }
};
router.get("/tenants", auth, async (req, res) => { const { data, error } = await supabaseAdmin.from("tenants").select("*").order("created_at", { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
router.post("/tenants", auth, async (req, res) => { const { nom, email, telephone, instance_name, plan } = req.body; if (!nom || !email || !instance_name) return res.status(400).json({ error: "Champs requis manquants" }); const { data, error } = await supabaseAdmin.from("tenants").insert({ nom, email, telephone, instance_name, plan: plan || "basic", statut: "essai", date_debut: new Date().toISOString() }).select().single(); if (error) return res.status(500).json({ error: error.message }); await supabaseAdmin.from("stores").insert({ instance_name, tenant_id: data.id, system_prompt: "Tu es un agent de vente IA pour " + nom + ". Reponds en francais, sois poli et vends efficacement.", catalog_details: "Catalogue en cours de configuration." }); res.json({ success: true, tenant: data }); });
router.patch("/tenants/:id/statut", auth, async (req, res) => { const { statut } = req.body; if (!["actif","inactif","suspendu","essai","expiré","bloqué","banni"].includes(statut)) return res.status(400).json({ error: "Statut invalide" }); const { data, error } = await supabaseAdmin.from("tenants").update({ statut }).eq("id", req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json({ success: true, tenant: data }); });
router.delete("/tenants/:id", auth, async (req, res) => { const { error } = await supabaseAdmin.from("tenants").delete().eq("id", req.params.id); if (error) return res.status(500).json({ error: error.message }); res.json({ success: true }); });

router.get("/catalogue/:instance", authOrJWT, async (req, res) => {
  if (!req.isAdmin && req.tenantInstance !== req.params.instance) return res.status(403).json({ error: "Acces interdit" });
  const { data, error } = await supabaseAdmin.from("catalogue").select("*").eq("instance_name", req.params.instance).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
router.post("/catalogue", authOrJWT, async (req, res) => {
  const { instance_name, nom, description, prix, stock, image_url, categorie, devise, prompt, type_produit, variants } = req.body;
  if (!instance_name || !nom) return res.status(400).json({ error: "instance_name et nom requis" });
  if (!req.isAdmin && req.tenantInstance !== instance_name) return res.status(403).json({ error: "Acces interdit" });
  const row = { instance_name, nom, description, prix, stock: stock || 100, image_url };
  if (categorie !== undefined) row.categorie = categorie;
  if (devise !== undefined) row.devise = devise;
  if (prompt !== undefined) row.prompt = prompt;
  if (type_produit !== undefined) row.type_produit = type_produit;
  if (variants !== undefined) row.variantes = variants;
  const { data, error } = await supabaseAdmin.from("catalogue").insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, produit: data });
});
router.delete("/catalogue/:id", authOrJWT, async (req, res) => {
  const { error } = await supabaseAdmin.from("catalogue").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});


router.post("/ai/description", authOrJWT, async (req, res) => {
  const { nom, categorie, instructions } = req.body;
  if (!nom) return res.status(400).json({ error: "nom requis" });
  try {
    let prompt = "Ecris une description commerciale courte et percutante (2-3 phrases max) pour ce produit: " + nom + (categorie ? " (categorie: " + categorie + ")" : "") + ". Public cible: acheteurs africains francophones. Sois direct et mets en valeur les benefices. Ne mets pas de guillemets.";
    if (instructions) prompt += " Instructions supplementaires du vendeur: " + instructions;
    const r = await require("axios").post("https://api.groq.com/openai/v1/chat/completions", {
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150
    }, { headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY } });
    res.json({ text: r.data.choices[0].message.content.trim() });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});


router.patch("/catalogue/:id", authOrJWT, async (req, res) => {
  const { nom, description, prix, stock, image_url, categorie, devise, prompt, type_produit, variants } = req.body;
  const update = {};
  if(nom !== undefined) update.nom = nom;
  if(description !== undefined) update.description = description;
  if(prix !== undefined) update.prix = prix;
  if(stock !== undefined) update.stock = stock;
  if(image_url !== undefined) update.image_url = image_url;
  if(categorie !== undefined) update.categorie = categorie;
  if(devise !== undefined) update.devise = devise;
  if(prompt !== undefined) update.prompt = prompt;
  if(type_produit !== undefined) update.type_produit = type_produit;
  if(variants !== undefined) update.variantes = variants;
  update.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("catalogue").update(update).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, produit: data });
});
router.post("/catalogue/:id/dup", authOrJWT, async (req, res) => {
  const { data: orig, error: e1 } = await supabaseAdmin.from("catalogue").select("*").eq("id", req.params.id).single();
  if (e1) return res.status(500).json({ error: e1.message });
  const { id, created_at, ...copy } = orig;
  copy.nom = copy.nom + " (copie)";
  const { data, error } = await supabaseAdmin.from("catalogue").insert(copy).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, produit: data });
});


// ─── Categories ─────────────────────────────────────────────────────────────
router.get("/categories/:instance", authOrJWT, async (req, res) => {
  if (!req.isAdmin && req.tenantInstance !== req.params.instance) return res.status(403).json({ error: "Acces interdit" });
  try {
    // Merge: distinct categories from catalogue + custom categories table
    const { data: fromCatalogue } = await supabaseAdmin.from("catalogue").select("categorie").eq("instance_name", req.params.instance).not("categorie", "is", null);
    const catalogueCats = [...new Set((fromCatalogue || []).map(r => r.categorie).filter(Boolean))];
    const { data: custom } = await supabaseAdmin.from("categories").select("name").eq("instance_name", req.params.instance).order("created_at", { ascending: true });
    const customCats = (custom || []).map(r => r.name);
    const all = [...new Set([...catalogueCats, ...customCats])].map(name => ({ name }));
    res.json(all);
  } catch(e) {
    // If categories table doesn't exist yet, just return catalogue categories
    const { data: fromCatalogue } = await supabaseAdmin.from("catalogue").select("categorie").eq("instance_name", req.params.instance).not("categorie", "is", null);
    const cats = [...new Set((fromCatalogue || []).map(r => r.categorie).filter(Boolean))].map(name => ({ name }));
    res.json(cats);
  }
});
router.post("/categories", authOrJWT, async (req, res) => {
  const { name, instance_name } = req.body;
  if (!name || !instance_name) return res.status(400).json({ error: "name et instance_name requis" });
  if (!req.isAdmin && req.tenantInstance !== instance_name) return res.status(403).json({ error: "Acces interdit" });
  try {
    const { data, error } = await supabaseAdmin.from("categories").insert({ name, instance_name }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, category: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get("/catalogue/:id/get", authOrJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin.from("catalogue").select("*").eq("id", req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});


// Setup profil après inscription
router.patch('/tenants/:id/setup', auth, async (req, res) => {
  try {
    const { nom, telephone, plan, system_prompt } = req.body;
    const { data, error } = await supabaseAdmin.from('tenants').update({ nom, telephone, plan }).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    if (system_prompt) {
      await supabaseAdmin.from('stores').update({ system_prompt }).eq('instance_name', data.instance_name);
    }
    res.json({ success: true, tenant: data });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── Routes /api/admin/* (superadmin dashboard) ──────────────────────────────

// Stats globales
// Route /stats legacy supprimée — voir route complète plus bas

// Liste utilisateurs
router.get('/users', auth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('tenants').select('id,email,telephone,created_at,updated_at,nom,statut,plan,role,instance_name,date_debut,date_fin,prix_mensuel,moyen_paiement,credits,credits_max,credits_used').order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data||[]).map(t => ({
      id: t.id,
      email: t.email,
      phone: t.telephone,
      nom: t.nom || '',
      created_at: t.created_at,
      last_login: t.updated_at || t.created_at,
      credits: t.credits || 0,
      credits_max: t.credits_max || 3000,
      credits_used: t.credits_used || 0,
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
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// Suspendre utilisateur
router.post('/users/:id/suspend', auth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('tenants').update({ statut: 'suspendu' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// Ajouter des crédits (statut actif + prolongation date_fin)
router.post('/users/:id/credits', auth, async (req, res) => {
  try {
    const { days } = req.body;
    const dateFin = new Date(Date.now() + ((Number(days)||30) * 24 * 60 * 60 * 1000));
    const { error } = await supabaseAdmin.from('tenants').update({ statut: 'actif', date_fin: dateFin.toISOString().split('T')[0] }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true, date_fin: dateFin.toISOString().split('T')[0] });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
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
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

router.delete('/promo-codes/:id', auth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('promo_codes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
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
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── Stats visites (données réelles) ────────────────────────────────────────
router.get('/stats/visits', auth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data: visits, error } = await supabaseAdmin
      .from('visits')
      .select('device,os,source,created_at')
      .gte('created_at', since);
    if (error) throw new Error(error.message);

    const v = visits || [];
    const total = v.length;

    // Count by device
    const byDevice = {};
    v.forEach(r => { byDevice[r.device] = (byDevice[r.device] || 0) + 1; });

    // Count by source
    const bySource = {};
    v.forEach(r => { bySource[r.source] = (bySource[r.source] || 0) + 1; });

    // Count by OS
    const byOS = {};
    v.forEach(r => { byOS[r.os] = (byOS[r.os] || 0) + 1; });

    // Visits per day for chart
    const byDay = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      byDay[d.toISOString().slice(0, 10)] = 0;
    }
    v.forEach(r => {
      const day = (r.created_at || '').slice(0, 10);
      if (byDay[day] !== undefined) byDay[day]++;
    });

    res.json({ total, byDevice, bySource, byOS, byDay });
  } catch (e) {
    console.error('[ERROR]', e.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// ─── Stats pays (données réelles par téléphone) ─────────────────────────────
const PHONE_PREFIXES = [
  { prefix: '237', pays: 'Cameroun',       flag: '🇨🇲', iso: 'cm' },
  { prefix: '33',  pays: 'France',         flag: '🇫🇷', iso: 'fr' },
  { prefix: '1',   pays: 'États-Unis',     flag: '🇺🇸', iso: 'us' },
  { prefix: '44',  pays: 'Royaume-Uni',    flag: '🇬🇧', iso: 'gb' },
  { prefix: '221', pays: 'Sénégal',        flag: '🇸🇳', iso: 'sn' },
  { prefix: '225', pays: 'Côte d\'Ivoire', flag: '🇨🇮', iso: 'ci' },
  { prefix: '229', pays: 'Bénin',          flag: '🇧🇯', iso: 'bj' },
  { prefix: '228', pays: 'Togo',           flag: '🇹🇬', iso: 'tg' },
  { prefix: '32',  pays: 'Belgique',       flag: '🇧🇪', iso: 'be' },
  { prefix: '212', pays: 'Maroc',          flag: '🇲🇦', iso: 'ma' },
  { prefix: '243', pays: 'RD Congo',       flag: '🇨🇩', iso: 'cd' },
  { prefix: '241', pays: 'Gabon',          flag: '🇬🇦', iso: 'ga' },
  { prefix: '242', pays: 'Congo',          flag: '🇨🇬', iso: 'cg' },
  { prefix: '235', pays: 'Tchad',          flag: '🇹🇩', iso: 'td' },
  { prefix: '226', pays: 'Burkina Faso',   flag: '🇧🇫', iso: 'bf' },
  { prefix: '223', pays: 'Mali',           flag: '🇲🇱', iso: 'ml' },
  { prefix: '234', pays: 'Nigeria',        flag: '🇳🇬', iso: 'ng' },
  { prefix: '41',  pays: 'Suisse',         flag: '🇨🇭', iso: 'ch' },
  { prefix: '49',  pays: 'Allemagne',      flag: '🇩🇪', iso: 'de' },
];

function detectPays(telephone) {
  if (!telephone) return { pays: 'Autre', flag: '🌍', iso: 'xx' };
  const clean = String(telephone).replace(/[\s\-\+\(\)]/g, '');
  // Sort by prefix length descending to match longest first (e.g. 237 before 23)
  const sorted = PHONE_PREFIXES.slice().sort((a, b) => b.prefix.length - a.prefix.length);
  for (const entry of sorted) {
    if (clean.startsWith(entry.prefix)) return entry;
  }
  return { pays: 'Autre', flag: '🌍', iso: 'xx' };
}

router.get('/stats/pays', auth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    // Try with pays column, fallback to telephone only
    let tenants;
    const { data: t1, error: e1 } = await supabaseAdmin
      .from('tenants')
      .select('telephone,pays,created_at')
      .gte('created_at', since);
    if (e1 && e1.message && e1.message.includes('pays')) {
      // pays column doesn't exist, query without it
      const { data: t2 } = await supabaseAdmin
        .from('tenants')
        .select('telephone,created_at')
        .gte('created_at', since);
      tenants = t2;
    } else {
      tenants = t1;
    }

    const counts = {};
    (tenants || []).forEach(t => {
      let info;
      if (t.pays) {
        const found = PHONE_PREFIXES.find(p => p.pays === t.pays);
        info = found || { pays: t.pays, flag: '🌍', iso: 'xx' };
      } else {
        info = detectPays(t.telephone);
      }
      const key = info.pays;
      if (!counts[key]) counts[key] = { pays: info.pays, flag: info.flag, iso: info.iso, count: 0 };
      counts[key].count++;
    });

    const result = Object.values(counts)
      .filter(p => p.iso !== 'xx')
      .sort((a, b) => b.count - a.count)
      .map((p, i) => ({ ...p, rang: i + 1 }));

    res.json(result);
  } catch (e) {
    console.error('[ERROR]', e.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// ─── Stats réseaux sociaux (données réelles Supabase) ─────────────────────────
router.get('/stats/social', auth, async (req, res) => {
  try {
    // Compte les messages WhatsApp réels depuis la table messages
    const { count: msgCount } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('direction', 'inbound');

    // Compte les conversations uniques
    const { count: convCount } = await supabaseAdmin
      .from('conversations')
      .select('*', { count: 'exact', head: true });

    // Compte les contacts uniques WhatsApp
    const { data: uniquePhones } = await supabaseAdmin
      .from('messages')
      .select('client_phone')
      .eq('direction', 'inbound');
    const uniqueContacts = new Set((uniquePhones||[]).map(r => r.client_phone)).size;

    // Toutes les plateformes avec scores réels (0 si pas de données)
    const platforms = [
      { label: 'WhatsApp', icon: '💚', color: '#25D366', score: msgCount || 0, detail: `${uniqueContacts} contact(s) unique(s)` },
      { label: 'Facebook', icon: '📘', color: '#1877F2', score: 0, detail: 'Non connecté' },
      { label: 'Instagram', icon: '📸', color: '#E1306C', score: 0, detail: 'Non connecté' },
      { label: 'Messenger', icon: '💬', color: '#0084FF', score: 0, detail: 'Non connecté' },
      { label: 'Telegram', icon: '✈️', color: '#0088CC', score: 0, detail: 'Non connecté' },
      { label: 'TikTok', icon: '🎵', color: '#010101', score: 0, detail: 'Non connecté' },
      { label: 'YouTube', icon: '📺', color: '#FF0000', score: 0, detail: 'Non connecté' },
      { label: 'LinkedIn', icon: '💼', color: '#0A66C2', score: 0, detail: 'Non connecté' },
      { label: 'Twitter/X', icon: '🐦', color: '#1DA1F2', score: 0, detail: 'Non connecté' },
      { label: 'Google', icon: '🔍', color: '#4285F4', score: 0, detail: 'Non connecté' }
    ];

    res.json({
      platforms,
      total: msgCount || 0,
      conversations: convCount || 0,
      unique_contacts: uniqueContacts,
      source: 'supabase_messages',
      updated_at: new Date().toISOString()
    });
  } catch(e) {
    console.error('[ERROR]', e.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;


// Route publique — infos tenant par ID (pour page paiement)
router.get('/tenant/:id', auth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id,nom,telephone,instance_name,plan,statut,date_fin')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Introuvable' });
    res.json(data);
  } catch(e) {
    console.error('[ERROR]', e.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// Route QR — proxifie Evolution API
// Gère 3 cas : instance inexistante (404) → crée ; instance connectée → déconnecte ; retourne QR
router.get('/qr/:instance', authOrJWT, async (req, res) => {
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

router.post('/qr/:instance/logout', authOrJWT, async (req, res) => {
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

router.post('/qr/:instance/refresh', authOrJWT, async (req, res) => {
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

router.get('/qr/:instance/status', authOrJWT, async (req, res) => {
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

// Stats globales super admin (enhanced with charts data)
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

    // Transactions last 30 days for global revenue chart
    const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();
    const { data: txns } = await supabaseAdmin.from('transactions')
      .select('id,amount,created_at,status,user_id')
      .gte('created_at', thirtyDaysAgo).order('created_at', { ascending: true });

    // Revenue by day (last 30 days)
    const revenueByDay = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      revenueByDay[d.toISOString().slice(0, 10)] = 0;
    }
    (txns || []).filter(tx => tx.status === 'SUCCESSFUL').forEach(tx => {
      const day = (tx.created_at || '').slice(0, 10);
      if (revenueByDay[day] !== undefined) revenueByDay[day] += parseFloat(tx.amount) || 0;
    });

    // Top 5 tenants by conversation count
    const tenantConvCounts = {};
    (convs || []).forEach(c => {
      const inst = c.instance || 'unknown';
      tenantConvCounts[inst] = (tenantConvCounts[inst] || 0) + 1;
    });
    const top5Tenants = Object.entries(tenantConvCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([instance, count]) => {
        const tenant = t.find(x => x.instance_name === instance);
        return { instance, nom: tenant?.nom || instance, conversations: count, plan: tenant?.plan || '—' };
      });

    // Total transactions this month
    const monthTxns = (txns || []).filter(tx => tx.status === 'SUCCESSFUL');
    const totalMonthRevenue = monthTxns.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0);

    // Inscriptions par jour (90 derniers jours)
    const signupsByDay = {};
    for (let i = 89; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      signupsByDay[d.toISOString().slice(0, 10)] = 0;
    }
    t.forEach(tenant => {
      const day = (tenant.created_at || '').slice(0, 10);
      if (signupsByDay[day] !== undefined) signupsByDay[day] += 1;
    });

    // Credits totaux
    const totalCreditsUsed = t.reduce((s, x) => s + (x.credits_used || 0), 0);
    const totalCredits = t.reduce((s, x) => s + (x.credits || 0), 0);

    res.json({
      tenants_total: t.length, actifs: actifs.length,
      essais: t.filter(x => x.statut === 'essai').length,
      suspendus: t.filter(x => x.statut === 'suspendu').length,
      mrr, arr: mrr * 12,
      conversations_total: (convs || []).length,
      conversations_ce_mois: thisMonth,
      tenants: t,
      revenue_by_day: revenueByDay,
      signups_by_day: signupsByDay,
      credits_used_total: totalCreditsUsed,
      credits_remaining_total: totalCredits,
      top5_tenants: top5Tenants,
      total_month_revenue: totalMonthRevenue,
      total_month_transactions: monthTxns.length
    });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// Toutes les conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('conversations').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// Conversations par instance (dashboard client) — "all" renvoie toutes les instances
router.get('/conversations/:instance', async (req, res) => {
  try {
    const inst = req.params.instance;
    let query = supabaseAdmin.from('conversations').select('*').order('updated_at', { ascending: false }).limit(300);
    // Si instance spécifique (pas "all"), filtrer par instance OU instance=null (anciennes données)
    if (inst && inst !== 'all') {
      query = supabaseAdmin.from('conversations').select('*')
        .or(`instance.eq.${inst},instance.is.null`)
        .order('updated_at', { ascending: false }).limit(300);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// Envoyer message WhatsApp depuis admin
router.post('/send-message', authOrJWT, async (req, res) => {
  try {
    const { instance, number, text } = req.body;
    if (!instance || !number || !text) return res.status(400).json({ error: 'instance, number, text requis' });
    const EVO_URL = (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/$/, '');
    const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
    await require('axios').post(EVO_URL + '/message/sendText/' + instance, { number: number.includes('@') ? number : number + '@s.whatsapp.net', text }, { headers: { apikey: EVO_KEY } });
    res.json({ success: true });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// Changer mode agent/humain
router.patch('/tenants/:id/mode', auth, async (req, res) => {
  try {
    const { mode } = req.body;
    if (!['agent', 'humain'].includes(mode)) return res.status(400).json({ error: 'mode invalide' });
    const { data, error } = await supabaseAdmin.from('tenants').update({ mode }).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ success: true, tenant: data });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// Infos tenant par ID (page paiement)
router.get('/tenant/:id', auth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('tenants').select('id,nom,telephone,instance_name,plan,statut,date_fin').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Introuvable' });
    res.json(data);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});


// Setup profil après inscription
router.patch('/tenants/:id/setup', auth, async (req, res) => {
  try {
    const { nom, telephone, plan, system_prompt } = req.body;
    const { data, error } = await supabaseAdmin.from('tenants').update({ nom, telephone, plan }).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    if (system_prompt) {
      await supabaseAdmin.from('stores').update({ system_prompt }).eq('instance_name', data.instance_name);
    }
    res.json({ success: true, tenant: data });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

module.exports = router;


// ── Auth login tenant ─────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { email, telephone } = req.body;
  if (!email && !telephone) return res.status(400).json({ error: 'Email ou téléphone requis' });
  try {
    let query = supabaseAdmin.from('tenants').select('id,nom,email,telephone,instance_name,plan,statut,date_fin,credits,credits_max,credits_used');
    if (email) query = query.ilike('email', email.trim());
    else query = query.eq('telephone', telephone.trim());
    const { data, error } = await query.single();
    if (error || !data) return res.status(404).json({ error: 'Compte introuvable. Vérifiez vos informations.' });
    if (data.statut === 'suspendu') return res.status(403).json({ error: 'Compte suspendu. Contactez le support.' });
    const token = jwt.sign({ id: data.id, email: data.email || "", instance_name: data.instance_name, role: data.role || "client", nom: data.nom }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, session: { ...data, token } });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
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
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
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

// Toutes les transactions (dashboard paiements)
router.get('/transactions', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('transactions').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
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
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// Instances WhatsApp
router.get('/instances', auth, async (req, res) => {
  try {
    const axios = require('axios');
    const r = await axios.get(process.env.EVOLUTION_API_URL + '/instance/fetchInstances', {
      headers: { apikey: process.env.EVOLUTION_API_KEY }
    });
    res.json(r.data);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

router.get('/instances', auth, async (req, res) => {
  try {
    const axios = require('axios');
    const r = await axios.get(process.env.EVOLUTION_API_URL + '/instance/fetchInstances', { headers: { apikey: process.env.EVOLUTION_API_KEY } });
    res.json(r.data);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── POST /stores — Update system_prompt for an instance ─────────────────────
router.post('/stores', async (req, res) => {
  try {
    const { instance_name, system_prompt } = req.body;
    if (!instance_name) return res.status(400).json({ error: 'instance_name requis' });
    const { data, error } = await supabaseAdmin.from('stores').update({ system_prompt }).eq('instance_name', instance_name).select().single();
    if (error) throw new Error(error.message);
    res.json({ success: true, store: data });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── GET /stores — List all stores ───────────────────────────────────────────
router.get('/stores', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('stores').select('*');
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── POST /chat — Playground: send message to Groq with custom prompt ────────
router.post('/chat', async (req, res) => {
  try {
    const { instance, message, system_prompt } = req.body;
    if (!message) return res.status(400).json({ error: 'message requis' });
    const axios = require('axios');
    const GROQ_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY non configurée' });
    let catalogueTexte = '';
    if (instance) {
      const { data: produits } = await supabaseAdmin.from('catalogue').select('nom,description,prix,stock').eq('instance_name', instance);
      if (produits && produits.length > 0) {
        catalogueTexte = '\n\nCATALOGUE:\n' + produits.map(p => '- ' + p.nom + ': ' + (p.prix || '?') + ' FCFA').join('\n');
      }
    }
    const sys = (system_prompt || 'Tu es un agent commercial IA.') + catalogueTexte;
    const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: message }],
      max_tokens: 300, temperature: 0.7
    }, { headers: { Authorization: 'Bearer ' + GROQ_KEY } });
    const reply = groqRes.data.choices[0].message.content.trim();
    res.json({ reply });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── PUT /tenant/:id — Save settings (profil marchand) ─────────────────────
router.put('/tenant/:id', async (req, res) => {
  try {
    const { merchant_name, system_prompt, preferred_lang } = req.body;
    const update = {};
    if (merchant_name !== undefined) update.merchant_name = merchant_name;
    if (system_prompt !== undefined) update.system_prompt = system_prompt;
    if (preferred_lang !== undefined) update.preferred_lang = preferred_lang;
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Aucun champ a mettre a jour' });
    update.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('tenants').update(update).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ success: true, tenant: data });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});
