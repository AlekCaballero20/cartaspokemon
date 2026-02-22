/* ============================
   Pokémon TCG DB — app.js (PRO Modular vNext · improved)
   - Entry module (index.html usa: <script type="module" src="./app.js"></script>)
   - Lee TSV publicado (GET)
   - Escribe a Apps Script (POST sin preflight)
   - Mapeo robusto por headers (aliases)
   - UI: tabla compacta + drawer + form
   - Cache TSV + fallback offline
   - ✅ Datalists persistentes: Tipo/Set/Año/Subtipo/Elemento/Idioma (TSV + localStorage + defaults)
   - ✅ Evolución (EvolucionaDe / EvolucionaA) con inyección si falta en HTML
   - ✅ No envía EnergíaCoste / atk
   - ✅ Mask Identidad (#): auto "/" (Ej: 012/198)
   - ✅ Click en botón Editar o en la fila
   - ✅ Anti-duplicados al agregar: avisa y permite (sumar cantidad / duplicar / descartar)
============================ */

"use strict";

import { CFG } from "./config.js";
import { fetchTSVText, parseTSV, postJSONNoPreflight } from "./services.api.js";
import { HEADER_ALIASES, FORM_FIELDS, UI_TO_SHEET, SHEET_TO_UI } from "./data.schema.js";
import { filterRows } from "./ui.filters.js";
import { renderTable, renderCount, setStatus, toast, renderSkeleton } from "./ui.render.js";
import { norm, debounce, isFiniteInteger, isFiniteNumber, formatTimeAgo, makeId } from "./utils.js";

/* =========================
   DOM helpers
========================= */
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);

/* =========================
   DOM refs
========================= */
const dom = {
  app: $("app"),
  tbody: qs("#dbTable tbody"),
  search: $("search"),
  btnClearSearch: $("btnClearSearch"),
  countText: $("countText"),
  btnReload: $("btnReload"),
  btnNew: $("btnNew"),

  statusDot: $("statusDot"),
  statusText: $("statusText"),

  drawer: $("drawer"),
  overlay: $("overlay"),
  btnCloseDrawer: $("btnCloseDrawer"),
  btnCancel: $("btnCancel"),
  btnDuplicate: $("btnDuplicate"),
  drawerTitle: $("drawerTitle"),
  drawerSubtitle: $("drawerSubtitle"),

  form: $("cardForm"),
  rowIndex: $("rowIndex"),
  formMeta: $("formMeta"),

  // Form inputs (se rellena abajo, y se rehidrata si inyectamos nuevos campos)
  f: {},
};

/* =========================
   LISTS (datalist) + storage
   OJO: IDs deben coincidir con index.html
========================= */
const LISTS = {
  tipo:     { inputId: "categoria", dlId: "dlTipo",     lsKey: "pkm_list_tipo_v1" },
  subtipo:  { inputId: "subtipo",   dlId: "dlSubtipo",  lsKey: "pkm_list_subtipo_v1" },
  set:      { inputId: "edicion",   dlId: "dlSet",      lsKey: "pkm_list_set_v1" },
  anio:     { inputId: "anio",      dlId: "dlAnio",     lsKey: "pkm_list_anio_v1" },
  elemento: { inputId: "atributo",  dlId: "dlElemento", lsKey: "pkm_list_elemento_v1" },

  // ✅ NUEVO: Idioma como lista persistente
  idioma:   { inputId: "idioma",    dlId: "dlIdioma",   lsKey: "pkm_list_idioma_v1" },
};

// Defaults mínimos para Idioma (por si el TSV viene pelado o el storage está vacío)
const DEFAULT_IDIOMAS = Object.freeze(["ES", "EN", "JP", "FR", "DE", "IT", "PT", "KO", "ZH"]);

// Por si antes usaron IDs viejos en HTML (dl_tipo, dl_set, dl_anio). No rompemos, migramos.
const LEGACY_DL_IDS = new Map([
  ["dl_tipo", "dlTipo"],
  ["dl_set", "dlSet"],
  ["dl_anio", "dlAnio"],
]);

