/* ============================
  Pokémon TCG DB — ui.render.js (PRO+++)
  Render de tabla + helpers UI (sin lógica de red)
  - Tabla compacta usando TABLE_COLUMNS
  - Empty state amable
  - Skeleton (opcional) para loading
  - Status dot/pill sin depender de clases extra
  - Toast robusto (reutilizable)
============================ */

import { TABLE_COLUMNS } from "./data.schema.js";

/* =========================
   TABLE
========================= */

/**
 * Renderiza la tabla (tbody) en modo “compacto”.
 * - No muestra _id
 * - Agrega botón Editar (delegación la maneja app.js)
 * - Performance: DocumentFragment + replaceChildren
 *
 * opts:
 *  - idKey: string (default "_id")
 *  - formatPrice: boolean (default true)
 *  - dateFormat: "iso" | "raw" (default "iso")
 */
export function renderTable(tbodyEl, rows, colIndex, opts = {}) {
  const {
    idKey = "_id",
    formatPrice = true,
    dateFormat = "iso",
  } = opts;

  if (!tbodyEl) return;

  const safeRows = Array.isArray(rows) ? rows : [];
  const idIdx = idx(colIndex, idKey);

  // Empty state
  if (safeRows.length === 0) {
    tbodyEl.replaceChildren(renderEmptyRow_(TABLE_COLUMNS.length + 1));
    return;
  }

  const frag = document.createDocumentFragment();

  for (const row of safeRows) {
    const tr = document.createElement("tr");

    // dataset.id para editar
    const id = idIdx >= 0 ? String(row?.[idIdx] ?? "").trim() : "";
    if (id) tr.dataset.id = id;

    // Celdas según schema
    for (const c of TABLE_COLUMNS) {
      const td = document.createElement("td");
      td.textContent = formatCell_(row, c.key, colIndex, { formatPrice, dateFormat });
      tr.appendChild(td);
    }

    // Acciones
    const tdActions = document.createElement("td");
    tdActions.className = "actions";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rowbtn edit";
    btn.textContent = "Editar";
    btn.setAttribute("data-action", "edit");
    btn.setAttribute("aria-label", "Editar carta");

    tdActions.appendChild(btn);
    tr.appendChild(tdActions);

    frag.appendChild(tr);
  }

  tbodyEl.replaceChildren(frag);
}

/**
 * Skeleton loading (opcional).
 * Útil para cuando estás descargando TSV y no quieres tabla vacía.
 *
 * @param {HTMLElement} tbodyEl
 * @param {number} rowsCount
 */
export function renderSkeleton(tbodyEl, rowsCount = 7) {
  if (!tbodyEl) return;

  const n = clampInt_(rowsCount, 3, 14);
  const cols = TABLE_COLUMNS.length + 1; // + acciones

  ensureInlineStyle_();

  const frag = document.createDocumentFragment();
  for (let r = 0; r < n; r++) {
    const tr = document.createElement("tr");
    tr.className = "row-skel";

    for (let c = 0; c < cols; c++) {
      const td = document.createElement("td");
      const bar = document.createElement("span");
      bar.className = "skel";
      // variación leve para que no se vea como tabla clonada
      bar.style.width = `${55 + ((r + c) % 4) * 12}%`;
      td.appendChild(bar);
      tr.appendChild(td);
    }

    frag.appendChild(tr);
  }

  tbodyEl.replaceChildren(frag);
}

/**
 * Contador de resultados
 */
export function renderCount(el, n) {
  if (!el) return;
  const nn = Number.isFinite(Number(n)) ? Number(n) : 0;
  el.textContent = `${nn} resultado${nn === 1 ? "" : "s"}`;
}

/* =========================
   STATUS
========================= */

/**
 * Status pill (texto + dot) sin depender de CSS extra.
 * kind: "ok" | "loading" | "error"
 */
export function setStatus(statusDotEl, statusTextEl, kind, text) {
  if (statusTextEl) statusTextEl.textContent = text ?? "";

  if (!statusDotEl) return;

  const styles = STATUS_STYLES[kind] || STATUS_STYLES.error;
  statusDotEl.style.background = styles.bg;
  statusDotEl.style.boxShadow = styles.shadow;

  // Accesibilidad básica
  statusDotEl.setAttribute("aria-hidden", "true");
}

const STATUS_STYLES = {
  ok: {
    bg: "rgba(34, 197, 94, .85)",
    shadow: "0 0 0 4px rgba(34,197,94,.18)",
  },
  loading: {
    bg: "rgba(59, 130, 246, .85)",
    shadow: "0 0 0 4px rgba(59,130,246,.18)",
  },
  error: {
    bg: "rgba(239, 68, 68, .85)",
    shadow: "0 0 0 4px rgba(239,68,68,.18)",
  },
};

/* =========================
   TOAST
========================= */

let toastTimer = null;
let toastStyleInjected = false;

