/* ============================
   Pokémon TCG DB — app.js (PRO Modular vNext)
   - Entry module (index.html usa: <script type="module" src="./app.js"></script>)
   - Lee TSV publicado (GET)
   - Escribe a Apps Script (POST sin preflight)
   - Mapeo robusto por headers (aliases)
   - UI: tabla compacta + drawer + form
   - Cache TSV + fallback offline
   - ✅ Datalists (Tipo/Set/Año) persistentes
   - ✅ Evolución (EvolucionaDe / EvolucionaA) con inyección si falta en HTML
   - ✅ No envía EnergíaCoste / atk
   - ✅ Mask Identidad (#): auto "/" (Ej: 012/198)
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
========================= */
const LISTS = {
  tipo: { inputId: "categoria", dlId: "dl_tipo", lsKey: "pkm_list_tipo_v1" },
  set:  { inputId: "edicion",   dlId: "dl_set",  lsKey: "pkm_list_set_v1"  },
  anio: { inputId: "anio",      dlId: "dl_anio", lsKey: "pkm_list_anio_v1" },
};

// Normaliza a texto amigable (para listas)
function cleanListValue_(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ");
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
  // estado inicial (por si arranca offline)
  setStatus(dom.statusDot, dom.statusText, state.isOnline ? "ok" : "error", state.isOnline ? "Online" : "Offline");

  // (1) asegura inputs base (por si FORM_FIELDS cambió)
  refreshFormRefs_();

  // (2) asegura campos de evolución (sin obligarte a tocar HTML)
  ensureEvolutionFields_();

  // (3) refresh refs otra vez (porque quizá inyectamos inputs)
  refreshFormRefs_();

  // (3.5) mask IDENTIDAD (#): auto "/" (input id="num")
  bindIdentityMask_();

  // (4) datalists (Tipo/Set/Año)
  ensureDatalists_();

  bindUI();
  bindNetwork();

  // muestra skeleton al inicio si existe renderSkeleton
  safeRenderSkeleton_();

  loadTSV(false);
}

function refreshFormRefs_() {
  // Construye dom.f según FORM_FIELDS, pero tolera que algunos no existan
  dom.f = Object.fromEntries(
    (Array.isArray(FORM_FIELDS) ? FORM_FIELDS : [])
      .map((id) => [id, $(id)])
  );

  // También indexa evoluciona_* si existen/inyectamos
  dom.f.evoluciona_de = $("evoluciona_de") || dom.f.evoluciona_de || null;
  dom.f.evoluciona_a  = $("evoluciona_a")  || dom.f.evoluciona_a  || null;
}

/* =========================
   IDENTIDAD mask: "012/198"
   - Solo dígitos
   - Inserta "/" tras 3 dígitos
   - Mantiene cursor decente
========================= */
function bindIdentityMask_() {
  const el = $("num");
  if (!el) return;
  if (el.dataset.maskBound === "1") return; // evita doble bind
  el.dataset.maskBound = "1";

  const MAX_DIGITS = 6;   // 3 + 3 (ajústalo si quieres 4/4 etc.)
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
      try { el.setSelectionRange(caret, caret); } catch { /* móvil, a veces no deja */ }
    }
  };

  el.addEventListener("input", apply, { passive: true });

  // si el usuario pega "012198" o "012/198", queda bien
  el.addEventListener("paste", () => setTimeout(apply, 0));

  // opcional: al enfocar, si está vacío, no metemos "/" de una (solo cuando haya dígitos)
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

    // mini shortcuts (sin ser cansones)
    if ((e.target?.tagName || "").toLowerCase() === "input" || (e.target?.tagName || "").toLowerCase() === "textarea") return;
    if (e.key.toLowerCase() === "r") dom.btnReload?.click?.();
    if (e.key.toLowerCase() === "n") dom.btnNew?.click?.();
  });

  // Delegación tabla: editar por botón o fila
  dom.tbody?.addEventListener("click", (e) => {
    const tr = e.target?.closest?.("tr");
    if (!tr) return;

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

  // 1) intenta red
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

  // 2) fallback cache
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
    // si ui.render.js no trae renderSkeleton, no pasa nada
  }
}

function applyRows(rows) {
  state.rows = rows;
  state.header = rows[0] || [];
  state.data = rows.slice(1);
  state.lastLoadedAt = Date.now();

  state.colIndex = buildColIndexFromHeader(state.header);

  // actualiza datalists desde TSV + localStorage
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
    // storage bloqueado: seguimos sin drama
  }
}