// Normaliza a texto amigable (para listas)
function cleanListValue_(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

function toInt_(v, fallback = 0) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/* =========================
   STATE
========================= */
const state = {
  header: [],
  rows: [],      // [header, ...data]
  data: [],      // solo data
  view: [],      // data filtrada
  query: "",
  isSaving: false,
  selected: null, // { rowArray, sheetRowIndex, id }
  isOnline: navigator.onLine,
  lastLoadedAt: null,
  colIndex: {},   // { key: index } basado en header real
};

/* =========================
   INIT
========================= */
init();

function init() {
  setStatus(dom.statusDot, dom.statusText, state.isOnline ? "ok" : "error", state.isOnline ? "Online" : "Offline");

  // 1) refs base
  refreshFormRefs_();

  // 2) por si el HTML no trae evolución (igual lo soportamos)
  ensureEvolutionFields_();

  // 3) refresh otra vez (por si inyectamos inputs)
  refreshFormRefs_();

  // 3.5) mask identidad
  bindIdentityMask_();

  // 4) datalists (incluye idioma)
  ensureDatalists_();
  seedIdiomaDefaults_(); // ✅ importantico

  // 5) anti-duplicados (dialog ready)
  ensureDupDialog_();

  bindUI();
  bindNetwork();

  safeRenderSkeleton_();
  loadTSV(false);
}

function refreshFormRefs_() {
  dom.f = Object.fromEntries(
    (Array.isArray(FORM_FIELDS) ? FORM_FIELDS : []).map((id) => [id, $(id)])
  );

  // también por compat
  dom.f.evoluciona_de = $("evoluciona_de") || dom.f.evoluciona_de || null;
  dom.f.evoluciona_a  = $("evoluciona_a")  || dom.f.evoluciona_a  || null;
}

/* =========================
   IDENTIDAD mask: "012/198"
========================= */
function bindIdentityMask_() {
  const el = $("num");
  if (!el) return;
  if (el.dataset.maskBound === "1") return;
  el.dataset.maskBound = "1";

  const MAX_DIGITS = 6; // 3+3
  const SPLIT_AT = 3;

  const format = (digits) => {
    const d = String(digits || "").replace(/\D/g, "").slice(0, MAX_DIGITS);
    const a = d.slice(0, SPLIT_AT);
    const b = d.slice(SPLIT_AT);
    return b ? `${a}/${b}` : a;
  };

  const digitsCountBefore = (str, pos) => {
    const left = String(str || "").slice(0, Math.max(0, pos));
    return (left.match(/\d/g) || []).length;
  };

  const caretFromDigitsCount = (formatted, digitCount) => {
    if (digitCount <= 0) return 0;
    let seen = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (/\d/.test(formatted[i])) seen++;
      if (seen >= digitCount) return i + 1;
    }
    return formatted.length;
  };

  const apply = () => {
    const prev = el.value || "";
    const start = el.selectionStart ?? prev.length;

    const digitBefore = digitsCountBefore(prev, start);
    const next = format(prev);

    if (next !== prev) {
      el.value = next;
      const caret = caretFromDigitsCount(next, digitBefore);
      try { el.setSelectionRange(caret, caret); } catch { /* mobile */ }
    }
  };

  el.addEventListener("input", apply, { passive: true });
  el.addEventListener("paste", () => setTimeout(apply, 0));
  el.addEventListener("focus", apply, { passive: true });
}

/* =========================
   NETWORK listeners
========================= */
function bindNetwork() {
  window.addEventListener("online", () => {
    state.isOnline = true;
    setStatus(dom.statusDot, dom.statusText, "ok", "Online");
    toast("Conexión restaurada ✅", CFG.NET.toastMs);
  });

  window.addEventListener("offline", () => {
    state.isOnline = false;
    setStatus(dom.statusDot, dom.statusText, "error", "Offline");
    toast("Sin internet. Usando caché si existe 📴", CFG.NET.toastMs);
  });
}

/* =========================
   UI events
========================= */
function bindUI() {
  const onSearch = debounce((value) => {
    state.query = (value || "").trim();
    applyFiltersAndRender();
  }, CFG.NET.searchDebounceMs);

  dom.search?.addEventListener("input", (e) => onSearch(e.target.value));

  dom.btnClearSearch?.addEventListener("click", () => {
    if (dom.search) dom.search.value = "";
    state.query = "";
    applyFiltersAndRender();
    dom.search?.focus?.();
  });

  dom.btnReload?.addEventListener("click", () => loadTSV(true));
  dom.btnNew?.addEventListener("click", openNew);

  dom.btnCloseDrawer?.addEventListener("click", closeDrawer);
  dom.btnCancel?.addEventListener("click", closeDrawer);
  dom.overlay?.addEventListener("click", closeDrawer);

  dom.btnDuplicate?.addEventListener("click", duplicateSelected);
  dom.form?.addEventListener("submit", onSave);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();

    // shortcuts solo si no estás escribiendo
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;

    if (e.key.toLowerCase() === "r") dom.btnReload?.click?.();
    if (e.key.toLowerCase() === "n") dom.btnNew?.click?.();
  });

  // Delegación tabla: Editar por botón (data-action) o por fila
  dom.tbody?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-action]");
    const tr = e.target?.closest?.("tr");
    if (!tr) return;

    // Si hay botón de acción, solo respondemos a "edit"
    if (btn) {
      const action = String(btn.getAttribute("data-action") || "");
      if (action !== "edit") return;
    }

    const id = tr.dataset.id || "";
    if (!id) return;

    const row = findRowById(id);
    if (!row) return;

    const sheetRowIndex = resolveSheetRowIndexById(id);
    openEdit(row, sheetRowIndex);
  });
}

