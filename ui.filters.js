/* ============================
  Pokémon TCG DB — ui.filters.js (PRO+++)
  - Filtro + búsqueda (sin red, sin render)
  - Optimizado: solo columnas relevantes (SEARCH_KEYS o derivadas)
  - Normaliza query (tildes/espacios) para mejor match
  - Mini-sintaxis opcional:
      tipo:pokemon  set:sv  anio:2024  idioma:en  hp>80  precio<30000  #:"012/198"
      de:pichu  a:raichu  from:pichu  to:raichu
============================ */

import { TABLE_COLUMNS, SEARCH_KEYS } from "./data.schema.js";
import { norm } from "./utils.js";

/**
 * Aplica búsqueda (query) a la data.
 *
 * @param {string[][]} rows     - filas de datos (sin header)
 * @param {string}     query    - texto de búsqueda
 * @param {Object}     colIndex - { key: index } mapeado por header real
 * @param {Object}     opts     - opciones
 * @param {string[]}   opts.keys - keys canónicas a considerar (override)
 *
 * @returns {string[][]}
 */
export function filterRows(rows, query, colIndex, opts = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const rawQ = String(query ?? "").trim();
  if (!rawQ) return safeRows.slice();

  const keys = Array.isArray(opts.keys) && opts.keys.length
    ? opts.keys
    : buildDefaultSearchKeys_();

  // Intenta parsear query avanzada: "campo:valor"
  const parsed = parseAdvancedQuery_(rawQ);

  // Si no hay tokens avanzados, usamos búsqueda normal (rápida)
  if (!parsed.hasTokens) {
    const q = norm(rawQ);
    return safeRows.filter((row) => rowMatchesLoose_(row, q, colIndex, keys));
  }

  // Mezcla: términos sueltos + tokens campo:valor
  const looseQ = parsed.freeText ? norm(parsed.freeText) : "";
  const tokens = parsed.tokens;

  return safeRows.filter((row) => {
    if (looseQ && !rowMatchesLoose_(row, looseQ, colIndex, keys)) return false;
    return tokens.every((t) => rowMatchesToken_(row, t, colIndex));
  });
}

/* =========================
   DEFAULT KEYS
========================= */

function buildDefaultSearchKeys_() {
  // Priorizamos SEARCH_KEYS si existe (mejor control)
  if (Array.isArray(SEARCH_KEYS) && SEARCH_KEYS.length) return SEARCH_KEYS.slice();

  // Fallback: visible + unos extra útiles
  const set = new Set(TABLE_COLUMNS.map((c) => c.key));
  set.add("idioma");
  set.add("subtipo");
  set.add("notas");
  set.add("anio");
  set.add("evoluciona_de");
  set.add("evoluciona_a");
  return Array.from(set);
}

/* =========================
   MATCHING
========================= */

function rowMatchesLoose_(row, qNorm, colIndex, keys) {
  // Busca el query en cualquiera de las columnas relevantes
  for (const k of keys) {
    const i = idx(colIndex, k);
    if (i < 0) continue;
    const v = norm(row?.[i] ?? "");
    if (v.includes(qNorm)) return true;
  }
  return false;
}

