"use strict";
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");
const router = express.Router();
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const JWT_SECRET = process.env.JWT_SECRET || "titanex-jwt-secret-2026";

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
  } catch(e) { res.status(500).json({ error: e.message }); }
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/login-phone", async (req, res) => {
  try {
    const { telephone } = req.body;
    if (!telephone) return res.status(400).json({ error: "telephone requis" });
    const { data: tenant } = await supabaseAdmin.from("tenants").select("*").eq("telephone", telephone).single();
    if (!tenant) return res.status(404).json({ error: "Aucun compte avec ce numero. Inscrivez-vous." });
    const token = jwt.sign({ id: tenant.id, email: tenant.email||"", instance_name: tenant.instance_name, role: tenant.role||"client", nom: tenant.nom }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, token, tenant: { id: tenant.id, nom: tenant.nom, email: tenant.email||"", instance_name: tenant.instance_name, role: tenant.role||"client", statut: tenant.statut } });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
    const { data: s } = await supabaseAdmin.from("stores").select("*").eq("tenant_id", t.id).single().catch(()=>({data:null}));
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
      instance_name: t.instance_name
    });
  } catch(e) { res.status(500).json({error:e.message}); }
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
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ─── PUT /auth/shop ──────────────────────────────────────────────────────────
router.put("/shop", authJWT, async (req, res) => {
  try {
    const { shop_name, preferred_lang, ai_script } = req.body;
    if(shop_name) await supabaseAdmin.from("tenants").update({merchant_name:shop_name}).eq("id",req.user.id);
    const { data: s } = await supabaseAdmin.from("stores").select("id").eq("tenant_id",req.user.id).single();
    if(s && ai_script!==undefined) await supabaseAdmin.from("stores").update({system_prompt:ai_script}).eq("id",s.id);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
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
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ─── PUT /auth/logo & /auth/banner ───────────────────────────────────────────
router.put("/logo", authJWT, async (req, res) => {
  try {
    const { logo_url } = req.body;
    await supabaseAdmin.from("stores").update({logo_url:logo_url||null}).eq("tenant_id",req.user.id);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete("/logo", authJWT, async (req, res) => {
  try {
    await supabaseAdmin.from("stores").update({logo_url:null}).eq("tenant_id",req.user.id);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/banner", authJWT, async (req, res) => {
  try {
    const { banner_url } = req.body;
    await supabaseAdmin.from("stores").update({banner_url:banner_url||null}).eq("tenant_id",req.user.id);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete("/banner", authJWT, async (req, res) => {
  try {
    await supabaseAdmin.from("stores").update({banner_url:null}).eq("tenant_id",req.user.id);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ─── POST /auth/deactivate & DELETE /auth/account ────────────────────────────
router.post("/deactivate", authJWT, async (req, res) => {
  try {
    await supabaseAdmin.from("tenants").update({statut:'inactif'}).eq("id",req.user.id);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete("/account", authJWT, async (req, res) => {
  try {
    await supabaseAdmin.from("stores").delete().eq("tenant_id",req.user.id);
    await supabaseAdmin.from("tenants").delete().eq("id",req.user.id);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
