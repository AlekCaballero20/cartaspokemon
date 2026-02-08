/* ============================
  Pokémon TCG DB — services.api.js (PRO++)
  - Read: TSV published (GET)
  - Write: Apps Script WebApp (POST add/update) sin preflight
  - Robust: timeout, retries suaves, mejor manejo de errores
  - Zero drama: devuelve objetos consistentes
============================ */

/**
 * GET TSV (publicado) con timeout y opción de cache busting.
 * @param {string} url
 * @param {number} timeoutMs
 * @param {boolean} bypassCache
 * @returns {Promise<string>}
 */
export async function fetchTSVText(url, timeoutMs = 12000, bypassCache = false) {
  const finalUrl = bypassCache ? cacheBust_(url) : url;

  // 1 intento normal + 1 reintento rápido por flakiness de red móvil
  const attempts = 2;
  let lastErr = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchText_(finalUrl, timeoutMs);
    } catch (err) {
      lastErr = err;
      // si fue abort, no reintenta (casi siempre es real)
      if (isAbort_(err)) break;
      // backoff chiquito para redes inestables
      if (i < attempts - 1) await sleep_(180);
    }
  }

  throw lastErr || new Error("No se pudo cargar TSV.");
}

/**
 * Parse TSV a array de arrays.
 * - tolera líneas vacías al final
 * - mantiene columnas aunque falten celdas (no rellena, solo split)
 * @param {string} tsvText
 * @returns {string[][]}
 */
export function parseTSV(tsvText) {
  const clean = String(tsvText ?? "").replace(/\r/g, "").trim();
  if (!clean) return [];

  return clean
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t").map((x) => String(x ?? "").trim()));
}

/**
 * POST “sin preflight”:
 * Usamos Content-Type: text/plain;charset=utf-8 (NO application/json)
 *
 * Retorna:
 *  { ok: boolean, status: number, text: string, json: object|null, error: string|null }
 */
export async function postJSONNoPreflight(url, payloadObj, timeoutMs = 12000) {
  const body = JSON.stringify(payloadObj ?? {});
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      redirect: "follow",
      body,
      signal: ctrl.signal,
    });

    const text = await safeText_(resp);

    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }

    // Apps Script a veces devuelve 200 con ok:false, o 302/HTML raro si permisos
    const ok = !!json?.ok;

    let error = null;
    if (!resp.ok) {
      error = `HTTP ${resp.status}`;
    } else if (!ok) {
      error = json?.error || json?.msg || inferErrorFromText_(text) || "Respuesta no válida del servidor.";
    }

    return {
      ok: ok && resp.ok,
      status: resp.status,
      text,
      json,
      error,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: "",
      json: null,
      error: isAbort_(err) ? "Timeout" : (err?.message || "Error de red"),
    };
  } finally {
    clearTimeout(t);
  }
}

/* =========================
   Internal helpers
========================= */

async function fetchText_(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      // TSV publicado es público, pero agrego estos por higiene
      mode: "cors",
      credentials: "omit",
    });

    if (!r.ok) throw new Error(`TSV no disponible (${r.status})`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function cacheBust_(url) {
  const u = new URL(url);
  u.searchParams.set("_ts", String(Date.now()));
  return u.toString();
}

function isAbort_(err) {
  return err?.name === "AbortError";
}

function sleep_(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeText_(resp) {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

function inferErrorFromText_(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return null;

  // señales típicas cuando Apps Script no está público / devuelve HTML login
  if (t.includes("<html") && (t.includes("sign in") || t.includes("cuenta") || t.includes("login"))) {
    return "El WebApp parece requerir permisos (devuelve HTML de login).";
  }
  if (t.includes("error") && t.includes("jsonp")) return "Error cargando JSONP (URL mala o despliegue sin acceso).";
  return null;
}
