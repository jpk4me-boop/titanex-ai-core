"use strict";
const express = require("express");
const axios = require("axios");
const moment = require("moment-timezone");
const { createClient } = require("@supabase/supabase-js");
const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const CAMPAY_URL = "https://www.campay.net/api";
const CAMPAY_USER = process.env.CAMPAY_USERNAME;
const CAMPAY_PASS = process.env.CAMPAY_PASSWORD;
const EVO_URL = process.env.EVOLUTION_API_URL.replace(/\/$/, "");
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const ADMIN_PHONE = process.env.ADMIN_PHONE;
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY;
const adminAuth = (req, res, next) => {
  if (req.headers["x-admin-key"] !== ADMIN_KEY) return res.status(401).json({ error: "Non autorise" });
  next();
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getCampayToken() {
  const r = await axios.post(CAMPAY_URL + "/token/", {
    username: CAMPAY_USER,
    password: CAMPAY_PASS
  });
  return r.data.token;
}

async function notifyAdmin(message) {
  try {
    await axios.post(
      EVO_URL + "/message/sendText/prospect_1774206371368",
      { number: ADMIN_PHONE + "@s.whatsapp.net", text: message, delay: 1000 },
      { headers: { apikey: EVO_KEY } }
    );
  } catch (e) {
    console.error("[NOTIFY ERROR]", e.message);
  }
}

    // Activer l'instance WhatsApp d'un tenant
async function activerInstance(instance_name) {
  try {
    // Vérifier si l'instance existe
    const check = await axios.get(
      EVO_URL + "/instance/connectionState/" + instance_name,
      { headers: { apikey: EVO_KEY } }
    ).catch(() => null);

    if (!check || !check.data) {
      // Créer l'instance si elle n'existe pas
      await axios.post(
        EVO_URL + "/instance/create",
        { instanceName: instance_name, integration: "WHATSAPP-BAILEYS", qrcode: true },
        { headers: { apikey: EVO_KEY } }
      );
      console.log("[EVO] Instance créée:", instance_name);
    }
    console.log("[EVO] Instance activée:", instance_name);
    return true;
  } catch (e) {
    console.error("[EVO ACTIVER ERROR]", instance_name, e.message);
    return false;
  }
}

// Désactiver l'instance WhatsApp d'un tenant (logout + delete)
async function desactiverInstance(instance_name) {
  try {
    // Logout propre d'abord
    await axios.delete(
      EVO_URL + "/instance/logout/" + instance_name,
      { headers: { apikey: EVO_KEY } }
    ).catch(() => {});

    // Puis supprimer l'instance
    await axios.delete(
      EVO_URL + "/instance/delete/" + instance_name,
      { headers: { apikey: EVO_KEY } }
    ).catch(() => {});

    console.log("[EVO] Instance désactivée:", instance_name);
    return true;
  } catch (e) {
    console.error("[EVO DESACTIVER ERROR]", instance_name, e.message);
    return false;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Initier un paiement
router.post("/initiate", adminAuth, async (req, res) => {
  const { tenant_id, phone } = req.body;
  if (!tenant_id || !phone)
    return res.status(400).json({ error: "tenant_id et phone requis" });

  try {
    const { data: tenant } = await supabaseAdmin
      .from("tenants").select("*").eq("id", tenant_id).single();
    if (!tenant)
      return res.status(404).json({ error: "Client introuvable" });

    const token = await getCampayToken();
    const amount = tenant.prix_mensuel || 24900;

    const r = await axios.post(
      CAMPAY_URL + "/collect/",
      {
        amount: String(amount),
        from: phone,
        description: "Abonnement Titanex AI - " + tenant.nom,
        external_reference: tenant_id,
        redirect_url: "http://" + process.env.SERVER_IP + ":3001/dashboard/"
      },
      { headers: { Authorization: "Token " + token } }
    );

    await supabaseAdmin.from("tenants")
      .update({ reference_paiement: r.data.reference, moyen_paiement: "campay" })
      .eq("id", tenant_id);

    res.json({
      success: true,
      reference: r.data.reference,
      ussd_code: r.data.ussd_code
    });
  } catch (e) {
    console.error("[INITIATE ERROR]", e.response?.data || e.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// Campay webhook IP allowlist + field validation
const CAMPAY_ALLOWED_IPS = (process.env.CAMPAY_WEBHOOK_IPS || '').split(',').filter(Boolean);

function verifyCampayWebhook(req, res, next) {
  // IP check (if configured)
  if (CAMPAY_ALLOWED_IPS.length > 0) {
    const clientIP = req.ip || req.connection.remoteAddress || '';
    const forwardedFor = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwardedFor || clientIP;
    if (!CAMPAY_ALLOWED_IPS.some(allowed => ip.includes(allowed))) {
      console.warn('[WEBHOOK] Blocked IP:', ip);
      return res.sendStatus(403);
    }
  }
  // Required field validation
  const { status, external_reference } = req.body;
  if (!status || !external_reference) {
    console.warn('[WEBHOOK] Missing required fields');
    return res.sendStatus(400);
  }
  next();
}

// Webhook Campay — paiement confirmé
router.post("/webhook", verifyCampayWebhook, async (req, res) => {
  res.sendStatus(200); // Répondre immédiatement à Campay
  try {
    const { status, external_reference, operator_reference, amount } = req.body;
    console.log("[WEBHOOK CAMPAY]", status, external_reference);

    // Log ALL webhook calls to transactions table
    await supabaseAdmin.from("transactions").insert({
      user_id: external_reference,
      amount: parseInt(amount) || 0,
      currency: "XAF",
      status: status,
      payment_reference: operator_reference || req.body.reference || null
    }).then(() => console.log("[TX LOG] Saved:", status, external_reference))
      .catch(e => console.warn("[TX LOG WARN]", e.message));

    if (status !== "SUCCESSFUL") {
      console.log("[WEBHOOK] Statut non-successful:", status);
      return;
    }

    const now = new Date();
    const dateFin = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .update({
        statut: "actif",
        dernier_paiement: now.toISOString(),
        date_debut: now.toISOString(),
        date_fin: dateFin.toISOString()
      })
      .eq("id", external_reference)
      .select()
      .single();

    if (!tenant) {
      console.error("[WEBHOOK] Tenant introuvable:", external_reference);
      return;
    }

    // Auto-créer stores si inexistant
    const { data: existingStore } = await supabaseAdmin.from("stores").select("id").eq("instance_name", tenant.instance_name).single().catch(() => ({ data: null }));
    if (!existingStore && tenant.instance_name) {
      await supabaseAdmin.from("stores").insert({
        instance_name: tenant.instance_name,
        owner_id: tenant.id,
        tenant_id: tenant.id,
        catalog_details: "Catalogue en cours de configuration. Demandez au propriétaire d'ajouter ses produits.",
        system_prompt: `Tu es un agent commercial IA. Ton ton est amical et professionnel.\n\nRÈGLES:\n1) Réponds en 1-3 phrases courtes\n2) Ne te présente pas deux fois\n3) Guide vers les produits du catalogue\n4) Paiement Mobile Money uniquement`
      }).catch(e => console.log("[STORES CREATE ERR]", e.message));
      console.log("[STORES] Entrée créée pour:", tenant.instance_name);
    }
    // Auto-créer store universel si inexistant
    if (tenant.instance_name) {
      const { data: existingStore } = await supabaseAdmin
        .from("stores").select("id").eq("instance_name", tenant.instance_name).maybeSingle();
      if (!existingStore) {
        const promptUniversel = `Tu es un(e) vendeur(se) expert(e) de la boutique "${tenant.nom}". Tu te comportes comme un humain, naturel et chaleureux. Ne mentionne JAMAIS que tu es une IA.

RÈGLES:
1) Réponses courtes 1-3 phrases. Une seule question à la fois.
2) Présente chaque produit avec son NOM EXACT du catalogue + prix + avantage clé.
3) Dès que le client montre de l'intérêt → propose IMMÉDIATEMENT le paiement: "Pour commander, envoyez le montant au ${tenant.telephone} via Orange Money ou MTN MoMo, puis envoyez-moi la capture du reçu."
4) Si le client hésite → relance: "C'est un excellent choix, le stock est limité 😊 Vous préférez Orange Money ou MoMo ?"
5) Après confirmation de paiement → "Parfait ! Commande enregistrée pour ${tenant.nom}. Merci pour votre confiance 🙏"
6) Si info manquante → "Je vais vérifier ça pour vous." Jamais inventer.
7) Paiement: Orange Money ou MTN MoMo au ${tenant.telephone}. Jamais Western Union ou virement.
8) Livraison locale: bus ou coursier (frais client). Internationale: DHL (frais client).`;

        await supabaseAdmin.from("stores").insert({
          instance_name: tenant.instance_name,
          owner_id: tenant.id,
          tenant_id: tenant.id,
          catalog_details: "Catalogue en cours de configuration. Le propriétaire ajoutera ses produits depuis le dashboard.",
          system_prompt: promptUniversel
        }).catch(e => console.log("[STORE AUTO] Erreur:", e.message));
        console.log("[STORE AUTO] Créé pour:", tenant.nom, "- Tel:", tenant.telephone);
      }
    }

    // Activer l'instance WhatsApp
    if (tenant.instance_name) {
      await activerInstance(tenant.instance_name);
    }

    try {
      await axios.post(EVO_URL + '/webhook/set/' + tenant.instance_name, {
        webhook: { enabled: true, url: 'https://titanexai.com/webhook', webhook_by_events: false, events: ['MESSAGES_UPSERT','CONNECTION_UPDATE'] }
      }, { headers: { apikey: EVO_KEY } });
      console.log('[WEBHOOK SET]', tenant.instance_name);
    } catch(we) { console.log('[WEBHOOK ERR]', we.message); }
    const heureDouala = moment().tz("Africa/Douala").format("DD/MM/YYYY HH:mm");
    const operator = req.body.operator || req.body.payment_method || "Mobile Money";
    await notifyAdmin(
      "💰 Paiement reçu !\n" +
      "👤 Client: " + tenant.nom + "\n" +
      "💵 Montant: " + (amount || tenant.prix_mensuel) + " FCFA\n" +
      "✅ Statut: " + status + "\n" +
      "📱 Réseau: " + operator + "\n" +
      "🕐 " + heureDouala
    );

    console.log("[WEBHOOK] Tenant activé:", tenant.nom);
  } catch (e) {
    console.error("[WEBHOOK ERROR]", e.message);
  }
});

// Webhook expiration — à appeler par un cron job
router.post("/check-expirations", adminAuth, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { data: expiredTenants } = await supabaseAdmin
      .from("tenants")
      .select("*")
      .eq("statut", "actif")
      .lt("date_fin", now);

    if (!expiredTenants || expiredTenants.length === 0) {
      return res.json({ message: "Aucune expiration", count: 0 });
    }

    let desactives = 0;
    for (const tenant of expiredTenants) {
      await supabaseAdmin.from("tenants")
        .update({ statut: "expire" })
        .eq("id", tenant.id);

      if (tenant.instance_name) {
        await desactiverInstance(tenant.instance_name);
      }

      await notifyAdmin(
        "⚠️ ABONNEMENT EXPIRÉ - TITANEX AI\n" +
        "Client: " + tenant.nom + "\n" +
        "Instance: " + tenant.instance_name + "\n" +
        "Agent DÉSACTIVÉ automatiquement"
      );

      desactives++;
      console.log("[EXPIRE] Tenant désactivé:", tenant.nom);
    }

    res.json({ message: "Expirations traitées", count: desactives });
  } catch (e) {
    console.error("[EXPIRATION ERROR]", e.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// Vérifier statut d'une transaction
router.get("/status/:reference", async (req, res) => {
  try {
    const token = await getCampayToken();
    const r = await axios.get(
      CAMPAY_URL + "/transaction/" + req.params.reference + "/",
      { headers: { Authorization: "Token " + token } }
    );
    res.json(r.data);
  } catch (e) {
    console.error('[ERROR]', e.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// Inscription nouveau prospect (essai 7 jours)
router.post("/inscription", async (req, res) => {
  const { nom, email, telephone, boutique, type_boutique, plan, instance_name } = req.body;
  const phone = telephone || req.body.phone;
  if (!nom || !phone)
    return res.status(400).json({ error: "Champs requis: nom, telephone" });

  try {
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .insert({
        nom,
        email,
        telephone: phone,
        instance_name: instance_name || ("prospect_" + Date.now()),
        plan: plan || "starter",
        statut: "essai",
        date_debut: new Date().toISOString(),
        date_fin: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505")
        return res.status(409).json({ error: "Email déjà inscrit. Connectez-vous au Dashboard." });
      throw new Error(error.message);
    }

    await notifyAdmin(
      "🆕 NOUVELLE INSCRIPTION - TITANEX AI\n" +
      "Nom: " + nom + "\n" +
      "Tel: " + phone + "\n" +
      "Email: " + (email || "-") + "\n" +
      "Boutique: " + (boutique || type_boutique || "-") + "\n" +
      "Plan: " + (plan || "starter") + "\n" +
      "➡️ Contacte-le pour démarrer son essai !"
    );

    res.json({ success: true, tenant_id: data.id });
  } catch (e) {
    console.error("[INSCRIPTION ERROR]", e.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// Activer/désactiver manuellement (admin)
router.post("/admin/toggle", adminAuth, async (req, res) => {
  const { tenant_id, action } = req.body; // action: "activer" | "desactiver"
  if (!tenant_id || !["activer", "desactiver"].includes(action))
    return res.status(400).json({ error: "tenant_id et action (activer|desactiver) requis" });

  try {
    const { data: tenant } = await supabaseAdmin
      .from("tenants").select("*").eq("id", tenant_id).single();
    if (!tenant)
      return res.status(404).json({ error: "Tenant introuvable" });

    if (action === "activer") {
      await supabaseAdmin.from("tenants")
        .update({ statut: "actif" }).eq("id", tenant_id);
      await activerInstance(tenant.instance_name);
      res.json({ success: true, message: "Instance activée: " + tenant.instance_name });
    } else {
      await supabaseAdmin.from("tenants")
        .update({ statut: "suspendu" }).eq("id", tenant_id);
      await desactiverInstance(tenant.instance_name);
      res.json({ success: true, message: "Instance désactivée: " + tenant.instance_name });
    }
  } catch (e) {
    console.error('[ERROR]', e.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;
