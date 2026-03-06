import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const VERIFY_TOKEN = "Titanex_AI_2026"; // Votre token configuré

serve(async (req) => {
  const url = new URL(req.url);

  // --- ÉTAPE 1 : LE HANDSHAKE (Vérification de Meta) ---
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode && token) {
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("✅ Webhook vérifié avec succès !");
        return new Response(challenge, { status: 200 });
      } else {
        console.error("❌ Token de vérification incorrect.");
        return new Response("Forbidden", { status: 403 });
      }
    }
  }

  // --- ÉTAPE 2 : RÉCEPTION DES MESSAGES (POST) ---
  if (req.method === "POST") {
    try {
      const body = await req.json();
      console.log("📩 Nouveau message reçu :", JSON.stringify(body, null, 2));

      // Ici, vous ajouterez la logique pour répondre via l'IA Titanex
      
      return new Response("EVENT_RECEIVED", { status: 200 });
    } catch (err) {
      console.error("❌ Erreur lors du traitement du message :", err);
      return new Response("Error", { status: 400 });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
})