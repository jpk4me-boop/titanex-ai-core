import { useState } from 'react';
import { supabase } from './supabaseClient'; // Ton client Supabase configuré

export function usePromoCode() {
  const [promoCode, setPromoCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [promoMessage, setPromoMessage] = useState({ text: '', type: '' });
  const [affiliateId, setAffiliateId] = useState(null); // Pour stocker l'ID de l'agent
  const originalPrice = 25000; // Prix de l'abonnement en FCFA
  const [finalPrice, setFinalPrice] = useState(originalPrice);

  const handleApplyPromoCode = async () => {
    if (!promoCode.trim()) return;

    setIsValidating(true);
    setPromoMessage({ text: '', type: '' });

    try {
      // 1. Chercher le code dans la table promo_codes
      const { data, error } = await supabase
        .from('promo_codes')
        .select('id, affiliate_id, is_active')
        .eq('code', promoCode)
        .single();

      if (error || !data) {
        setPromoMessage({ text: "Ce code promo n'existe pas.", type: "error" });
        return;
      }

      if (!data.is_active) {
        setPromoMessage({ text: "Ce code promo n'est plus actif.", type: "error" });
        return;
      }

      // 2. Si le code est valide
      setAffiliateId(data.affiliate_id);
      
      // Optionnel : Appliquer une réduction au client (ex: 10% de réduction)
      // Si tu ne fais pas de réduction au client, laisse le finalPrice tel quel.
      const discount = originalPrice * 0.10; 
      setFinalPrice(originalPrice - discount);

      setPromoMessage({ 
        text: "Code valide ! Vous soutenez un agent partenaire.", 
        type: "success" 
      });

    } catch (err) {
      setPromoMessage({ text: "Erreur lors de la vérification.", type: "error" });
    } finally {
      setIsValidating(false);
    }
  };

  return {
    promoCode,
    setPromoCode,
    isValidating,
    promoMessage,
    originalPrice,
    finalPrice,
    affiliateId,
    handleApplyPromoCode
  };
}