function rowMatchesToken_(row, token, colIndex) {
  // token = { key, op, value }
  // op soportados: ":" (contains) | "=" (exact) | ">" | "<" (num)
  const i = idx(colIndex, token.key);
  if (i < 0) return false;

  const cellRaw = String(row?.[i] ?? "").trim();
  const cellNorm = norm(cellRaw);
  const valNorm = norm(token.value);

  if (token.op === ":") {
    return cellNorm.includes(valNorm);
  }

  if (token.op === "=") {
    return cellNorm === valNorm;
  }

  // comparaciones numéricas (hp, precio, cantidad, anio, etc.)
  if (token.op === ">" || token.op === "<") {
    const a = toNumber_(cellRaw);
    const b = toNumber_(token.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return token.op === ">" ? a > b : a < b;
  }

  // default: contains
  return cellNorm.includes(valNorm);
}

/* =========================
   ADVANCED QUERY PARSER
========================= */

/**
 * Soporta tokens tipo:
 *  - tipo:pokemon
 *  - set:scarlet
 *  - idioma:en
 *  - hp>80
 *  - precio<30000
 *  - #:"012/198"   (comillas para mantener / espacios)
 *  - de:pichu  a:raichu
 *
 * Campos reconocidos (sinónimos):
 *  - "#"  -> num
 *  - set  -> edicion
 *  - tipo -> tipo
 *  - cat  -> tipo
 *  - elemento/energy -> atributo
 *  - hp   -> nivel
 *  - sub  -> subtipo
 *  - qty/cant -> cantidad
 *  - lang -> idioma
 *  - price -> precio
 *  - fecha/date -> fecha_compra
 *  - notas/notes -> notas
 *  - nombre/name -> nombre
 *  - año/anio/year -> anio
 *  - de/from/evoluciona_de -> evoluciona_de
 *  - a/to/evoluciona_a -> evoluciona_a
 */
function parseAdvancedQuery_(q) {
  const tokens = [];
  const consumed = [];

  // Extrae cosas como key:valor, key=valor, key>n, key<n
  // Permite valor entre comillas "..."/'...'
  const re = /(^|\s)([a-zA-ZñÑ#_]+)\s*([:=<>])\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+)/g;

  let match;
  while ((match = re.exec(q)) !== null) {
    const rawKey = match[2] || "";
    const op = match[3] || ":";
    let rawVal = match[4] || "";
    rawVal = stripQuotes_(rawVal);

    const key = mapFieldAlias_(rawKey);
    if (!key || !rawVal) continue;

    tokens.push({ key, op, value: rawVal });
    consumed.push(match[0]);
  }

  const hasTokens = tokens.length > 0;

  // freeText = query sin los tokens (para combinar)
  let freeText = q;
  for (const part of consumed) freeText = freeText.replace(part, " ");
  freeText = freeText.replace(/\s+/g, " ").trim();

  return { hasTokens, tokens, freeText };
}

function stripQuotes_(s) {
  const v = String(s ?? "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).replace(/\\(["'])/g, "$1");
  }
  return v;
}

function mapFieldAlias_(rawKey) {
  const k = norm(rawKey);

  // num
  if (k === "#" || k === "num" || k === "numero" || k === "n") return "num";

  // set/edicion
  if (k === "set" || k === "edicion" || k === "expansion" || k === "coleccion") return "edicion";

  // nombre
  if (k === "nombre" || k === "name" || k === "cardname" || k === "carta") return "nombre";

  // tipo
  if (k === "tipo" || k === "type" || k === "cat" || k === "categoria") return "tipo";

  // atributo/elemento
  if (k === "atributo" || k === "elemento" || k === "element" || k === "energy" || k === "energia") return "atributo";

  // hp
  if (k === "hp" || k === "nivel" || k === "vida" || k === "pv" || k === "health") return "nivel";

  // subtipo
  if (k === "subtipo" || k === "sub" || k === "stage" || k === "subtype") return "subtipo";

  // cantidad
  if (k === "cantidad" || k === "cant" || k === "qty" || k === "quantity" || k === "stock") return "cantidad";

  // idioma
  if (k === "idioma" || k === "lang" || k === "language") return "idioma";

  // precio
  if (k === "precio" || k === "price" || k === "valor" || k === "costo" || k === "cost") return "precio";

  // fecha
  if (k === "fecha" || k === "date" || k === "fecha_compra") return "fecha_compra";

  // notas
  if (k === "notas" || k === "notes" || k === "obs" || k === "observaciones") return "notas";

  // año
  if (k === "anio" || k === "año" || k === "year") return "anio";

  // evolución (desde)
  if (
    k === "de" || k === "from" ||
    k === "evolucionade" || k === "evolucion de" || k === "evoluciona_de" || k === "evoluciona de" ||
    k === "evoluciona" || k === "preevolucion" || k === "pre evolucion"
  ) return "evoluciona_de";

  // evolución (hacia)
  if (
    k === "a" || k === "to" ||
    k === "evoluciona_a" || k === "evoluciona a" || k === "evolucion a" || k === "evolucionaen" || k === "evoluciona en"
  ) return "evoluciona_a";

  return "";
}

/* =========================
   UTIL
========================= */

function idx(colIndex, key) {
  const v = colIndex?.[key];
  return Number.isInteger(v) ? v : -1;
}

function toNumber_(x) {
  // tolera "25.000", "25000", "25,000", "25,5"
  const s = String(x ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "") // quita puntos miles
    .replace(/,(?=\d{3}(\D|$))/g, "")  // quita comas miles
    .replace(",", ".");                // decimal coma->punto
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
