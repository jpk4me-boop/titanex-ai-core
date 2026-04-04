"use strict";
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const moment = require("moment-timezone");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const router = express.Router();
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error("FATAL: JWT_SECRET env var is required"); process.exit(1); }
const EVO_URL = (process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
const EVO_KEY = process.env.EVOLUTION_API_KEY;

async function notifyAdmin(message) {
  try {
    const adminPhone = process.env.ADMIN_PHONE;
    const adminInstance = process.env.WHATSAPP_INSTANCE || "prospect_1774206371368";
    if (!adminPhone || !EVO_URL) return;
    await axios.post(
      EVO_URL + "/message/sendText/" + adminInstance,
      { number: adminPhone + "@s.whatsapp.net", text: message, delay: 1000 },
      { headers: { apikey: EVO_KEY } }
    );
  } catch (e) {
    console.error("[NOTIFY ADMIN ERROR]", e.message);
  }
}

router.post("/register", async (req, res) => {
  try {
    const { nom, email, telephone, password, plan, instance_name } = req.body;
    if (!nom || !password) return res.status(400).json({ error: "Nom et mot de passe requis" });
    if (email) {
      const { data: existing } = await supabaseAdmin.from("tenants").select("id").eq("email", email).single();
      if (existing) return res.status(409).json({ error: "Cet email est deja inscrit" });
    }
    const hash = await bcrypt.hash(password, 10);
    const instance = instance_name || ("boutique_" + Date.now());
    const { data, error } = await supabaseAdmin.from("tenants").insert({
      nom, email: email || "", telephone: telephone || "",
      instance_name: instance, plan: plan || "starter",
      statut: "essai", role: "client", password_hash: hash,
      date_debut: new Date().toISOString(),
      date_fin: new Date(Date.now() + 7*24*60*60*1000).toISOString()
    }).select().single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("stores").insert({
      instance_name: instance, tenant_id: data.id,
      system_prompt: "Tu es un agent de vente IA pour " + nom + ". Reponds en francais, sois poli et vends efficacement.",
      catalog_details: "Catalogue en cours de configuration."
    }).catch(() => {});
    const token = jwt.sign({ id: data.id, email: email||"", instance_name: instance, role: "client", nom }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, token, tenant: { id: data.id, nom, email: email||"", instance_name: instance, role: "client", statut: "essai" } });
    // Notification admin: nouveau client inscrit
    const heureDouala = moment().tz("Africa/Douala").format("DD/MM/YYYY HH:mm");
    notifyAdmin(
      "🎉 Nouveau client inscrit !\n" +
      "👤 Nom: " + nom + "\n" +
      "📧 Email: " + (email || "N/A") + "\n" +
      "📱 Téléphone: " + (telephone || "N/A") + "\n" +
      "📦 Plan: " + (plan || "starter") + "\n" +
      "🕐 " + heureDouala
    ).catch(() => {});
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password, remember } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis" });
    const { data: tenant } = await supabaseAdmin.from("tenants").select("*").eq("email", email).single();
    if (!tenant) return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    if (!tenant.password_hash) return res.status(401).json({ error: "Compte sans mot de passe. Utilisez Google ou OTP." });
    const valid = await bcrypt.compare(password, tenant.password_hash);
    if (!valid) return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    const expiresIn = remember ? "30d" : "24h";
    const token = jwt.sign({ id: tenant.id, email, instance_name: tenant.instance_name, role: tenant.role || "client", nom: tenant.nom }, JWT_SECRET, { expiresIn });
    res.json({ success: true, token, tenant: { id: tenant.id, nom: tenant.nom, email, instance_name: tenant.instance_name, role: tenant.role || "client", statut: tenant.statut, plan: tenant.plan } });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// DISABLED: Phone login without OTP verification is a security vulnerability.
// TODO: Implement proper OTP (SMS code) verification before re-enabling.
router.post("/login-phone", (req, res) => {
  res.status(503).json({ error: "Login par telephone temporairement desactive. Utilisez email/mot de passe." });
});

router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "Non authentifie" });
    const token = auth.replace("Bearer ", "");
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: tenant } = await supabaseAdmin.from("tenants").select("id,nom,email,instance_name,role,statut,plan,date_fin").eq("id", decoded.id).single();
    if (!tenant) return res.status(401).json({ error: "Compte introuvable" });
    res.json({ tenant });
  } catch(e) { res.status(401).json({ error: "Token invalide ou expire" }); }
});

