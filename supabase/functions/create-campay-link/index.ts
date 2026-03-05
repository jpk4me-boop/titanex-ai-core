import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Configuration CORS pour autoriser ton site React à appeler cette fonction
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Gérer la requête préliminaire (CORS preflight) envoyée par le navigateur
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { amount, affiliateId, description } = await req.json()

    // 1. Initialiser Supabase de manière sécurisée
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    let referenceId = "TX-" + Date.now(); // Référence de secours si pas d'affilié

    // 2. Si un code promo a été utilisé, on enregistre la commission "en attente"
    if (affiliateId) {
      const { data: commissionData, error: commissionError } = await supabase
        .from('commissions')
        .insert([{
          affiliate_id: affiliateId,
          amount: 5000,
          status: 'en attente',
          promo_code_used: "Appliqué lors du paiement" 
        }])
        .select('id')
        .single();

      if (commissionError) throw commissionError;
      
      // La référence de la transaction envoyée à Campay sera l'ID de cette commission !
      referenceId = commissionData.id; 
    }

    // 3. S'authentifier chez Campay pour obtenir un jeton (Token)
    const campayTokenResponse = await fetch('https://www.campay.net/api/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: Deno.env.get('CAMPAY_USERNAME'),
        password: Deno.env.get('CAMPAY_PASSWORD')
      })
    });
    
    if (!campayTokenResponse.ok) throw new Error("Erreur d'authentification Campay");
    const tokenData = await campayTokenResponse.json();
    const token = tokenData.token;

    // 4. Demander le lien de paiement dynamique à Campay
    const campayLinkResponse = await fetch('https://www.campay.net/api/get_payment_link/', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amount,
        currency: "XAF",
        description: description,
        external_reference: referenceId, // TRÈS IMPORTANT : c'est ce qui liera le paiement à la commission
        notify_url: "https://fkhbkxaqlehdlqnybqxt.supabase.co/functions/v1/payment-webhook" // Notre webhook précédent !
      })
    });

    if (!campayLinkResponse.ok) throw new Error("Erreur lors de la création du lien Campay");
    const linkData = await campayLinkResponse.json();

    // 5. Renvoyer le lien officiel à ton interface React
    return new Response(JSON.stringify({ payment_url: linkData.link }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("Erreur serveur :", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})