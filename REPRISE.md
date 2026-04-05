=== RÉSUMÉ DE REPRISE — TITANEX AI ===

Date : 27 mars 2026

PROJET : Titanex AI — SaaS WhatsApp multi-tenant UNIVERSEL
VPS : root@148.230.114.82 | Port 3001 | PM2 : titanex-agent
Domaine : https://titanexai.com
DB : Supabase — projet fkhbkxaqlehdlqnybqxt
Admin key : titanex-admin-2026

STACK :
* Node.js/Express → /root/TitanexAI/
* Dashboard → /root/TitanexAI/dashboard/
* Landing → /root/TitanexAI/landing.html
* WhatsApp : Evolution API, instance dev prospect_1774206371368 (+237652249455)
* IA : Groq llama-3.3-70b-versatile + prompt universel intelligent
* Paiements : Campay webhook fonctionnel

PRINCIPE UNIVERSEL :
Titanex AI est une application SaaS — tout doit fonctionner automatiquement
pour N'IMPORTE QUEL tenant qui s'inscrit, sans intervention manuelle.

FLUX AUTOMATIQUE POUR TOUT NOUVEAU TENANT :
1. Inscription → tenant créé en Supabase
2. Paiement Campay → webhook active le tenant
3. Store créé automatiquement avec prompt universel + numéro du tenant
4. Instance WhatsApp activée automatiquement
5. Agent IA opérationnel immédiatement
6. Onboarding wizard 3 étapes au premier login

ÉTAT ACTUEL :
✅ Auth JWT + routes API
✅ Campay webhook end-to-end
✅ Agent IA intelligent (conscience du temps, relance, closing)
✅ Images produits envoyées sur WhatsApp
✅ Conversations sauvegardées Supabase (toutes instances)
✅ Dashboard conversations avec filtres temps réel
✅ Responsive mobile dashboard + landing
✅ Auto-création store pour nouveaux tenants
✅ Widget WhatsApp animé sur landing mobile
✅ botNumbers: seul +237672482763 bloqué
✅ Page Paiements admin (toutes transactions)
✅ Page Mes Transactions tenant (filtrée par user via JWT)
✅ Gestion utilisateurs: Suspendre/Bloquer/Bannir/Activer
✅ Command Center toujours visible pour admin
✅ Bilan quotidien automatique à 21h00 selon timezone de chaque tenant
✅ Notifications push admin WhatsApp (inscription, paiement, nouveau prospect)
✅ Top Pays superadmin avec données réelles (détection par préfixe téléphone)
✅ Tracking visites temps réel + Statistiques superadmin (device, source, OS, évolution)
✅ Mode Manuel/Agent IA par contact (conv_mode dans conversations, PATCH /api/conversations/:phone/mode)

=== SESSION 27 MARS — 4 FONCTIONNALITÉS MAJEURES ===

✅ 1. CATALOGUE PRODUITS (API JWT tenant)
   - Routes JWT: GET/POST/PATCH/DELETE /api/tenant/catalogue
   - Le catalogue existant dans dashboard/index.html utilise déjà les routes admin
   - Nouvelles routes JWT sécurisées par tenant (instance_name filtré automatiquement)
   - Ajout, modification, suppression, listing avec images base64

✅ 2. PAGE "MA BOUTIQUE" (Configuration boutique)
   - Nouvelle page dans dashboard: "Ma Boutique" (nav item + page-boutique)
   - Champs: nom boutique, logo (upload base64), description, Orange Money, MTN MoMo, timezone, langue
   - Routes: GET /api/tenant/store, PATCH /api/tenant/store (auth JWT)
   - Les infos sont utilisées automatiquement par l'agent IA
   - Sauvegarde dans tables tenants + stores

✅ 3. ONBOARDING WIZARD 3 ÉTAPES
   - Détection automatique au login (onboarding_done=false → affiche wizard)
   - Étape 1: Nom boutique, Orange Money, MTN MoMo, Timezone
   - Étape 2: Premier produit (nom, prix, description, image optionnelle)
   - Étape 3: Connexion WhatsApp via QR code
   - Barre de progression (1/3, 2/3, 3/3) avec dots animés
   - Boutons Suivant/Précédent/Terminer
   - Confettis à la fin !
   - Routes: GET /api/tenant/onboarding-status, POST /api/tenant/onboarding-done
   - Note: colonne onboarding_done nécessaire dans table tenants Supabase

✅ 4. STATISTIQUES DE VENTE
   Dashboard tenant (page-home enrichie):
   - 4 cartes stats: Revenus 30j, Commandes, Taux conversion, Meilleur jour
   - Graphique barres: Ventes 7 derniers jours (Chart.js)
   - Graphique ligne: Conversations par jour (Chart.js)
   - Top 3 produits les plus demandés (basé sur mentions dans conversations)
   - Route: GET /api/tenant/stats (auth JWT)

   Superadmin (superadmin.html):
   - Graphique barres: Revenus globaux cumulés 30 jours
   - Top 5 tenants les plus actifs (par nombre de conversations)
   - Carte: Total transactions du mois + MRR estimé
   - Route: GET /api/admin/stats (améliorée avec revenue_by_day, top5_tenants, etc.)

ROUTES API AJOUTÉES (session 27 mars):
* GET    /api/tenant/catalogue      (JWT) — liste produits du tenant
* POST   /api/tenant/catalogue      (JWT) — ajouter produit
* PATCH  /api/tenant/catalogue/:id  (JWT) — modifier produit
* DELETE /api/tenant/catalogue/:id  (JWT) — supprimer produit
* GET    /api/tenant/store          (JWT) — config boutique
* PATCH  /api/tenant/store          (JWT) — sauvegarder config boutique
* GET    /api/tenant/onboarding-status (JWT) — statut onboarding
* POST   /api/tenant/onboarding-done   (JWT) — marquer onboarding terminé
* GET    /api/tenant/stats          (JWT) — statistiques ventes tenant

COLONNES SUPABASE ✅ AJOUTÉES (27 mars):
* tenants: onboarding_done (boolean, default false)
* tenants: orange_money (text)
* tenants: mtn_momo (text)
* tenants: timezone (text, default 'Africa/Douala')
* tenants: preferred_lang (text, default 'fr')
* tenants: merchant_name (text)
* stores: description (text)

NUMÉROS IMPORTANTS :
* Dev/Test : +237652249455 (prospect_1774206371368)
* Bloqué définitivement : +237672482763
* Débanni : +237680094766

ROUTES API AJOUTÉES (session 27 mars — suite):
* GET /api/admin/stats/pays?days=30 (admin key) — top pays réels par préfixe téléphone
* POST /api/track/visit (publique) — tracking visites landing (device, OS, source)
* GET /api/admin/stats/visits?days=30 (admin key) — stats visites (device, source, OS, byDay)
* PATCH /api/conversations/:phone/mode (publique) — bascule auto/manuel par contact

COLONNE SUPABASE REQUISE:
* conversations: conv_mode (text, default 'auto') — ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS conv_mode text DEFAULT 'auto';

À FAIRE (prochaines sessions) :
* Tester inscription end-to-end nouveau tenant
* Intégration paiement mobile dans l'agent IA (instructions automatiques avec numéros du tenant)
* Page publique vitrine boutique par tenant