// ─── JWT middleware ───────────────────────────────────────────────────────────
function authJWT(req, res, next) {
  const token = (req.headers.authorization||'').replace('Bearer ','');
  if(!token) return res.status(401).json({error:'Token manquant'});
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { return res.status(401).json({error:'Token invalide ou expire'}); }
}

// ─── GET /auth/profile ───────────────────────────────────────────────────────
router.get("/profile", authJWT, async (req, res) => {
  try {
    const { data: t } = await supabaseAdmin.from("tenants").select("*").eq("id", req.user.id).single();
    if(!t) return res.status(404).json({error:'Compte introuvable'});
    const { data: s } = await supabaseAdmin.from("stores").select("*").eq("tenant_id", t.id).maybeSingle();
    const parts = (t.nom||'').split(' ');
    res.json({
      prenom: parts[0]||'', nom: parts.slice(1).join(' ')||'',
      email: t.email||'', whatsapp: t.telephone||'',
      shop_name: t.merchant_name || s?.instance_name || '',
      preferred_lang: 'fr',
      ai_script: s?.system_prompt||'',
      credits: 0, agents_actifs: 0, agents_total: 0,
      member_since: t.created_at || t.date_debut || '',
      logo_url: s?.logo_url||null, banner_url: s?.banner_url||null,
      plan: t.plan||'starter', statut: t.statut||'essai',
      instance_name: t.instance_name,
      agent_mode: t.agent_mode || 'actif'
    });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({error:'Erreur interne'}); }
});