function getCachedTSV() {
  try {
    return localStorage.getItem(CFG.STORAGE.tsvCache) || "";
  } catch {
    return "";
  }
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

    // exact match
    for (let i = 0; i < normHeader.length; i++) {
      const h = normHeader[i];
      if (!h) continue;
      if (aliases.includes(h)) { idxFound = i; break; }
    }

    // contains match
    if (idxFound === -1) {
      for (let i = 0; i < normHeader.length; i++) {
        const h = normHeader[i];
        if (!h) continue;
        if (aliases.some((a) => h.includes(a))) { idxFound = i; break; }
      }
    }

    if (idxFound !== -1) out[key] = idxFound;
  }

  // compat: si no encuentra _id, asumimos col 0 si parece ser id
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
  // state.rows incluye header en index 0, y Sheets es 1-based: por eso +1
  return j >= 1 ? j + 1 : "";
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

  // por si el drawer crea/rehidrata inputs en algún futuro
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
  // limpia los campos de FORM_FIELDS existentes
  for (const id of (Array.isArray(FORM_FIELDS) ? FORM_FIELDS : [])) {
    const el = dom.f[id];
    if (el) el.value = "";
  }
  // limpia evolución si existe
  if (dom.f.evoluciona_de) dom.f.evoluciona_de.value = "";
  if (dom.f.evoluciona_a) dom.f.evoluciona_a.value = "";
}

function fillFormFromRow(row) {
  // Sheet->UI mapping
  for (const sheetKey of Object.keys(SHEET_TO_UI || {})) {
    const uiId = SHEET_TO_UI[sheetKey];
    const el = dom.f[uiId];
    if (!el) continue;
    el.value = String(getCell(row, sheetKey) || "");
  }

  // Evolución (por si tu schema lo maneja aparte)
  if (dom.f.evoluciona_de) dom.f.evoluciona_de.value = String(getCell(row, "evoluciona_de") || "");
  if (dom.f.evoluciona_a)  dom.f.evoluciona_a.value  = String(getCell(row, "evoluciona_a")  || "");

  // aplica formato identidad al cargar (por si viene raro desde sheet)
  bindIdentityMask_();
}

function val(id) {
  return String(dom.f[id]?.value ?? "").trim();
}

/* =========================
   SAVE payload builder (PRO: data por header real)
========================= */

/**
 * Construye payload.data usando los headers reales del Sheet.
 * Así NO dependes del orden de columnas ni de nombres “canónicos”.
 *
 * Devuelve:
 * {
 *   _id: "...",
 *   data: { "Nombre": "Pikachu", "Set": "SV", ... }
 * }
 */
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

  // _id
  setBySheetKey("_id", _id);

  // UI -> Sheet mapping (pero OJO: ignora campos que ya quitaste como atk)
  for (const uiId of Object.keys(UI_TO_SHEET || {})) {
    if (uiId === "atk") continue; // EnergíaCoste fuera ✅
    const sheetKey = UI_TO_SHEET[uiId];
    setBySheetKey(sheetKey, val(uiId));
  }

  // Evolución (si existen columnas)
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

  const rowIndex = (dom.rowIndex?.value || "").trim();
  const action = rowIndex ? "update" : "add";

  // Validaciones básicas
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

  let built;
  try {
    built = buildDataForSave_();
  } catch (err) {
    console.error(err);
    toast("No se pudo preparar el registro (header no cargado).", CFG.NET.toastMs);
    return;
  }

  // Antes de guardar: mete valores a datalists y persiste
  try {
    persistListValue_("tipo", cleanListValue_(val("categoria")));
    persistListValue_("set",  cleanListValue_(val("edicion")));
    persistListValue_("anio", cleanListValue_(val("anio")));
    // refresca datalists visuales
    ensureDatalists_();
    refreshDatalistsFromStorage_();
  } catch {
    // si storage está bloqueado, meh
  }

  try {
    state.isSaving = true;
    lockSave(true);

    setFormMeta("Guardando…");
    setStatus(dom.statusDot, dom.statusText, "loading", "Guardando…");

    // Payload PRO (data object)
    const payload = {
      action,
      rowIndex: rowIndex || "",
      id: built._id,
      data: built.data,
    };

    const res = await postJSONNoPreflight(CFG.API_URL, payload, CFG.NET.fetchTimeoutMs);
    if (!res.ok) throw new Error(res.json?.error || "No se pudo guardar");

    toast(res.json?.msg || "Guardado ✅", CFG.NET.toastMs);
    setFormMeta("Listo.");
    setStatus(dom.statusDot, dom.statusText, "ok", "Listo");

    // refresca TSV
    await loadTSV(true);

    // UX: si fue add, cerramos
    if (action === "add") closeDrawer();
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

  // deja inputs como están, pero fuerza “nuevo” quitando selected (así genera _id nuevo)
  state.selected = null;
  if (dom.btnDuplicate) dom.btnDuplicate.disabled = true;

  setFormMeta("Duplica y guarda.");
  openDrawer();
}

