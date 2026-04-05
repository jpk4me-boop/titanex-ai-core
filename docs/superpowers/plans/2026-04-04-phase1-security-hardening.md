# Phase 1: Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all critical and high-severity security vulnerabilities: add auth to unprotected routes, remove hardcoded secrets, add security middleware (helmet, cors, rate-limit), and verify Campay webhooks.

**Architecture:** The fixes are applied across 4 existing files (`index.js`, `admin.js`, `payment.js`, `auth.js`) plus installing 3 new npm packages. A shared `middleware/adminAuth.js` is extracted to DRY up admin key checks. The JWT `authJWT` middleware from `auth.js` is exported and reused in `index.js` for conversation/history routes.

**Tech Stack:** Node.js, Express, helmet, cors, express-rate-limit, crypto (built-in for HMAC)

---

### Task 1: Install security dependencies

**Files:**
- Modify: `/root/TitanexAI/package.json`

- [ ] **Step 1: Install helmet, cors, express-rate-limit**

```bash
cd /root/TitanexAI && npm install helmet cors express-rate-limit
```

- [ ] **Step 2: Verify installation**

```bash
cd /root/TitanexAI && node -e "require('helmet'); require('cors'); require('express-rate-limit'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /root/TitanexAI && git add package.json package-lock.json && git commit -m "chore: add helmet, cors, express-rate-limit dependencies"
```

---

### Task 2: Add helmet, CORS, and rate limiting middleware to index.js

**Files:**
- Modify: `/root/TitanexAI/index.js:1-26`

- [ ] **Step 1: Add security middleware imports and configuration after existing requires**

At the top of `index.js`, after line 6 (`const moment = require('moment-timezone');`), add:

```javascript
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
```

After line 16 (`const app=express();`), before the `app.use(express.json(...))` line, add:

```javascript
// Security headers
app.use(helmet());

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
```

- [ ] **Step 2: Reduce JSON body limit**

Change line 17 from:
```javascript
app.use(express.json({limit:'50mb'}));
app.use(express.urlencoded({extended:true,limit:'50mb'}));
```
To:
```javascript
app.use(express.json({limit:'5mb'}));
app.use(express.urlencoded({extended:true,limit:'5mb'}));
```

- [ ] **Step 3: Verify server starts**

```bash
cd /root/TitanexAI && timeout 5 node index.js 2>&1 || true
```

Expected: Should print "Titanex AI actif sur le port 3001" (then timeout kills it).

- [ ] **Step 4: Commit**

```bash
cd /root/TitanexAI && git add index.js && git commit -m "security: add helmet, CORS, rate limiting, reduce body limit"
```

---

### Task 3: Remove hardcoded secret fallbacks

**Files:**
- Modify: `/root/TitanexAI/auth.js:10`
- Modify: `/root/TitanexAI/admin.js:6,8`
- Modify: `/root/TitanexAI/index.js:588`

- [ ] **Step 1: Fix auth.js — remove JWT_SECRET fallback**

Change line 10 from:
```javascript
const JWT_SECRET = process.env.JWT_SECRET || "titanex-jwt-secret-2026";
```
To:
```javascript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error("FATAL: JWT_SECRET env var is required"); process.exit(1); }
```

- [ ] **Step 2: Fix admin.js — remove ADMIN_KEY and JWT_SECRET fallbacks**

Change line 6 from:
```javascript
const JWT_SECRET = process.env.JWT_SECRET || "titanex-jwt-secret-2026";
```
To:
```javascript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error("FATAL: JWT_SECRET env var is required"); process.exit(1); }
```

Change line 8 from:
```javascript
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || "titanex-admin-2026";
```
To:
```javascript
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY;
if (!ADMIN_KEY) { console.error("FATAL: ADMIN_SECRET_KEY env var is required"); process.exit(1); }
```

- [ ] **Step 3: Fix index.js:588 — remove hardcoded admin key literal**

Change line 588 from:
```javascript
  if (apikey !== 'titanex-admin-2026') return res.status(403).json({error: 'Non autorise'});
```
To:
```javascript
  if (!process.env.ADMIN_SECRET_KEY || apikey !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({error: 'Non autorise'});
```

- [ ] **Step 4: Verify .env has the required vars**

