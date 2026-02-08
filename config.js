/* ============================
  Pokémon TCG DB — config.js
  (Sin inventar conexiones raras: solo separa constantes del app.js)
============================ */

export const CFG = {
  // TSV publicado de Google Sheets (lectura)
  TSV_URL:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQN91ZJdYxmx7F4Hq8WDFXVkgb9Ajedt8AR3STp_ytNQij8uJ4rPgT5qhs89jDGRp1268fVnzy81jaW/pub?gid=1121445311&single=true&output=tsv",

  // WebApp de Apps Script (escritura)
  API_URL:
    "https://script.google.com/macros/s/AKfycbwg5ZSXnKlG4QJiYCVpHlaOF_-mbB2y9sF7zHOifoFTgjryjdHtnUIkY-BYkPIZdGE/exec",

  // localStorage keys
  STORAGE: {
    tsvCache: "pkm_tsv_cache_v1",
    tsvCacheAt: "pkm_tsv_cache_at_v1",
  },

  // Red/UX
  NET: {
    fetchTimeoutMs: 12000,
    toastMs: 2400,
    searchDebounceMs: 120,
  },

  // IDs
  ID_PREFIX: "pkm_",
};
