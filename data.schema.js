/* ============================
  Pokémon TCG DB — data.schema.js (PRO+++)
  - Esquema + mapeo robusto por HEADER (aliases)
  - Compatible con UI heredada (IDs del form actuales)
  - Añade evolución (EvolucionaDe / EvolucionaA)
  - Quita EnergíaCoste (atk) del modelo frontend
  - Exporta keys útiles (search/list/render)
============================ */

/**
 * Columnas objetivo recomendadas en Google Sheets (Pokémon):
 * _id  #  Set  Año  Nombre  Tipo  Elemento  HP  Subtipo  EvolucionaDe  EvolucionaA  Cantidad  Idioma  Precio  Fecha  Notas  ImagenURL
 *
 * Compatibilidad UI (IDs del form / app):
 * - UI "edicion"      -> Sheet "Set"
 * - UI "categoria"    -> Sheet "Tipo"
 * - UI "atributo"     -> Sheet "Elemento"
 * - UI "nivel"        -> Sheet "HP"
 * - UI "fecha_compra" -> Sheet "Fecha"
 * - UI "evoluciona_de"-> Sheet "EvolucionaDe"
 * - UI "evoluciona_a" -> Sheet "EvolucionaA"
 */

/** Clave de ID interna (para dataset / edición / update) */
export const ID_KEY = "_id";

/**
 * Aliases por header: claves canónicas -> posibles nombres en el TSV header.
 * - Claves canónicas: las usa el frontend internamente.
 * - Aliases: tolera headers con tildes, mayúsculas, nombres raros, etc.
 */
export const HEADER_ALIASES = Object.freeze({
  [ID_KEY]: ["_id", "id", "uuid", "uid"],

  // Identidad
  num: ["#", "num", "numero", "número", "no", "nº"],
  edicion: ["set", "edicion", "edición", "expansion", "expansión", "coleccion", "colección"],
  anio: ["año", "anio", "year"],
  nombre: ["nombre", "name", "card name", "cardname", "nombre carta"],

  // Clasificación
  // “Tipo” en sheet (Pokémon / Entrenador / Energía)
  tipo: ["tipo", "type", "card type", "categoria", "categoría"],

  // “Elemento” (Electric, Fire, etc.)
  atributo: [
    "elemento",
    "element",
    "energy type",
    "element type",
    "tipo elemento",
    "tipo de energia",
    "tipo de energía",
    "energia tipo",
    "energía tipo",
  ],

  // HP
  nivel: ["hp", "vida", "puntos de vida", "health", "pv"],

  // Subtipo (Básico, Stage 1, Item, etc.)
  subtipo: ["subtipo", "subtype", "sub type", "stage", "subcategoria", "sub-categoria", "sub categoría"],

  // Evolución
  evoluciona_de: [
    "evolucionade",
    "evoluciona de",
    "evoluciona_de",
    "evolución de",
    "evolución_de",
    "evolves from",
    "from",
    "pre-evolucion",
    "pre evolucion",
    "pre-evolución",
  ],
  evoluciona_a: [
    "evoluciona a",
    "evoluciona_a",
    "evolución a",
    "evolución_a",
    "evolves to",
    "evolves into",
    "to",
    "evoluciona",
    "evoluciona en",
  ],

  // Inventario / meta
  cantidad: ["cantidad", "qty", "quantity", "cant", "stock"],
  idioma: ["idioma", "language", "lang"],
  precio: ["precio", "price", "valor", "costo", "cost"],

  // Fecha (compra/ingreso)
  fecha_compra: [
    "fecha",
    "fecha_compra",
    "fecha compra",
    "fecha ingreso",
    "fecha de ingreso",
    "date",
    "purchase date",
  ],

  notas: ["notas", "notes", "observaciones", "obs"],
  imagenurl: [
    "imagenurl",
    "imagen url",
    "imageurl",
    "image url",
    "url",
    "url imagen",
    "url de imagen",
    "image",
    "img",
    "foto",
    "foto url",
  ],
});