```bash
cd /root/TitanexAI && grep -c "JWT_SECRET" .env && grep -c "ADMIN_SECRET_KEY" .env
```

Expected: Both should return 1 (the vars exist in .env).

- [ ] **Step 5: Commit**

```bash
cd /root/TitanexAI && git add auth.js admin.js index.js && git commit -m "security: remove all hardcoded secret fallbacks, require env vars"
```

---

### Task 4: Add auth middleware to unprotected admin routes

**Files:**
- Modify: `/root/TitanexAI/admin.js:15-90, 368-486`

The `auth` middleware already exists at line 9 of admin.js:
```javascript
const auth = (req, res, next) => { if (req.headers["x-admin-key"] !== ADMIN_KEY) return res.status(401).json({ error: "Non autorise" }); next(); };
```

The following routes are missing `auth`:

- [ ] **Step 1: Add auth to catalogue routes (lines 15-76)**

Change line 15 from:
```javascript
router.get("/catalogue/:instance", async (req, res) => {
```
To:
```javascript
router.get("/catalogue/:instance", auth, async (req, res) => {
```

Change line 20 from:
```javascript
router.post("/catalogue", async (req, res) => {
```
To:
```javascript
router.post("/catalogue", auth, async (req, res) => {
```

Change line 27 from:
```javascript
router.delete("/catalogue/:id", async (req, res) => {
```
To:
```javascript
router.delete("/catalogue/:id", auth, async (req, res) => {
```

Change line 34 from:
```javascript
router.post("/ai/description", async (req, res) => {
```
To:
```javascript
router.post("/ai/description", auth, async (req, res) => {
```

Change line 48 from:
```javascript
router.patch("/catalogue/:id", async (req, res) => {
```
To:
```javascript
router.patch("/catalogue/:id", auth, async (req, res) => {
```

Change line 61 from:
```javascript
router.post("/catalogue/:id/dup", async (req, res) => {
```
To:
```javascript
router.post("/catalogue/:id/dup", auth, async (req, res) => {
```

Change line 72 from:
```javascript
router.get("/catalogue/:id/get", async (req, res) => {
```
To:
```javascript
router.get("/catalogue/:id/get", auth, async (req, res) => {
```

Change line 80 from:
```javascript
router.patch('/tenants/:id/setup', async (req, res) => {
```
To:
```javascript
router.patch('/tenants/:id/setup', auth, async (req, res) => {
```

- [ ] **Step 2: Add auth to QR routes (lines 385-486)**

Change line 385 from:
```javascript
router.get('/qr/:instance', async (req, res) => {
```
To:
```javascript
router.get('/qr/:instance', auth, async (req, res) => {
```

Change line 442 from:
```javascript
router.post('/qr/:instance/logout', async (req, res) => {
```
To:
```javascript
router.post('/qr/:instance/logout', auth, async (req, res) => {
```

Change line 456 from:
```javascript
router.post('/qr/:instance/refresh', async (req, res) => {
```
To:
```javascript
router.post('/qr/:instance/refresh', auth, async (req, res) => {
```

Change line 474 from:
```javascript
router.get('/qr/:instance/status', async (req, res) => {
```
To:
```javascript
router.get('/qr/:instance/status', auth, async (req, res) => {
```

- [ ] **Step 3: Add auth to tenant info route (line 369)**

Change line 369 from:
```javascript
router.get('/tenant/:id', async (req, res) => {
```
To:
```javascript
router.get('/tenant/:id', auth, async (req, res) => {
```

- [ ] **Step 4: Commit**

```bash
cd /root/TitanexAI && git add admin.js && git commit -m "security: add auth middleware to all unprotected admin routes"
```

---

### Task 5: Add auth to unprotected payment routes

**Files:**
- Modify: `/root/TitanexAI/payment.js:94, 246, 348`

We need to add an admin auth check. Import the admin key and create the same `auth` middleware at the top of payment.js.

- [ ] **Step 1: Add admin auth middleware to payment.js**

After line 18 (`const ADMIN_PHONE = process.env.ADMIN_PHONE;`), add:

```javascript
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY;
const adminAuth = (req, res, next) => {
  if (req.headers["x-admin-key"] !== ADMIN_KEY) return res.status(401).json({ error: "Non autorise" });
  next();
};
```

- [ ] **Step 2: Add adminAuth to /payment/initiate**

