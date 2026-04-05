// ─── Titanex AI — Email Service ──────────────────────────────────────────────
const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.resend.com",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: true,
  auth: {
    user: process.env.SMTP_USER || "resend",
    pass: process.env.SMTP_PASS || process.env.RESEND_API_KEY || "",
  },
});

const FROM = process.env.EMAIL_FROM || "Titanex AI <onboarding@resend.dev>";

function welcomeHTML(tenant) {
  const nom = tenant.nom || "Marchand";
  const email = tenant.email || "";
  const instance = tenant.instance_name || "";
  const plan = (tenant.plan || "starter").charAt(0).toUpperCase() + (tenant.plan || "starter").slice(1);
  const credits = tenant.credits || 3000;

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0fdf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#0A5C36,#128C57);padding:40px 32px;text-align:center">
  <h1 style="margin:0 0 8px;color:#fff;font-size:28px;font-weight:800;letter-spacing:-0.5px">Titanex AI</h1>
  <p style="margin:0;color:#86efac;font-size:14px;font-weight:500">Votre agent commercial WhatsApp intelligent</p>
</td></tr>

<!-- Welcome -->
<tr><td style="padding:40px 32px 24px">
  <h2 style="margin:0 0 16px;color:#0A5C36;font-size:22px;font-weight:700">Bienvenue, ${nom} !</h2>
  <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7">
    Votre compte Titanex AI est actif. Votre agent IA est pret a vendre vos produits 24h/24 sur WhatsApp.
    Suivez ces 3 etapes pour demarrer en moins de 5 minutes.
  </p>
</td></tr>

<!-- Steps -->
<tr><td style="padding:0 32px">
  <table width="100%" cellpadding="0" cellspacing="0">

    <tr><td style="padding:16px 20px;background:#f0fdf4;border-radius:12px;margin-bottom:12px">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:top;padding-right:16px">
          <div style="width:36px;height:36px;background:#128C57;border-radius:50%;color:#fff;font-size:16px;font-weight:700;text-align:center;line-height:36px">1</div>
        </td>
        <td>
          <p style="margin:0 0 4px;color:#0A5C36;font-size:15px;font-weight:700">Connecter WhatsApp</p>
          <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">Dashboard &rarr; Connexions &rarr; Scanner le QR code avec votre WhatsApp Business</p>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="height:12px"></td></tr>

    <tr><td style="padding:16px 20px;background:#f0fdf4;border-radius:12px">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:top;padding-right:16px">
          <div style="width:36px;height:36px;background:#128C57;border-radius:50%;color:#fff;font-size:16px;font-weight:700;text-align:center;line-height:36px">2</div>
        </td>
        <td>
          <p style="margin:0 0 4px;color:#0A5C36;font-size:15px;font-weight:700">Ajouter vos produits</p>
          <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">Dashboard &rarr; Produits et services &rarr; Ajoutez photos, prix et descriptions</p>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="height:12px"></td></tr>

    <tr><td style="padding:16px 20px;background:#f0fdf4;border-radius:12px">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:top;padding-right:16px">
          <div style="width:36px;height:36px;background:#128C57;border-radius:50%;color:#fff;font-size:16px;font-weight:700;text-align:center;line-height:36px">3</div>
        </td>
        <td>
          <p style="margin:0 0 4px;color:#0A5C36;font-size:15px;font-weight:700">Activer votre agent IA</p>
          <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">Dashboard &rarr; Configuration &rarr; Activez l'agent et il commence a repondre automatiquement</p>
        </td>
      </tr></table>
    </td></tr>

  </table>
</td></tr>

<!-- CTA Button -->
<tr><td style="padding:32px;text-align:center">
  <a href="https://titanexai.com/dashboard/" style="display:inline-block;background:#128C57;color:#fff;font-size:16px;font-weight:700;padding:14px 40px;border-radius:12px;text-decoration:none;letter-spacing:0.3px">
    Acceder au dashboard
  </a>
</td></tr>

<!-- Account Info -->
<tr><td style="padding:0 32px 32px">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0">
    <tr><td style="padding:20px 24px">
      <p style="margin:0 0 12px;color:#0A5C36;font-size:14px;font-weight:700">Votre compte</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#374151">
        <tr><td style="padding:4px 0;color:#6b7280;width:140px">Email</td><td style="padding:4px 0;font-weight:600">${email}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Instance WhatsApp</td><td style="padding:4px 0;font-weight:600">${instance}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Plan</td><td style="padding:4px 0;font-weight:600">${plan}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Credits disponibles</td><td style="padding:4px 0;font-weight:600;color:#128C57">${credits.toLocaleString("fr-FR")}</td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>

<!-- Footer -->
<tr><td style="background:#f8fafc;padding:24px 32px;border-top:1px solid #e2e8f0;text-align:center">
  <p style="margin:0 0 8px;color:#6b7280;font-size:12px">Besoin d'aide ? Contactez-nous sur WhatsApp</p>
  <p style="margin:0;color:#128C57;font-size:13px;font-weight:600">+237 652 249 455</p>
  <p style="margin:8px 0 0;color:#9ca3af;font-size:11px">&copy; 2026 Titanex AI — WanzieSend. Tous droits reserves.</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

async function sendWelcomeEmail(tenant) {
  if (!tenant.email) {
    console.log("[MAILER] Pas d'email pour", tenant.nom, "— skip");
    return;
  }
  const smtpPass = process.env.SMTP_PASS || process.env.RESEND_API_KEY;
  if (!smtpPass) {
    console.warn("[MAILER] SMTP_PASS / RESEND_API_KEY non configure — email non envoye");
    return;
  }
  try {
    const info = await transporter.sendMail({
      from: FROM,
      to: tenant.email,
      subject: "Bienvenue sur Titanex AI, " + (tenant.nom || "Marchand") + " !",
      html: welcomeHTML(tenant),
    });
    console.log("[MAILER] Email de bienvenue envoye a", tenant.email, "msgId:", info.messageId);
  } catch (err) {
    console.error("[MAILER] Erreur envoi:", err.message);
  }
}

module.exports = { sendWelcomeEmail };