/* =========================
   TSV LOAD + CACHE
========================= */
async function loadTSV(bypassCache = false) {
  setStatus(dom.statusDot, dom.statusText, "loading", "Cargando…");
  safeRenderSkeleton_();

  // 1) red
  try {
    const text = await fetchTSVText(CFG.TSV_URL, CFG.NET.fetchTimeoutMs, bypassCache);
    const rows = parseTSV(text);
    if (!rows.length) throw new Error("TSV vacío");

    applyRows(rows);
    cacheTSV(text);

    setStatus(dom.statusDot, dom.statusText, "ok", "Listo");
    return;
  } catch (err) {
    console.warn("TSV fetch failed:", err);
  }

  // 2) cache
  const cached = getCachedTSV();
  if (cached) {
    try {
      const rows = parseTSV(cached);
      if (!rows.length) throw new Error("Cache TSV inválido");

      applyRows(rows);

      const at = getCachedTSVAt();
      const label = at ? `Offline (cache ${formatTimeAgo(at)})` : "Offline (cache)";
      setStatus(dom.statusDot, dom.statusText, "error", label);
      toast("Cargado desde caché 📦", CFG.NET.toastMs);
      return;
    } catch (e) {
      console.warn("Cache parse failed:", e);
    }
  }

  // 3) nada
  setStatus(dom.statusDot, dom.statusText, "error", "Error");
  renderEmpty();
  toast("No se pudo cargar (sin red y sin caché).", CFG.NET.toastMs);
}

function safeRenderSkeleton_() {
  try {
    if (typeof renderSkeleton === "function" && dom.tbody) {
      renderSkeleton(dom.tbody, 7);
      renderCount(dom.countText, 0);
    }
  } catch {
    // ok
  }
}

function applyRows(rows) {
  state.rows = rows;
  state.header = rows[0] || [];
  state.data = rows.slice(1);
  state.lastLoadedAt = Date.now();

  state.colIndex = buildColIndexFromHeader(state.header);

  // listas TSV + storage (incluye idioma)
  refreshDatalistsFromData_();

  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  if (!state.header?.length) {
    renderEmpty();
    return;
  }

  const filtered = filterRows(state.data, state.query, state.colIndex);
  state.view = filtered;

  renderTable(dom.tbody, filtered, state.colIndex, { idKey: "_id" });
  renderCount(dom.countText, filtered.length);
}

function renderEmpty() {
  if (dom.tbody) dom.tbody.innerHTML = "";
  renderCount(dom.countText, 0);
}

function cacheTSV(tsvText) {
  try {
    localStorage.setItem(CFG.STORAGE.tsvCache, tsvText);
    localStorage.setItem(CFG.STORAGE.tsvCacheAt, String(Date.now()));
  } catch {
    // ok
  }
}

function getCachedTSV() {
  try { return localStorage.getItem(CFG.STORAGE.tsvCache) || ""; }
  catch { return ""; }
}