Change line 94 from:
```javascript
router.post("/initiate", async (req, res) => {
```
To:
```javascript
router.post("/initiate", adminAuth, async (req, res) => {
```

- [ ] **Step 3: Add adminAuth to /payment/check-expirations**

Change line 246 from:
```javascript
router.post("/check-expirations", async (req, res) => {
```
To:
```javascript
router.post("/check-expirations", adminAuth, async (req, res) => {
```

- [ ] **Step 4: Add adminAuth to /payment/admin/toggle**

Change line 348 from:
```javascript
router.post("/admin/toggle", async (req, res) => {
```
To:
```javascript
router.post("/admin/toggle", adminAuth, async (req, res) => {
```

- [ ] **Step 5: Commit**

```bash
cd /root/TitanexAI && git add payment.js && git commit -m "security: add auth to payment initiate, check-expirations, admin/toggle"
```

---

### Task 6: Add JWT auth to unprotected conversation and history routes in index.js

**Files:**
- Modify: `/root/TitanexAI/auth.js` (export authJWT)
- Modify: `/root/TitanexAI/index.js:323-474`

- [ ] **Step 1: Export authJWT from auth.js**

Change the last line of `auth.js` from:
```javascript
module.exports = router;
```
To:
```javascript
router.authJWT = authJWT;
module.exports = router;
```

- [ ] **Step 2: Import authJWT in index.js and create adminAuth**

After line 349 (`app.use("/auth", authRouter);`) in index.js, add:

```javascript
const authJWT = authRouter.authJWT;
const ADMIN_KEY_IDX = process.env.ADMIN_SECRET_KEY;
const adminAuthIdx = (req, res, next) => {
  if (req.headers["x-admin-key"] !== ADMIN_KEY_IDX) return res.status(401).json({ error: "Non autorise" });
  next();
};
```

- [ ] **Step 3: Add adminAuthIdx to QR routes**

Change line 323 from:
```javascript
app.post('/qr/create', async (req, res) => {
```
To:
```javascript
app.post('/qr/create', adminAuthIdx, async (req, res) => {
```

Change line 335 from:
```javascript
app.get('/qr/status', async (req, res) => {
```
To:
```javascript
app.get('/qr/status', adminAuthIdx, async (req, res) => {
```

- [ ] **Step 4: Add authJWT to conversation mode and messages routes**

Change line 418 from:
```javascript
app.patch('/api/conversations/:phone/mode', async (req, res) => {
```
To:
```javascript
app.patch('/api/conversations/:phone/mode', authJWT, async (req, res) => {
```

Change line 445 from:
```javascript
app.get('/api/conversations/:phone/messages', async (req, res) => {
```
To:
```javascript
app.get('/api/conversations/:phone/messages', authJWT, async (req, res) => {
```

- [ ] **Step 5: Add authJWT to payment history route**

Change line 461 from:
```javascript
app.get('/payment/history', async (req, res) => {
```
To:
```javascript
app.get('/payment/history', authJWT, async (req, res) => {
```

- [ ] **Step 6: Add adminAuthIdx to WhatsApp QR tenant route**

Change line 400 from:
```javascript
app.get('/api/tenant/whatsapp/qr', async (req, res) => {
```
To:
```javascript
app.get('/api/tenant/whatsapp/qr', authJWT, async (req, res) => {
```

- [ ] **Step 7: Commit**

```bash
cd /root/TitanexAI && git add auth.js index.js && git commit -m "security: add JWT/admin auth to conversation, history, QR routes"
```

---

### Task 7: Disable /auth/login-phone (unauthenticated phone login)

**Files:**
- Modify: `/root/TitanexAI/auth.js:82-91`

- [ ] **Step 1: Disable the phone login endpoint**

Replace lines 82-91:
```javascript
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
```

With:
```javascript
// DISABLED: Phone login without OTP verification is a security vulnerability.
// TODO: Implement proper OTP (SMS code) verification before re-enabling.
router.post("/login-phone", (req, res) => {
  res.status(503).json({ error: "Login par telephone temporairement desactive. Utilisez email/mot de passe." });
});
```

- [ ] **Step 2: Commit**

```bash
cd /root/TitanexAI && git add auth.js && git commit -m "security: disable phone login (no OTP verification)"
```

---

### Task 8: Add Campay webhook signature/IP verification

