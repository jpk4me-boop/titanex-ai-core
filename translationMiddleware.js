"use strict";
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const SUPPORTED_LANGUAGES = {
  fr:'Français', en:'English', ar:'Arabe', zh:'Mandarin (Chinois)',
  es:'Español', pt:'Português', de:'Deutsch', it:'Italiano',
  ru:'Русский', tr:'Türkçe', ha:'Hausa', yo:'Yoruba', sw:'Swahili',
};

const ADMIN_LANGUAGE = process.env.ADMIN_LANGUAGE || 'fr';
const MODEL = 'claude-haiku-4-5-20251001'; // modèle rapide et économique

async function detectLanguage(text) {
  try {
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 100,
      system: 'Détecteur de langue. Réponds UNIQUEMENT en JSON valide. Format: {"code":"XX","name":"Nom","confidence":"high|medium|low"}',
      messages: [{ role: 'user', content: `Détecte la langue: "${text.substring(0, 200)}"` }],
    });
    return JSON.parse(r.content[0].text.trim());
  } catch(e) {
    console.error('[LANG DETECT ERROR]', e.message);
    return { code: 'fr', name: 'Français', confidence: 'low' };
  }
}

async function translateText(text, targetLanguage, sourceLanguage = null) {
  if (sourceLanguage && sourceLanguage === targetLanguage) {
    return { translatedText: text, originalText: text };
  }
  const targetName = SUPPORTED_LANGUAGES[targetLanguage] || targetLanguage;
  try {
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 1000,
      system: 'Traducteur expert B2B. Traduis UNIQUEMENT le texte, sans commentaire ni guillemets.',
      messages: [{ role: 'user', content: `Traduis vers le ${targetName}:\n\n${text}` }],
    });
    return { translatedText: r.content[0].text.trim(), originalText: text };
  } catch(e) {
    console.error('[TRANSLATE ERROR]', e.message);
    return { translatedText: text, originalText: text };
  }
}

async function getContactLanguage(contactId) {
  try {
    const { data } = await supabase
      .from('contacts').select('detected_language').eq('contact_id', contactId).single();
    return data?.detected_language || null;
  } catch(e) { return null; }
}

async function saveContactLanguage(contactId, languageCode) {
  try {
    await supabase.from('contacts').upsert(
      { contact_id: contactId, detected_language: languageCode, language_updated_at: new Date().toISOString() },
      { onConflict: 'contact_id' }
    );
  } catch(e) { console.error('[SAVE LANG ERROR]', e.message); }
}

async function processIncomingMessage(contactId, rawMessage) {
  try {
    let lang = await getContactLanguage(contactId);
    let isNew = false;
    if (!lang) {
      const d = await detectLanguage(rawMessage);
      lang = d.code;
      isNew = true;
      await saveContactLanguage(contactId, lang);
    }
    if (lang === ADMIN_LANGUAGE) {
      return { originalMessage: rawMessage, translatedMessage: rawMessage, detectedLanguage: { code: lang, name: SUPPORTED_LANGUAGES[lang] }, needsTranslation: false, isNewDetection: isNew };
    }
    const { translatedText } = await translateText(rawMessage, ADMIN_LANGUAGE, lang);
    return { originalMessage: rawMessage, translatedMessage: translatedText, detectedLanguage: { code: lang, name: SUPPORTED_LANGUAGES[lang] }, needsTranslation: true, isNewDetection: isNew };
  } catch(e) {
    console.error('[INCOMING MSG ERROR]', e.message);
    return { originalMessage: rawMessage, translatedMessage: rawMessage, detectedLanguage: { code: 'fr', name: 'Français' }, needsTranslation: false };
  }
}

async function processOutgoingMessage(contactId, adminResponse) {
  try {
    const lang = await getContactLanguage(contactId);
    if (!lang || lang === ADMIN_LANGUAGE) {
      return { originalResponse: adminResponse, translatedResponse: adminResponse, targetLanguage: { code: ADMIN_LANGUAGE, name: SUPPORTED_LANGUAGES[ADMIN_LANGUAGE] }, translated: false };
    }
    const { translatedText } = await translateText(adminResponse, lang, ADMIN_LANGUAGE);
    return { originalResponse: adminResponse, translatedResponse: translatedText, targetLanguage: { code: lang, name: SUPPORTED_LANGUAGES[lang] }, translated: true };
  } catch(e) {
    console.error('[OUTGOING MSG ERROR]', e.message);
    return { originalResponse: adminResponse, translatedResponse: adminResponse, translated: false };
  }
}

module.exports = {
  processIncomingMessage,
  processOutgoingMessage,
  detectLanguage,
  translateText,
  getContactLanguage,
  saveContactLanguage,
  SUPPORTED_LANGUAGES,
  ADMIN_LANGUAGE
};