// ─── PATCH /agent-mode — Toggle agent IA global ─────────────────────────────
router.patch("/agent-mode", authJWT, async (req, res) => {
  try {
    const { agent_mode } = req.body;
    if (!['actif', 'inactif'].includes(agent_mode)) return res.status(400).json({ error: 'agent_mode invalide (actif ou inactif)' });
    const { error } = await supabaseAdmin.from("tenants").update({ agent_mode }).eq("id", req.user.id);
    if (error) throw new Error(error.message);
    console.log('[AGENT MODE]', req.user.instance_name, '->', agent_mode);
    res.json({ success: true, agent_mode });
  } catch (e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── PUT /auth/profile ───────────────────────────────────────────────────────
router.put("/profile", authJWT, async (req, res) => {
  try {
    const { prenom, nom, whatsapp } = req.body;
    const fullName = ((prenom||'') + ' ' + (nom||'')).trim();
    const { error } = await supabaseAdmin.from("tenants").update({
      nom: fullName, telephone: whatsapp||''
    }).eq("id", req.user.id);
    if(error) throw error;
    res.json({success:true});
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({error:'Erreur interne'}); }
});

// ─── PUT /auth/shop ──────────────────────────────────────────────────────────
router.put("/shop", authJWT, async (req, res) => {
  try {
    const { shop_name, preferred_lang, ai_script } = req.body;
    if(shop_name) await supabaseAdmin.from("tenants").update({merchant_name:shop_name}).eq("id",req.user.id);
    const { data: s } = await supabaseAdmin.from("stores").select("id").eq("tenant_id",req.user.id).single();
    if(s && ai_script!==undefined) await supabaseAdmin.from("stores").update({system_prompt:ai_script}).eq("id",s.id);
    res.json({success:true});
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({error:'Erreur interne'}); }
});

// ─── POST /auth/change-password ──────────────────────────────────────────────
router.post("/change-password", authJWT, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if(!current_password||!new_password) return res.status(400).json({error:'Champs requis'});
    const { data: t } = await supabaseAdmin.from("tenants").select("password_hash").eq("id",req.user.id).single();
    if(!t||!t.password_hash) return res.status(400).json({error:'Compte sans mot de passe'});
    const valid = await bcrypt.compare(current_password, t.password_hash);
    if(!valid) return res.status(400).json({error:'Mot de passe actuel incorrect'});
    const hash = await bcrypt.hash(new_password, 10);
    await supabaseAdmin.from("tenants").update({password_hash:hash}).eq("id",req.user.id);
    res.json({success:true});
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({error:'Erreur interne'}); }
});

// ─── PUT /auth/logo & /auth/banner ───────────────────────────────────────────
router.put("/logo", authJWT, async (req, res) => {
  try {
    const { logo_url } = req.body;
    await supabaseAdmin.from("stores").update({logo_url:logo_url||null}).eq("tenant_id",req.user.id);
    res.json({success:true});
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({error:'Erreur interne'}); }
});
router.delete("/logo", authJWT, async (req, res) => {
  try {
    await supabaseAdmin.from("stores").update({logo_url:null}).eq("tenant_id",req.user.id);
    res.json({success:true});
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({error:'Erreur interne'}); }
});
router.put("/banner", authJWT, async (req, res) => {
  try {
    const { banner_url } = req.body;
    await supabaseAdmin.from("stores").update({banner_url:banner_url||null}).eq("tenant_id",req.user.id);
    res.json({success:true});
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({error:'Erreur interne'}); }
});
router.delete("/banner", authJWT, async (req, res) => {
  try {
    await supabaseAdmin.from("stores").update({banner_url:null}).eq("tenant_id",req.user.id);
    res.json({success:true});
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({error:'Erreur interne'}); }
});

// ─── POST /auth/deactivate & DELETE /auth/account ────────────────────────────
router.post("/deactivate", authJWT, async (req, res) => {
  try {
    await supabaseAdmin.from("tenants").update({statut:'inactif'}).eq("id",req.user.id);
    res.json({success:true});
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({error:'Erreur interne'}); }
});
router.delete("/account", authJWT, async (req, res) => {
  try {
    await supabaseAdmin.from("stores").delete().eq("tenant_id",req.user.id);
    await supabaseAdmin.from("tenants").delete().eq("id",req.user.id);
    res.json({success:true});
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({error:'Erreur interne'}); }
});

// ─── GET /transactions — transactions du tenant connecté (JWT) ────────────────
router.get("/transactions", authJWT, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from("transactions").select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── CATALOGUE CRUD (JWT tenant) ─────────────────────────────────────────────
router.get("/catalogue", authJWT, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from("catalogue").select("*")
      .eq("instance_name", req.user.instance_name)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

router.post("/catalogue", authJWT, async (req, res) => {
  try {
    const { nom, description, prix, stock, image_url, category } = req.body;
    if (!nom) return res.status(400).json({ error: "Nom requis" });
    const { data, error } = await supabaseAdmin.from("catalogue").insert({
      instance_name: req.user.instance_name, nom, description: description || "",
      prix: parseFloat(prix) || 0, stock: parseInt(stock) || 100,
      image_url: image_url || null, category: category || "Autre"
    }).select().single();
    if (error) throw error;
    res.json({ success: true, produit: data });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

router.patch("/catalogue/:id", authJWT, async (req, res) => {
  try {
    const { nom, description, prix, stock, image_url, category } = req.body;
    const update = { updated_at: new Date().toISOString() };
    if (nom !== undefined) update.nom = nom;
    if (description !== undefined) update.description = description;
    if (prix !== undefined) update.prix = parseFloat(prix) || 0;
    if (stock !== undefined) update.stock = parseInt(stock) || 0;
    if (image_url !== undefined) update.image_url = image_url;
    if (category !== undefined) update.category = category;
    const { data, error } = await supabaseAdmin.from("catalogue").update(update)
      .eq("id", req.params.id).eq("instance_name", req.user.instance_name)
      .select().single();
    if (error) throw error;
    res.json({ success: true, produit: data });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

router.delete("/catalogue/:id", authJWT, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from("catalogue").delete()
      .eq("id", req.params.id).eq("instance_name", req.user.instance_name);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── STORE CONFIG (JWT tenant) ──────────────────────────────────────────────
router.get("/store", authJWT, async (req, res) => {
  try {
    const { data: tenant } = await supabaseAdmin.from("tenants")
      .select("nom,telephone,merchant_name,timezone,preferred_lang,orange_money,mtn_momo")
      .eq("id", req.user.id).single();
    const { data: store } = await supabaseAdmin.from("stores")
      .select("logo_url,system_prompt,catalog_details,description")
      .eq("tenant_id", req.user.id).single().catch(() => ({ data: null }));
    res.json({
      shop_name: tenant?.merchant_name || tenant?.nom || "",
      logo_url: store?.logo_url || null,
      description: store?.description || "",
      orange_money: tenant?.orange_money || "",
      mtn_momo: tenant?.mtn_momo || "",
      timezone: tenant?.timezone || "Africa/Douala",
      preferred_lang: tenant?.preferred_lang || "fr"
    });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

router.patch("/store", authJWT, async (req, res) => {
  try {
    const { shop_name, logo_url, description, orange_money, mtn_momo, timezone, preferred_lang } = req.body;
    const tenantUpdate = {};
    if (shop_name !== undefined) tenantUpdate.merchant_name = shop_name;
    if (orange_money !== undefined) tenantUpdate.orange_money = orange_money;
    if (mtn_momo !== undefined) tenantUpdate.mtn_momo = mtn_momo;
    if (timezone !== undefined) tenantUpdate.timezone = timezone;
    if (preferred_lang !== undefined) tenantUpdate.preferred_lang = preferred_lang;
    if (Object.keys(tenantUpdate).length > 0) {
      await supabaseAdmin.from("tenants").update(tenantUpdate).eq("id", req.user.id);
    }
    const storeUpdate = {};
    if (logo_url !== undefined) storeUpdate.logo_url = logo_url;
    if (description !== undefined) storeUpdate.description = description;
    if (Object.keys(storeUpdate).length > 0) {
      await supabaseAdmin.from("stores").update(storeUpdate).eq("tenant_id", req.user.id);
    }
    res.json({ success: true });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── ONBOARDING ─────────────────────────────────────────────────────────────
router.get("/onboarding-status", authJWT, async (req, res) => {
  try {
    const { data } = await supabaseAdmin.from("tenants")
      .select("onboarding_done").eq("id", req.user.id).single();
    res.json({ onboarding_done: data?.onboarding_done || false });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

router.post("/onboarding-done", authJWT, async (req, res) => {
  try {
    await supabaseAdmin.from("tenants").update({ onboarding_done: true }).eq("id", req.user.id);
    res.json({ success: true });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

// ─── TENANT STATS (JWT) ────────────────────────────────────────────────────
router.get("/stats", authJWT, async (req, res) => {
  try {
    const instance = req.user.instance_name;
    const now = new Date();
    const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();

    // Conversations last 30 days with dates
    const { data: convs } = await supabaseAdmin.from("conversations")
      .select("id,created_at,updated_at,phone").eq("instance", instance)
      .gte("created_at", thirtyDaysAgo).order("created_at", { ascending: true });

    // Products
    const { data: products } = await supabaseAdmin.from("catalogue")
      .select("id,nom").eq("instance_name", instance);

    // Transactions
    const { data: txns } = await supabaseAdmin.from("transactions")
      .select("id,amount,created_at,status").eq("user_id", req.user.id)
      .gte("created_at", thirtyDaysAgo).order("created_at", { ascending: true });

    // Group by day for charts
    const salesByDay = {};
    const convsByDay = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      salesByDay[key] = 0;
      convsByDay[key] = 0;
    }
    (txns || []).filter(t => t.status === "SUCCESSFUL").forEach(t => {
      const day = (t.created_at || "").slice(0, 10);
      if (salesByDay[day] !== undefined) salesByDay[day] += parseFloat(t.amount) || 0;
    });
    (convs || []).forEach(c => {
      const day = (c.created_at || "").slice(0, 10);
      if (convsByDay[day] !== undefined) convsByDay[day]++;
    });

    // Top products mentioned in conversations (count occurrences in ai_reply)
    const { data: recentConvs } = await supabaseAdmin.from("conversations")
      .select("ai_reply").eq("instance", instance).order("updated_at", { ascending: false }).limit(200);
    const prodCounts = {};
    (products || []).forEach(p => { prodCounts[p.nom] = 0; });
    (recentConvs || []).forEach(c => {
      const reply = (c.ai_reply || "").toLowerCase();
      (products || []).forEach(p => {
        if (reply.includes((p.nom || "").toLowerCase().substring(0, 6))) {
          prodCounts[p.nom] = (prodCounts[p.nom] || 0) + 1;
        }
      });
    });
    const topProducts = Object.entries(prodCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([nom, count]) => ({ nom, mentions: count }));

    // Best day
    const bestDay = Object.entries(salesByDay).sort((a, b) => b[1] - a[1])[0];

    // Conversion rate
    const totalConvs = (convs || []).length;
    const totalOrders = (txns || []).filter(t => t.status === "SUCCESSFUL").length;
    const conversionRate = totalConvs > 0 ? Math.round((totalOrders / totalConvs) * 100) : 0;

    // Total revenue
    const totalRevenue = (txns || []).filter(t => t.status === "SUCCESSFUL")
      .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

    res.json({
      sales_by_day: salesByDay,
      convs_by_day: convsByDay,
      top_products: topProducts,
      best_day: bestDay ? { date: bestDay[0], amount: bestDay[1] } : null,
      conversion_rate: conversionRate,
      total_conversations: totalConvs,
      total_orders: totalOrders,
      total_revenue: totalRevenue,
      total_products: (products || []).length
    });
  } catch(e) { console.error('[ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
});

router.authJWT = authJWT;
module.exports = router;
