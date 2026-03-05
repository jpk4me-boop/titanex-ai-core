import React from 'react';
import { usePromoCode } from '../hooks/usePromoCode';

export default function Checkout() {
  // On importe les super-pouvoirs de ton fichier usePromoCode.js
  const {
    promoCode,
    setPromoCode,
    isValidating,
    promoMessage,
    originalPrice,
    finalPrice,
    handleApplyPromoCode
  } = usePromoCode();

  const [isRedirecting, setIsRedirecting] = React.useState(false);

  const handlePaymentClick = async () => {
    setIsRedirecting(true);
    
    try {
      // 1. On appelle notre fonction sécurisée sur le serveur Supabase
      const { data, error } = await supabase.functions.invoke('create-campay-link', {
        body: {
          amount: finalPrice,
          affiliateId: affiliateId,
          description: "Abonnement Titanex AI Pro - 1 Mois"
        }
      });

      if (error) throw error;

      // 2. Campay nous a renvoyé un lien sécurisé, on y envoie le client !
      if (data && data.payment_url) {
        window.location.href = data.payment_url;
      } else {
        throw new Error("Lien de paiement introuvable");
      }

    } catch (err) {
      console.error("Erreur lors de la création du paiement :", err);
      alert("Une erreur est survenue lors de la connexion à Campay. Veuillez réessayer.");
      setIsRedirecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="max-w-4xl w-full bg-white rounded-xl shadow-lg flex flex-col md:flex-row overflow-hidden">
        
        {/* Colonne de Gauche : Détails du paiement */}
        <div className="w-full md:w-1/2 p-8 border-b md:border-b-0 md:border-r border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">Finalisez votre abonnement</h2>
          <p className="text-gray-600 mb-8">Abonnement Titanex AI Pro - Accès complet à votre agent de vente IA sur WhatsApp et Telegram.</p>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-8">
            <p className="text-sm text-blue-800 font-medium mb-3">Moyens de paiement acceptés :</p>
            <div className="flex gap-4">
              <span className="bg-yellow-400 text-black px-3 py-1 rounded shadow-sm font-bold text-sm">MTN MoMo</span>
              <span className="bg-orange-500 text-white px-3 py-1 rounded shadow-sm font-bold text-sm">Orange Money</span>
            </div>
          </div>

          <button
            onClick={handlePaymentClick}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-lg transition duration-200 text-lg shadow-md"
          >
            Payer {finalPrice.toLocaleString('fr-FR')} FCFA
          </button>
          <p className="text-xs text-center text-gray-400 mt-4">Paiement 100% sécurisé par Campay</p>
        </div>

        {/* Colonne de Droite : Résumé & Code Promo */}
        <div className="w-full md:w-1/2 p-8 bg-gray-50 flex flex-col justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-800 mb-6">Résumé de la commande</h3>

            <div className="flex justify-between text-gray-600 mb-4">
              <span>Abonnement Pro (1 Mois)</span>
              <span>{originalPrice.toLocaleString('fr-FR')} FCFA</span>
            </div>

            {/* Cette ligne n'apparaît que si une réduction est appliquée */}
            {originalPrice !== finalPrice && (
              <div className="flex justify-between text-green-600 mb-4 font-medium">
                <span>Réduction partenaire</span>
                <span>- {(originalPrice - finalPrice).toLocaleString('fr-FR')} FCFA</span>
              </div>
            )}

            <div className="border-t border-gray-200 my-4 pt-4 flex justify-between font-bold text-xl text-gray-800">
              <span>Total à payer</span>
              <span>{finalPrice.toLocaleString('fr-FR')} FCFA</span>
            </div>
          </div>

          <div className="mt-8">
            <label className="block text-sm font-medium text-gray-700 mb-2">Code partenaire (Optionnel)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="Ex: TITAN-..."
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleApplyPromoCode}
                disabled={isValidating || !promoCode}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium disabled:bg-blue-300 transition"
              >
                {isValidating ? 'Vérification...' : 'Appliquer'}
              </button>
            </div>

            {/* Affichage du message de succès ou d'erreur */}
            {promoMessage.text && (
              <p className={`mt-2 text-sm font-medium ${promoMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {promoMessage.text}
              </p>
            )}
          </div>
        </div>
        
      </div>
    </div>
  );
}