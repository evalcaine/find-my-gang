// frontend/js/config.js

// Base API dinámica (funciona en localhost y producción)
window.CONFIG = {
  API_BASE: window.location.origin,

  SUPABASE_URL: 'https://wbdlvxisyktesdylhlsg.supabase.co',
  SUPABASE_KEY: 'sb_publishable_siYPKtcJxDZRE-vRJ79gxA_e9vrmfUP'
};

// Inicializar cliente Supabase una sola vez
window.supabaseClient = supabase.createClient(
  window.CONFIG.SUPABASE_URL,
  window.CONFIG.SUPABASE_KEY
);