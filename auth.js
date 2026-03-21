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

module.exports = router;