function getCachedTSVAt() {
  try {
    const v = localStorage.getItem(CFG.STORAGE.tsvCacheAt);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

/* =========================
   HEADER -> colIndex (aliases)
========================= */
function buildColIndexFromHeader(header) {
  const normHeader = (header || []).map((h) => norm(h));
  const out = {};

  for (const key of Object.keys(HEADER_ALIASES)) {
    const aliases = (HEADER_ALIASES[key] || []).map((a) => norm(a));
    let idxFound = -1;

    // exact
    for (let i = 0; i < normHeader.length; i++) {
      const h = normHeader[i];
      if (!h) continue;
      if (aliases.includes(h)) { idxFound = i; break; }
    }

    // contains
    if (idxFound === -1) {
      for (let i = 0; i < normHeader.length; i++) {
        const h = normHeader[i];
        if (!h) continue;
        if (aliases.some((a) => h.includes(a))) { idxFound = i; break; }
      }
    }

    if (idxFound !== -1) out[key] = idxFound;
  }

  if (out._id == null && (header?.[0] || "").trim()) out._id = 0;
  return out;
}

function idx(key) {
  const v = state.colIndex?.[key];
  return Number.isInteger(v) ? v : -1;
}

function getCell(row, key) {
  const i = idx(key);
  return i >= 0 ? (row?.[i] ?? "") : "";
}

/* =========================
   Find row / sheet row index
========================= */
function findRowById(_id) {
  const idIdx = idx("_id");
  if (idIdx < 0) return null;

  const j = state.rows.findIndex((r, i) => i > 0 && String(r?.[idIdx] || "") === _id);
  return j >= 1 ? state.rows[j] : null;
}

function resolveSheetRowIndexById(_id) {
  const idIdx = idx("_id");
  if (idIdx < 0) return "";

  const j = state.rows.findIndex((r, i) => i > 0 && String(r?.[idIdx] || "") === _id);
  return j >= 1 ? String(j + 1) : "";
}

/* =========================
   DRAWER / FORM
========================= */
function openNew() {
  state.selected = null;

  dom.drawerTitle && (dom.drawerTitle.textContent = "Nueva carta");
  dom.drawerSubtitle && (dom.drawerSubtitle.textContent = "Completa los datos y guarda");
  dom.rowIndex && (dom.rowIndex.value = "");

  clearFormFields();

  if (dom.btnDuplicate) dom.btnDuplicate.disabled = true;

  setFormMeta("Nueva carta.");
  openDrawer();
  dom.f.nombre?.focus?.();
}

function openEdit(row, sheetRowIndex) {
  const id = String(getCell(row, "_id") || "");
  state.selected = { rowArray: row, sheetRowIndex, id };

  dom.drawerTitle && (dom.drawerTitle.textContent = "Editar carta");
  dom.drawerSubtitle && (dom.drawerSubtitle.textContent = sheetRowIndex ? `Fila #${sheetRowIndex}` : "Editando");
  dom.rowIndex && (dom.rowIndex.value = sheetRowIndex || "");

  fillFormFromRow(row);

  if (dom.btnDuplicate) dom.btnDuplicate.disabled = false;

  setFormMeta("Editando.");
  openDrawer();
  dom.f.nombre?.focus?.();
}

function openDrawer() {
  if (!dom.drawer) return;
  dom.drawer.classList.add("open");
  dom.drawer.setAttribute("aria-hidden", "false");
  if (dom.overlay) dom.overlay.hidden = false;

  bindIdentityMask_();
}

function closeDrawer() {
  if (!dom.drawer) return;
  dom.drawer.classList.remove("open");
  dom.drawer.setAttribute("aria-hidden", "true");
  if (dom.overlay) dom.overlay.hidden = true;
}

function setFormMeta(msg) {
  if (!dom.formMeta) return;
  dom.formMeta.textContent = msg;
}

function clearFormFields() {
  for (const id of (Array.isArray(FORM_FIELDS) ? FORM_FIELDS : [])) {
    const el = dom.f[id];
    if (el) el.value = "";
  }
  if (dom.f.evoluciona_de) dom.f.evoluciona_de.value = "";
  if (dom.f.evoluciona_a) dom.f.evoluciona_a.value = "";
}

function fillFormFromRow(row) {
  for (const sheetKey of Object.keys(SHEET_TO_UI || {})) {
    const uiId = SHEET_TO_UI[sheetKey];
    const el = dom.f[uiId];
    if (!el) continue;
    el.value = String(getCell(row, sheetKey) || "");
  }

  if (dom.f.evoluciona_de) dom.f.evoluciona_de.value = String(getCell(row, "evoluciona_de") || "");
  if (dom.f.evoluciona_a)  dom.f.evoluciona_a.value  = String(getCell(row, "evoluciona_a")  || "");

  bindIdentityMask_();
}

function val(id) {
  return String(dom.f[id]?.value ?? "").trim();
}

/* =========================
   DUPLICADOS (anti-repeat)
   - Solo aplica cuando intentas "add"
   - Detecta por fingerprint configurable
   - Opciones: sumar cantidad / duplicar / descartar
========================= */

// Define qué significa "misma carta" para ustedes.
// Recomendación: si "num" suele venir, es lo más fuerte.
// Si "num" a veces falta, "nombre+edicion+idioma" ayuda a no meter la pata.
const DUP_KEYS = Object.freeze([
  "num",
  "edicion",
  "idioma",
  // fallback suave (si el num viene vacío, el nombre ayuda)
  "nombre",
]);

function fingerprintFromValues_(obj) {
  const parts = DUP_KEYS.map((k) => norm(String(obj?.[k] ?? "")));
  return parts.join("|");
}

function fingerprintFromForm_() {
  const obj = {
    nombre: val("nombre"),
    num: val("num"),
    edicion: val("edicion"),
    idioma: val("idioma"),
  };
  return fingerprintFromValues_(obj);
}

function fingerprintFromRow_(row) {
  const obj = {
    nombre: getCell(row, "nombre"),
    num: getCell(row, "num"),
    edicion: getCell(row, "edicion"),
    idioma: getCell(row, "idioma"),
  };
  return fingerprintFromValues_(obj);
}

function findDuplicateRow_() {
  const fp = fingerprintFromForm_();

  // si todo está vacío, no molestamos
  if (!fp.replace(/\|/g, "")) return null;

  for (const row of (state.data || [])) {
    if (fingerprintFromRow_(row) === fp) return row;
  }
  return null;
}

function ensureDupDialog_() {
  if (document.getElementById("dupDialog")) return;

  const d = document.createElement("dialog");
  d.id = "dupDialog";

  // Inline styles para que no dependa de CSS (porque humanos).
  d.style.padding = "0";
  d.style.border = "none";
  d.style.borderRadius = "16px";
  d.style.maxWidth = "520px";
  d.style.width = "min(520px, calc(100vw - 24px))";
  d.style.boxShadow = "0 18px 50px rgba(0,0,0,.18)";
  d.style.overflow = "hidden";

  d.innerHTML = `
    <form method="dialog" style="margin:0; padding:16px 16px 14px 16px; background:#fff; font-family:system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:38px; height:38px; border-radius:12px; background:#f2f4ff; display:grid; place-items:center; flex:0 0 auto;">
          <span style="font-size:18px;">🧩</span>
        </div>
        <div style="flex:1 1 auto;">
          <h3 style="margin:0; font-size:16px; line-height:1.2;">Esta carta ya existe</h3>
          <p id="dupDialogMsg" style="margin:6px 0 0 0; font-size:13px; opacity:.8;"></p>
        </div>
      </div>

      <div style="margin-top:14px; display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
        <button value="discard" style="padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.12); background:#fff; cursor:pointer;">
          Descartar
        </button>
        <button value="duplicate" style="padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.12); background:#fff; cursor:pointer;">
          Crear duplicado
        </button>
        <button value="merge" autofocus style="padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.12); background:#0c41c4; color:#fff; cursor:pointer;">
          Sumar cantidad
        </button>
      </div>

      <p style="margin:10px 0 0 0; font-size:12px; opacity:.7;">
        Si eliges “Sumar cantidad”, se actualizará la fila existente en lugar de crear otra.
      </p>
    </form>
  `;

  document.body.appendChild(d);
}

function askDupAction_(dupRow) {
  ensureDupDialog_();
  const d = document.getElementById("dupDialog");
  const msg = document.getElementById("dupDialogMsg");

  const name = String(getCell(dupRow, "nombre") || "").trim();
  const num  = String(getCell(dupRow, "num") || "").trim();
  const set  = String(getCell(dupRow, "edicion") || "").trim();
  const lang = String(getCell(dupRow, "idioma") || "").trim();

  msg.textContent =
    `Coincide con: ${name || "(sin nombre)"}`
    + (num ? ` · #${num}` : "")
    + (set ? ` · ${set}` : "")
    + (lang ? ` · ${lang}` : "");

  return new Promise((resolve) => {
    const onClose = () => {
      d.removeEventListener("close", onClose);
      resolve(String(d.returnValue || "discard"));
    };
    d.addEventListener("close", onClose);
    d.showModal();
  });
}

/* =========================
   SAVE payload builder (PRO: data por header real)
========================= */
function buildDataForSave_() {
  const headerLen = (state.header || []).length || 0;
  if (!headerLen) throw new Error("No header loaded");

  const existingId = state.selected?.rowArray ? String(getCell(state.selected.rowArray, "_id") || "") : "";
  const _id = existingId || makeId(CFG.ID_PREFIX);

  const data = {};

  const setBySheetKey = (sheetKey, value) => {
    const i = idx(sheetKey);
    if (i < 0) return;
    const headerName = String(state.header?.[i] ?? "").trim();
    if (!headerName) return;
    data[headerName] = String(value ?? "").trim();
  };

  setBySheetKey("_id", _id);

  for (const uiId of Object.keys(UI_TO_SHEET || {})) {
    if (uiId === "atk") continue; // por si existe heredado
    const sheetKey = UI_TO_SHEET[uiId];
    setBySheetKey(sheetKey, val(uiId));
  }

  if (dom.f.evoluciona_de) setBySheetKey("evoluciona_de", dom.f.evoluciona_de.value);
  if (dom.f.evoluciona_a)  setBySheetKey("evoluciona_a",  dom.f.evoluciona_a.value);

  return { _id, data };
}

/* =========================
   SAVE (Apps Script) — no preflight
========================= */
async function onSave(e) {
  e.preventDefault();
  if (state.isSaving) return;

  const rowIndexRaw = (dom.rowIndex?.value || "").trim();
  const isEdit = Boolean(rowIndexRaw);
  const action = isEdit ? "update" : "add";

  const name = val("nombre");
  if (!name) {
    toast("Falta el nombre.", CFG.NET.toastMs);
    dom.f.nombre?.focus?.();
    return;
  }

  const hp = val("nivel");
  if (hp && !isFiniteInteger(hp)) {
    toast("HP debe ser entero.", CFG.NET.toastMs);
    dom.f.nivel?.focus?.();
    return;
  }

  const qty = val("cantidad");
  if (qty && !isFiniteInteger(qty)) {
    toast("Cantidad debe ser entero.", CFG.NET.toastMs);
    dom.f.cantidad?.focus?.();
    return;
  }

  const price = val("precio");
  if (price && !isFiniteNumber(price)) {
    toast("Precio debe ser número.", CFG.NET.toastMs);
    dom.f.precio?.focus?.();
    return;
  }

  if (!state.isOnline) {
    toast("Estás offline. No se puede guardar ahora 📴", CFG.NET.toastMs);
    setFormMeta("Offline: no guardó.");
    return;
  }

  // =========================
  // DUP CHECK (solo en ADD)
  // =========================
  if (action === "add") {
    const dupRow = findDuplicateRow_();
    if (dupRow) {
      const choice = await askDupAction_(dupRow);

      if (choice === "discard") {
        toast("Listo, no se agregó 👍", CFG.NET.toastMs);
        setFormMeta("No se agregó (duplicada).");
        return;
      }

      if (choice === "merge") {
        const dupId = String(getCell(dupRow, "_id") || "");
        const dupSheetRowIndex = resolveSheetRowIndexById(dupId);

        if (!dupId || !dupSheetRowIndex) {
          toast("Encontré duplicado pero no pude ubicar la fila.", CFG.NET.toastMs);
          setFormMeta("Duplicado detectado, pero faltó rowIndex.");
          return;
        }

        // Convertimos ADD -> UPDATE
        state.selected = { rowArray: dupRow, sheetRowIndex: dupSheetRowIndex, id: dupId };
        if (dom.rowIndex) dom.rowIndex.value = String(dupSheetRowIndex);

        const existingQty = toInt_(getCell(dupRow, "cantidad"), 0);
        const newQty = toInt_(val("cantidad"), 0);
        const finalQty = Math.max(0, existingQty + newQty);

        if (dom.f.cantidad) dom.f.cantidad.value = String(finalQty);

        toast(`Duplicada: sumé cantidad (${existingQty} + ${newQty} = ${finalQty}) ✅`, CFG.NET.toastMs);
        setFormMeta("Duplicada: sumando cantidad y actualizando.");
      }

      // choice === "duplicate" -> seguimos normal como ADD
    }
  }

  let built;
  try {
    built = buildDataForSave_();
  } catch (err) {
    console.error(err);
    toast("No se pudo preparar el registro (header no cargado).", CFG.NET.toastMs);
    return;
  }

  // Antes de guardar: persistir listas (incluye idioma)
  try {
    persistListValue_("tipo", cleanListValue_(val("categoria")));
    persistListValue_("set", cleanListValue_(val("edicion")));
    persistListValue_("anio", cleanListValue_(val("anio")));
    persistListValue_("subtipo", cleanListValue_(val("subtipo")));
    persistListValue_("elemento", cleanListValue_(val("atributo")));
    persistListValue_("idioma", cleanListValue_(val("idioma"))); // ✅ nuevo

    ensureDatalists_();
    seedIdiomaDefaults_();
    refreshDatalistsFromStorage_();
  } catch {
    // ok
  }

  // Re-evaluamos rowIndex después del merge
  const rowIndex = (dom.rowIndex?.value || "").trim();
  const finalAction = rowIndex ? "update" : "add";

  try {
    state.isSaving = true;
    lockSave(true);

    setFormMeta("Guardando…");
    setStatus(dom.statusDot, dom.statusText, "loading", "Guardando…");

    const payload = {
      action: finalAction,
      rowIndex: rowIndex || "",
      id: built._id,
      data: built.data,
    };

    const res = await postJSONNoPreflight(CFG.API_URL, payload, CFG.NET.fetchTimeoutMs);
    if (!res.ok) throw new Error(res.json?.error || "No se pudo guardar");

    toast(res.json?.msg || "Guardado ✅", CFG.NET.toastMs);
    setFormMeta("Listo.");
    setStatus(dom.statusDot, dom.statusText, "ok", "Listo");

    await loadTSV(true);

    // Si fue add real (no merge), cerramos
    if (finalAction === "add") closeDrawer();
  } catch (err) {
    console.error(err);
    toast("No se pudo guardar (conexión o bloqueo).", CFG.NET.toastMs);
    setFormMeta("No guardó. Reintenta.");
    setStatus(dom.statusDot, dom.statusText, "error", "Error");
  } finally {
    state.isSaving = false;
    lockSave(false);
  }
}

function lockSave(lock) {
  const btnSave = $("btnSave");
  if (btnSave) {
    btnSave.disabled = lock;
    btnSave.textContent = lock ? "Guardando…" : "Guardar";
  }
  dom.btnNew && (dom.btnNew.disabled = lock);
  dom.btnReload && (dom.btnReload.disabled = lock);
}

/* =========================
   DUPLICATE
========================= */
function duplicateSelected() {
  if (!state.selected?.rowArray) {
    toast("No hay nada para duplicar.", CFG.NET.toastMs);
    return;
  }

  dom.drawerTitle && (dom.drawerTitle.textContent = "Duplicar carta");
  dom.drawerSubtitle && (dom.drawerSubtitle.textContent = "Se guardará como nueva");
  dom.rowIndex && (dom.rowIndex.value = "");

  state.selected = null;
  if (dom.btnDuplicate) dom.btnDuplicate.disabled = true;

  setFormMeta("Duplica y guarda.");
  openDrawer();
}

/* =========================
   EVOLUCIÓN: inyección si no existe en HTML
========================= */
function ensureEvolutionFields_() {
  if ($("evoluciona_de") && $("evoluciona_a")) return;

  const form = dom.form;
  if (!form) return;

  const sections = Array.from(form.querySelectorAll(".form-section"));
  let insertBefore = null;
  for (const s of sections) {
    const title = s.querySelector(".section-title")?.textContent?.toLowerCase?.() || "";
    if (title.includes("inventario")) { insertBefore = s; break; }
  }

  const sec = document.createElement("section");
  sec.className = "form-section";
  sec.innerHTML = `
    <div class="section-title">Evolución</div>
    <div class="grid">
      <label class="field span-2">
        <span class="label">Evoluciona de</span>
        <input id="evoluciona_de" type="text" placeholder="Ej: Pichu / Charmander / Eevee…" />
        <span class="hint">¿De quién evoluciona esta carta? (si aplica)</span>
      </label>

      <label class="field span-2">
        <span class="label">Evoluciona a</span>
        <input id="evoluciona_a" type="text" placeholder="Ej: Raichu / Charmeleon / Vaporeon…" />
        <span class="hint">¿A quién evoluciona? (si aplica)</span>
      </label>
    </div>
  `;

  if (insertBefore) form.insertBefore(sec, insertBefore);
  else {
    const foot = form.querySelector(".drawer-foot");
    if (foot) form.insertBefore(sec, foot);
    else form.appendChild(sec);
  }
}

/* =========================
   DATALISTS (Tipo / Set / Año / Subtipo / Elemento / Idioma)
========================= */
function ensureDatalists_() {
  // Migra datalist IDs viejos si existen (solo en DOM, por si quedó HTML mezclado)
  for (const [legacyId, newId] of LEGACY_DL_IDS.entries()) {
    const legacy = $(legacyId);
    if (legacy && !$(newId)) legacy.id = newId;
  }

  const host = dom.app || document.body;

  for (const key of Object.keys(LISTS)) {
    const cfg = LISTS[key];
    const input = $(cfg.inputId);
    if (!input) continue;

    let dl = $(cfg.dlId);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = cfg.dlId;
      host.prepend(dl); // queda “cerca” de la app y no regado por el body
    }

    input.setAttribute("list", cfg.dlId);
  }

  refreshDatalistsFromStorage_();
}

function refreshDatalistsFromStorage_() {
  for (const key of Object.keys(LISTS)) {
    const cfg = LISTS[key];
    const dl = $(cfg.dlId);
    if (!dl) continue;

    const values = readList_(cfg.lsKey);

    // ✅ Si no hay valores guardados, NO borres los <option> que ya venían en el HTML
    if (!values.length && dl.children.length) continue;

    dl.replaceChildren(
      ...values.map((v) => {
        const opt = document.createElement("option");
        opt.value = v;
        return opt;
      })
    );
  }
}

function refreshDatalistsFromData_() {
  // TSV + localStorage (incluye idioma)
  const next = {
    tipo: new Set(readList_(LISTS.tipo.lsKey)),
    set: new Set(readList_(LISTS.set.lsKey)),
    anio: new Set(readList_(LISTS.anio.lsKey)),
    subtipo: new Set(readList_(LISTS.subtipo.lsKey)),
    elemento: new Set(readList_(LISTS.elemento.lsKey)),
    idioma: new Set(readList_(LISTS.idioma.lsKey)),
  };

  // ✅ seed defaults idioma siempre
  for (const d of DEFAULT_IDIOMAS) next.idioma.add(d);

  for (const row of (state.data || [])) {
    const t = cleanListValue_(getCell(row, "tipo"));
    if (t) next.tipo.add(t);

    const s = cleanListValue_(getCell(row, "edicion"));
    if (s) next.set.add(s);

    const a = cleanListValue_(getCell(row, "anio"));
    if (a) next.anio.add(a);

    const st = cleanListValue_(getCell(row, "subtipo"));
    if (st) next.subtipo.add(st);

    const el = cleanListValue_(getCell(row, "atributo"));
    if (el) next.elemento.add(el);

    const lang = cleanListValue_(getCell(row, "idioma"));
    if (lang) next.idioma.add(lang.toUpperCase());
  }

  writeList_(LISTS.tipo.lsKey, Array.from(next.tipo).sort(localeSort_));
  writeList_(LISTS.set.lsKey, Array.from(next.set).sort(localeSort_));
  writeList_(LISTS.anio.lsKey, Array.from(next.anio).sort(localeSortNum_));
  writeList_(LISTS.subtipo.lsKey, Array.from(next.subtipo).sort(localeSort_));
  writeList_(LISTS.elemento.lsKey, Array.from(next.elemento).sort(localeSort_));
  writeList_(LISTS.idioma.lsKey, Array.from(next.idioma).sort(localeSort_));

  refreshDatalistsFromStorage_();
}

function persistListValue_(listKey, value) {
  const cfg = LISTS[listKey];
  if (!cfg) return;
  let v = cleanListValue_(value);
  if (!v) return;

  // Idioma siempre en mayúsculas (ES/EN/JP)
  if (listKey === "idioma") v = v.toUpperCase();

  const arr = readList_(cfg.lsKey);
  if (arr.some((x) => norm(x) === norm(v))) return;

  arr.push(v);

  if (listKey === "anio") arr.sort(localeSortNum_);
  else arr.sort(localeSort_);

  writeList_(cfg.lsKey, arr);
}

/* =========================
   Idioma defaults (sin borrar lo que ya exista)
========================= */
function seedIdiomaDefaults_() {
  const cfg = LISTS.idioma;
  if (!cfg) return;

  const current = new Set(readList_(cfg.lsKey).map((x) => x.toUpperCase()));

  // Si el HTML trae options, también los incorporamos
  const dl = $(cfg.dlId);
  if (dl) {
    for (const opt of Array.from(dl.querySelectorAll("option"))) {
      const v = cleanListValue_(opt.value).toUpperCase();
      if (v) current.add(v);
    }
  }

  for (const d of DEFAULT_IDIOMAS) current.add(d);

  const finalArr = Array.from(current).sort(localeSort_);
  writeList_(cfg.lsKey, finalArr);
  refreshDatalistsFromStorage_();
}

function readList_(lsKey) {
  try {
    const raw = localStorage.getItem(lsKey);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(cleanListValue_).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeList_(lsKey, arr) {
  try {
    localStorage.setItem(lsKey, JSON.stringify(Array.isArray(arr) ? arr : []));
  } catch {
    // ok
  }
}

function localeSort_(a, b) {
  return String(a).localeCompare(String(b), "es", { sensitivity: "base" });
}

function localeSortNum_(a, b) {
  const na = Number(String(a).trim());
  const nb = Number(String(b).trim());
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return localeSort_(a, b);
}