/**
 * IDs reales del formulario (index.html)
 * Esto define los inputs que app.js lee/escribe.
 * OJO: quitamos "atk" (EnergíaCoste) porque ya no se usa.
 */
export const FORM_FIELDS = Object.freeze([
  "num",
  "edicion",
  "anio",
  "nombre",
  "categoria",     // UI: Tipo (mapea a sheet: tipo)
  "subtipo",
  "atributo",      // UI: Elemento (mapea a sheet: atributo)
  "nivel",         // UI: HP (mapea a sheet: nivel)

  // Evolución (nuevo)
  "evoluciona_de",
  "evoluciona_a",

  "cantidad",
  "idioma",
  "precio",
  "fecha_compra",
  "notas",
  "imagenurl",
]);

/**
 * Columnas visibles en tabla compacta
 * key: clave canónica del “modelo” (header-mapped)
 * label: texto de <th>
 */
export const TABLE_COLUMNS = Object.freeze([
  { key: "num", label: "#" },
  { key: "nombre", label: "Nombre" },
  { key: "tipo", label: "Tipo" },
  { key: "atributo", label: "Elemento" },
  { key: "nivel", label: "HP" },
  { key: "edicion", label: "Set" },
  { key: "cantidad", label: "Cant." },
  { key: "precio", label: "Precio" },
  { key: "fecha_compra", label: "Fecha" },
]);

/**
 * Campos recomendados para búsqueda.
 * ui.filters.js usa esto para evitar escanear toda la fila.
 * Quitamos "atk". Añadimos evolución.
 */
export const SEARCH_KEYS = Object.freeze([
  "num",
  "nombre",
  "edicion",
  "anio",
  "tipo",
  "atributo",
  "nivel",
  "subtipo",
  "evoluciona_de",
  "evoluciona_a",
  "idioma",
  "precio",
  "fecha_compra",
  "notas",
]);

/**
 * Keys que quieres convertir en listas (datalist/autocomplete).
 * (No hace nada solo; app.js lo puede usar para construir opciones.)
 */
export const LIST_KEYS = Object.freeze([
  "edicion", // Set
  "anio",    // Año
  "tipo",    // Tipo
]);

/**
 * UI -> Sheet (claves canónicas) para guardar.
 * Ojo: "categoria" en UI se guarda como "tipo" en el sheet.
 */
export const UI_TO_SHEET = Object.freeze({
  num: "num",
  edicion: "edicion",
  anio: "anio",
  nombre: "nombre",

  categoria: "tipo",
  subtipo: "subtipo",
  atributo: "atributo",
  nivel: "nivel",

  evoluciona_de: "evoluciona_de",
  evoluciona_a: "evoluciona_a",

  cantidad: "cantidad",
  idioma: "idioma",
  precio: "precio",
  fecha_compra: "fecha_compra",
  notas: "notas",
  imagenurl: "imagenurl",
});

/**
 * Sheet -> UI para rellenar el form al editar.
 */
export const SHEET_TO_UI = Object.freeze({
  num: "num",
  edicion: "edicion",
  anio: "anio",
  nombre: "nombre",

  tipo: "categoria",
  subtipo: "subtipo",
  atributo: "atributo",
  nivel: "nivel",

  evoluciona_de: "evoluciona_de",
  evoluciona_a: "evoluciona_a",

  cantidad: "cantidad",
  idioma: "idioma",
  precio: "precio",
  fecha_compra: "fecha_compra",
  notas: "notas",
  imagenurl: "imagenurl",
});

/**
 * Defaults de formulario (shape claro, sin undefined).
 */
export const DEFAULT_FORM = Object.freeze(
  FORM_FIELDS.reduce((acc, k) => {
    acc[k] = "";
    return acc;
  }, {})
);

/**
 * Campos clave para validación mínima.
 */
export const REQUIRED_UI_FIELDS = Object.freeze(["nombre"]);
