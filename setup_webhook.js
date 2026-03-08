const axios = require('axios');

const config = {
  method: 'post',
  url: 'http://localhost:8080/webhook/set/titanex_instance',
  headers: { 
    'apikey': '429683C4C977415CAAFCCE10F7D57E11', 
    'Content-Type': 'application/json'
  },
  data: {
    "webhook": {
      "enabled": true,
      "url": "http://localhost:3001/webhook",
      "byEvents": false,
      "events": ["MESSAGES_UPSERT"]
    }
  }
};

axios(config)
  .then(res => console.log('✅ Webhook configuré avec succès !'))
  .catch(err => {
    console.error('❌ Détails de l\'erreur :');
    console.dir(err.response ? err.response.data : err.message, { depth: null });
  });