/* =========================
   EVOLUCIÓN: inyección si no existe en HTML
========================= */

function ensureEvolutionFields_() {
  // si ya existen, listo
  if ($("evoluciona_de") && $("evoluciona_a")) return;

  const form = dom.form;
  if (!form) return;

  // buscamos una sección para insertar: justo antes de "Inventario" (si existe)
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
      <label class="field">
        <span class="label">Evoluciona de</span>
        <input id="evoluciona_de" type="text" placeholder="Ej: Pichu / Charmander / Eevee…" />
        <span class="hint">¿De quién evoluciona esta carta? (si aplica)</span>
      </label>

      <label class="field">
        <span class="label">Evoluciona a</span>
        <input id="evoluciona_a" type="text" placeholder="Ej: Raichu / Charmeleon / Vaporeon…" />
        <span class="hint">¿A quién evoluciona? (si aplica)</span>
      </label>
    </div>
  `;

  if (insertBefore) {
    form.insertBefore(sec, insertBefore);
  } else {
    // fallback: al final, antes del footer
    const foot = form.querySelector(".drawer-foot");
    if (foot) form.insertBefore(sec, foot);
    else form.appendChild(sec);
  }
}

/* =========================
   DATALISTS (Tipo / Set / Año)
========================= */

function ensureDatalists_() {
  // crea datalist si no existe y lo asocia al input
  for (const key of Object.keys(LISTS)) {
    const cfg = LISTS[key];
    const input = $(cfg.inputId);
    if (!input) continue;

    let dl = $(cfg.dlId);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = cfg.dlId;
      document.body.appendChild(dl);
    }

    input.setAttribute("list", cfg.dlId);
  }

  // rellena desde storage (rápido) para que aparezcan aunque estés offline
  refreshDatalistsFromStorage_();
}

function refreshDatalistsFromStorage_() {
  for (const key of Object.keys(LISTS)) {
    const cfg = LISTS[key];
    const dl = $(cfg.dlId);
    if (!dl) continue;

    const values = readList_(cfg.lsKey);
    dl.replaceChildren(...values.map((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      return opt;
    }));
  }
}

function refreshDatalistsFromData_() {
  // Mezcla: valores desde TSV + lo que haya en localStorage
  const next = {
    tipo: new Set(readList_(LISTS.tipo.lsKey)),
    set:  new Set(readList_(LISTS.set.lsKey)),
    anio: new Set(readList_(LISTS.anio.lsKey)),
  };

  // extrae desde TSV usando colIndex (si existen las columnas)
  for (const row of (state.data || [])) {
    // tipo
    const t = cleanListValue_(getCell(row, "tipo"));
    if (t) next.tipo.add(t);

    // set
    const s = cleanListValue_(getCell(row, "edicion"));
    if (s) next.set.add(s);

    // año
    const a = cleanListValue_(getCell(row, "anio"));
    if (a) next.anio.add(a);
  }

  // guarda listas limpias (ordenadas)
  writeList_(LISTS.tipo.lsKey, Array.from(next.tipo).sort(localeSort_));
  writeList_(LISTS.set.lsKey,  Array.from(next.set).sort(localeSort_));
  writeList_(LISTS.anio.lsKey, Array.from(next.anio).sort(localeSortNum_));

  // y pinta datalists
  refreshDatalistsFromStorage_();
}

function persistListValue_(listKey, value) {
  const cfg = LISTS[listKey];
  if (!cfg) return;
  const v = cleanListValue_(value);
  if (!v) return;

  const arr = readList_(cfg.lsKey);
  if (arr.some((x) => norm(x) === norm(v))) return;

  arr.push(v);
  // tipo y set alfabético, año numérico
  if (listKey === "anio") arr.sort(localeSortNum_);
  else arr.sort(localeSort_);

  writeList_(cfg.lsKey, arr);
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
    // storage bloqueado, no pasa nada
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
