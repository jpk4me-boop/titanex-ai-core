import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  // 1. Récupération de la clé API que vous avez enregistrée dans les Secrets Supabase
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

  if (!FIRECRAWL_API_KEY) {
    return new Response(JSON.stringify({ error: "Clé API Firecrawl manquante dans les Secrets." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // 2. Appel test à Firecrawl pour lire une page simple
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
      },
      body: JSON.stringify({
        url: 'https://example.com', // Page de test simple
        formats: ['markdown']
      })
    });

    const data = await response.json();

    // 3. Retour du résultat à votre interface Titanex
    return new Response(JSON.stringify({ 
      status: "Connexion établie !", 
      message: "Firecrawl a réussi à lire la page de test.",
      preview: data.data?.markdown?.substring(0, 100) + "..." 
    }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
})