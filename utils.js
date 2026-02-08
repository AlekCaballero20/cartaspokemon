/* ============================
  Pokémon TCG DB — utils.js (PRO++)
  Utilidades generales (sin DOM, sin red)
  - Normalización consistente (tildes/espacios)
  - Debounce con cancel/flush
  - Parsing numérico tolerante (miles/decimales)
  - Tiempo “hace X” en ES
  - IDs estables
  - TSV parse (si lo necesitas fuera de services)
  - Arrays: unique + sort + merge
============================ */

/* =========================
   TEXT
========================= */

/**
 * Normaliza texto para búsquedas:
 * - trim
 * - lower
 * - quita tildes
 * - colapsa espacios
 */
export function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Normaliza SOLO para mostrar:
 * - colapsa multi-espacio
 */
export function cleanText(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/* =========================
   TIME
========================= */

/**
 * "hace 2 min", "hace 3 h", etc.
 */
export function formatTimeAgo(ts) {
  const base = Number(ts || 0);
  if (!Number.isFinite(base) || base <= 0) return "hace un rato";

  const diff = Math.max(0, Date.now() - base);
  const sec = Math.floor(diff / 1000);
  if (sec < 15) return "hace segundos";

  const m = Math.floor(sec / 60);
  if (m < 60) return `hace ${m} min`;

  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;

  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;

  const mo = Math.floor(d / 30);
  if (mo < 12) return `hace ${mo} mes${mo === 1 ? "" : "es"}`;

  const y = Math.floor(mo / 12);
  return `hace ${y} año${y === 1 ? "" : "s"}`;
}

/* =========================
   ID
========================= */

export function makeId(prefix = "pkm_") {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}${t}_${r}`;
}

/* =========================
   DEBOUNCE
========================= */

/**
 * Debounce con control:
 * const fn = debounce(cb, 150);
 * fn(...); fn.cancel(); fn.flush();
 */
export function debounce(fn, ms = 120) {
  let t = null;
  let lastArgs = null;
  let lastThis = null;

  function debounced(...args) {
    lastArgs = args;
    lastThis = this;
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn.apply(lastThis, lastArgs);
      lastArgs = lastThis = null;
    }, Math.max(0, ms | 0));
  }

  debounced.cancel = () => {
    clearTimeout(t);
    t = null;
    lastArgs = lastThis = null;
  };

  debounced.flush = () => {
    if (!t) return;
    clearTimeout(t);
    t = null;
    fn.apply(lastThis, lastArgs);
    lastArgs = lastThis = null;
  };

  return debounced;
}

/* =========================
   NUMBERS
========================= */

/**
 * Convierte strings con miles/decimales:
 * - "25.000" -> 25000
 * - "25,000" -> 25000
 * - "25,5"   -> 25.5
 * - "  $ 25.000 " -> 25000 (si viene sucio)
 */
export function toNumber(x) {
  const s = String(x ?? "")
    .trim()
    .replace(/[^\d.,\-]/g, "")   // quita símbolos (moneda, etc.)
    .replace(/\s+/g, "");

  if (!s) return NaN;

  // quita separadores de miles comunes y normaliza decimal a "."
  const normalized = s
    .replace(/\.(?=\d{3}(\D|$))/g, "") // puntos miles
    .replace(/,(?=\d{3}(\D|$))/g, "")  // comas miles
    .replace(",", ".");                // decimal coma -> punto

  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function isFiniteNumber(x) {
  return Number.isFinite(toNumber(x));
}

export function isFiniteInteger(x) {
  const n = toNumber(x);
  return Number.isFinite(n) && Number.isInteger(n);
}

/* =========================
   TSV (fallback)
========================= */

export function tsvToArray(tsvText) {
  const clean = String(tsvText ?? "").replace(/\r/g, "").trim();
  if (!clean) return [];
  return clean
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t").map((v) => String(v ?? "").trim()));
}

/* =========================
   ARRAYS
========================= */

export function uniqueSorted(arr) {
  const seen = new Set();
  const out = [];

  (arr || []).forEach((x) => {
    const v = String(x ?? "").trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  });

  return out.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

export function mergeUnique(primary = [], fallback = []) {
  const seen = new Set();
  const out = [];

  [...primary, ...fallback].forEach((x) => {
    const v = String(x ?? "").trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  });

  return out;
}

/**
 * Agrupa por clave (helper útil si luego haces filtros por set/tipo etc.)
 */
export function groupBy(arr, keyFn) {
  const m = new Map();
  (arr || []).forEach((item) => {
    const k = keyFn(item);
    const kk = k == null ? "" : String(k);
    if (!m.has(kk)) m.set(kk, []);
    m.get(kk).push(item);
  });
  return m;
}