**Files:**
- Modify: `/root/TitanexAI/payment.js:136-137`

Campay does not provide HMAC signatures, so we use IP allowlisting. Campay's servers send webhooks from known IPs. As a defense-in-depth measure, we also validate the required fields.

- [ ] **Step 1: Add webhook verification middleware**

Before the webhook route (before line 136), add:

```javascript
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
```

- [ ] **Step 2: Apply middleware to webhook route**

Change line 136 from:
```javascript
router.post("/webhook", async (req, res) => {
```
To:
```javascript
router.post("/webhook", verifyCampayWebhook, async (req, res) => {
```

- [ ] **Step 3: Add CAMPAY_WEBHOOK_IPS to .env**

```bash
cd /root/TitanexAI && echo "" >> .env && echo "# Campay webhook allowed IPs (comma-separated, empty = allow all with field validation)" >> .env && echo "CAMPAY_WEBHOOK_IPS=" >> .env
```

- [ ] **Step 4: Commit**

```bash
cd /root/TitanexAI && git add payment.js && git commit -m "security: add Campay webhook IP verification and field validation"
```

---

### Task 9: Sanitize error responses (stop leaking internals)

**Files:**
- Modify: `/root/TitanexAI/auth.js` (multiple catch blocks)
- Modify: `/root/TitanexAI/admin.js` (multiple catch blocks)
- Modify: `/root/TitanexAI/payment.js` (multiple catch blocks)
- Modify: `/root/TitanexAI/index.js` (multiple catch blocks)

- [ ] **Step 1: Fix auth.js catch blocks**

In `auth.js`, change all `catch(e) { res.status(500).json({ error: e.message }); }` to:
```javascript
catch(e) { console.error('[AUTH ERROR]', e.message); res.status(500).json({ error: 'Erreur interne' }); }
```

Apply to lines: 64, 131, 134, 158, 169, 184, 193, 206, 213, 221, 228, 239, 251, 265, 282, 292, 313, 335, 432.

Keep the existing specific error handlers (400, 401, 404, 409) — only change the generic 500 catch blocks.

- [ ] **Step 2: Fix admin.js catch blocks**

Apply the same pattern, changing `{ error: e.message }` to `{ error: 'Erreur interne' }` and adding a console.error, for all 500 catch blocks in admin.js.

- [ ] **Step 3: Fix payment.js catch blocks**

Apply the same pattern to all 500 catch blocks in payment.js (lines 131, 284, 298, 344, 372).

- [ ] **Step 4: Fix index.js catch blocks**

Apply the same pattern to catch blocks at lines: 333, 414, 442, 457, 473, 604.

- [ ] **Step 5: Commit**

```bash
cd /root/TitanexAI && git add auth.js admin.js payment.js index.js && git commit -m "security: sanitize error responses, stop leaking internal details"
```

---

### Task 10: Verify and restart

**Files:** None (verification only)

- [ ] **Step 1: Verify server starts cleanly**

```bash
cd /root/TitanexAI && timeout 5 node index.js 2>&1 || true
```

Expected: Server starts on port 3001 without crashes.

- [ ] **Step 2: Verify .env has all required variables**

```bash
cd /root/TitanexAI && node -e "
  require('dotenv').config();
  const required = ['JWT_SECRET','ADMIN_SECRET_KEY','SUPABASE_URL','SUPABASE_KEY','GROQ_API_KEY','EVOLUTION_API_URL','EVOLUTION_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) { console.error('MISSING:', missing); process.exit(1); }
  console.log('All required env vars present');
"
```

Expected: `All required env vars present`

- [ ] **Step 3: Restart PM2 process**

```bash
cd /root/TitanexAI && pm2 restart titanex-agent && pm2 logs titanex-agent --lines 10
```

Expected: Process restarts, logs show "Titanex AI actif sur le port 3001"

- [ ] **Step 4: Quick smoke test — verify unauthenticated routes are blocked**

```bash
# Should return 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/admin/catalogue/test
# Should return 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/payment/admin/toggle
# Should return 401
curl -s -o /dev/null -w "%{http_code}" -X GET http://localhost:3001/api/conversations/237123456/messages
# Should return 503
curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{"telephone":"237123456"}' http://localhost:3001/auth/login-phone
```

Expected: `401`, `401`, `401`, `503`