/**
 * Toast simple, pero decente:
 * - Inyecta estilos una vez
 * - Reutiliza el mismo nodo
 * - Reemplaza mensaje si se llama de nuevo
 */
export function toast(msg, ms = 2400) {
  ensureInlineStyle_();

  const text = String(msg ?? "").trim();
  if (!text) return;

  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    document.body.appendChild(el);
  }

  // Evita “parpadeo”: si ya está visible, solo cambia texto
  el.textContent = text;
  el.classList.add("is-on");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), clampMs_(ms));
}

/* =========================
   INTERNAL HELPERS
========================= */

function idx(colIndex, key) {
  const v = colIndex?.[key];
  return Number.isInteger(v) ? v : -1;
}

function get_(row, colIndex, key) {
  const i = idx(colIndex, key);
  return i >= 0 ? (row?.[i] ?? "") : "";
}

function formatCell_(row, key, colIndex, opts) {
  const raw = String(get_(row, colIndex, key) ?? "").trim();
  if (!raw) return "";

  // HP: fuerza entero si se puede
  if (key === "nivel") {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? String(n) : normalizeSpaces_(raw);
  }

  // Cantidad: fuerza entero si se puede
  if (key === "cantidad") {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? String(n) : normalizeSpaces_(raw);
  }

  // Precio: si es numérico, lo formatea lindo (sin obligarte)
  if (key === "precio") {
    if (!opts?.formatPrice) return normalizeSpaces_(raw);

    const n = toNumber_(raw);
    if (!Number.isFinite(n)) return normalizeSpaces_(raw);

    // Si es entero, sin decimales. Si tiene decimales, los respeta.
    const isInt = Math.abs(n - Math.round(n)) < 1e-9;
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: isInt ? 0 : 2,
    }).format(n);
  }

  // Fecha: si viene ISO YYYY-MM-DD, lo muestra como DD/MM/YYYY (sin romper)
  if (key === "fecha_compra") {
    if ((opts?.dateFormat ?? "iso") === "raw") return normalizeSpaces_(raw);
    const d = parseISODate_(raw);
    if (!d) return normalizeSpaces_(raw);
    return d;
  }

  // Otros: normaliza multi-espacio
  return normalizeSpaces_(raw);
}

function renderEmptyRow_(colspan) {
  const tr = document.createElement("tr");
  tr.className = "row-empty";

  const td = document.createElement("td");
  td.colSpan = Math.max(1, Number(colspan) || 1);
  td.textContent = "No hay resultados. Intenta otra búsqueda o crea una carta nueva.";

  tr.appendChild(td);
  return tr;
}

function ensureInlineStyle_() {
  if (toastStyleInjected) return;
  toastStyleInjected = true;

  const style = document.createElement("style");
  style.id = "ui-render-inline-style";
  style.textContent = `
    .toast{
      position: fixed;
      left: 50%;
      bottom: calc(18px + env(safe-area-inset-bottom));
      transform: translateX(-50%) translateY(12px);
      background: rgba(255,255,255,.92);
      border: 1px solid rgba(11,16,32,.12);
      color: rgba(11,16,32,.86);
      padding: 10px 14px;
      border-radius: 999px;
      box-shadow: 0 18px 40px rgba(11,16,32,.18);
      font-weight: 800;
      font-size: 13px;
      letter-spacing: .2px;
      opacity: 0;
      pointer-events: none;
      transition: opacity .16s ease, transform .16s ease;
      z-index: 9999;
      max-width: min(92vw, 680px);
      text-align: center;
      user-select: none;
      -webkit-user-select: none;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .toast.is-on{
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    /* Empty row (fallback decente) */
    #dbTable tbody tr.row-empty td{
      padding: 16px 14px;
      color: rgba(11,16,32,.70);
      font-weight: 700;
      text-align: center;
    }

    /* Skeleton rows */
    #dbTable tbody tr.row-skel td{
      padding: 12px 14px;
    }
    .skel{
      display: inline-block;
      height: 12px;
      border-radius: 999px;
      background: linear-gradient(90deg,
        rgba(11,16,32,.06),
        rgba(11,16,32,.10),
        rgba(11,16,32,.06)
      );
      background-size: 200% 100%;
      animation: skelShimmer 1.1s ease-in-out infinite;
    }
    @keyframes skelShimmer{
      0%{ background-position: 0% 0; }
      100%{ background-position: 200% 0; }
    }

    /* Reduce motion */
    @media (prefers-reduced-motion: reduce){
      .toast{ transition: none; }
      .skel{ animation: none; }
    }
  `;
  document.head.appendChild(style);
}

function normalizeSpaces_(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function parseISODate_(s) {
  // Espera "YYYY-MM-DD" (típico input date)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return "";
  const yyyy = m[1];
  const mm = m[2];
  const dd = m[3];
  return `${dd}/${mm}/${yyyy}`;
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

function clampMs_(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 2400;
  return Math.min(8000, Math.max(900, Math.floor(n)));
}

function clampInt_(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
