/**
 * Catálogo de niveles.
 *
 * - Niveles incluidos: ilustraciones en /public/levels/*.jpg que se convierten
 *   en grillas de píxeles al cargarse (ver imageLevel.js).
 * - Niveles personalizados: imágenes importadas por el usuario, ya convertidas
 *   y guardadas en localStorage.
 */
import { loadImage, imageToLevel, seededRandom } from './imageLevel.js';

export const BUILTIN_LEVELS = [
  { id: 'corazon',  name: 'Corazón ❤️',              src: 'levels/corazon.jpg',  cols: 60, rows: 60, colors: 6 },
  { id: 'casa',     name: 'Casita 🏠',                src: 'levels/casa.jpg',     cols: 60, rows: 60, colors: 7 },
  { id: 'flor',     name: 'Flor en maceta 🌸',        src: 'levels/flor.jpg',     cols: 60, rows: 60, colors: 6 },
  { id: 'pez',      name: 'Pez payaso 🐠',            src: 'levels/pez.jpg',      cols: 60, rows: 60, colors: 6 },
  { id: 'gato',     name: 'Gatito con moño 🐱',       src: 'levels/gato.jpg',     cols: 60, rows: 60, colors: 7 },
  { id: 'cohete',   name: 'Cohete espacial 🚀',       src: 'levels/cohete.jpg',   cols: 60, rows: 60, colors: 7 },
  { id: 'fantasma', name: 'Fantasma y calabaza 👻',   src: 'levels/fantasma.jpg', cols: 60, rows: 60, colors: 7 },
  { id: 'gaviota',  name: 'Gaviota playera 🏖️',       src: 'levels/gaviota.jpg',  cols: 60, rows: 60, colors: 9 },
  { id: 'jardin',   name: 'Jardín Laberinto 🌻',      src: 'levels/jardin.jpg',   cols: 60, rows: 60, colors: 9 },
  { id: 'espacio',  name: 'Batalla Espacial 🚀',      src: 'levels/espacio.jpg',  cols: 60, rows: 60, colors: 9 },
  { id: 'oceano',   name: 'Arrecife de Coral 🐠',     src: 'levels/oceano.jpg',   cols: 60, rows: 60, colors: 8 },
  { id: 'montana',  name: 'Cabaña en la Montaña ⛰️',  src: 'levels/montana.png',  cols: 60, rows: 60, colors: 8 },
  { id: 'atardecer',name: 'Atardecer en Familia 🌅', src: 'levels/atardecer.png',cols: 60, rows: 60, colors: 8 },
  { id: 'tienda',   name: 'Tienda Maximo Kiyoko 🏪', src: 'levels/tienda.png',   cols: 60, rows: 60, colors: 9 },
];

const cache = new Map();

export async function getLevelData(def) {
  if (def.data) return def.data;
  if (cache.has(def.id)) return cache.get(def.id);
  const img = await loadImage(import.meta.env.BASE_URL + def.src);
  const data = imageToLevel(img, { cols: def.cols, rows: def.rows, maxColors: def.colors });
  cache.set(def.id, data);
  return data;
}

/* ---------------------- Niveles personalizados ---------------------- */

const STORAGE_KEY = 'foodhunt.customLevels.v1';

function readCustom() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function deserialize(entry) {
  return {
    cols: entry.cols,
    rows: entry.rows,
    palette: entry.palette,
    cells: Int16Array.from(entry.cells, (ch) => ch.charCodeAt(0) - 97),
  };
}

export function saveCustomLevel(name, data) {
  const list = readCustom();
  const entry = {
    id: 'custom-' + Date.now(),
    name,
    cols: data.cols,
    rows: data.rows,
    palette: data.palette,
    cells: Array.from(data.cells, (v) => String.fromCharCode(97 + v)).join(''),
  };
  list.push(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  return entry.id;
}

export function deleteCustomLevel(id) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readCustom().filter((e) => e.id !== id)));
}

export function getAllLevels() {
  const custom = readCustom().map((e) => ({
    id: e.id,
    name: '⭐ ' + e.name,
    custom: true,
    cols: e.cols,
    rows: e.rows,
    data: deserialize(e),
  }));
  return [...BUILTIN_LEVELS, ...custom];
}

/* ------------------------- Frascos / reserva ------------------------ */

const JAR_SIZES = [10, 20, 40, 50, 60, 90];

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Reparte los píxeles de cada color en frascos (20-60) que suman exactamente
 * el total del color, y los apila en columnas. Solo el frasco de arriba de
 * cada columna se puede tocar. Los frascos de colores distintos se intercalan
 * aleatoriamente, manteniendo el orden de profundidad dentro de cada color.
 */
export function buildJarColumns(data, numColumns, seed) {
  const { cols, rows, cells, palette } = data;
  const n = cols * rows;
  const rnd = seededRandom(seed);

  // Profundidad de cada celda respecto al borde del tablero (BFS)
  const depth = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) {
    const r = (i / cols) | 0, c = i % cols;
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) {
      depth[i] = 0;
      queue[qt++] = i;
    }
  }
  while (qh < qt) {
    const i = queue[qh++];
    const r = (i / cols) | 0, c = i % cols;
    const nb = [r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1];
    for (const j of nb) {
      if (j >= 0 && depth[j] < 0) {
        depth[j] = depth[i] + 1;
        queue[qt++] = j;
      }
    }
  }

  const byColor = palette.map(() => []);
  for (let i = 0; i < n; i++) if (cells[i] >= 0) byColor[cells[i]].push(depth[i]);

  const jarsByColor = [];
  let id = 1;
  byColor.forEach((depths, color) => {
    depths.sort((a, b) => a - b);
    let idx = 0;
    const colorJars = [];
    while (idx < depths.length) {
      const rem = depths.length - idx;
      let cap = JAR_SIZES[Math.floor(rnd() * JAR_SIZES.length)];
      if (rem <= cap + 10) cap = rem;
      colorJars.push({
        id: id++,
        color,
        hex: palette[color].hex,
        capacity: cap,
        remaining: cap, // píxeles que faltan comer
        dispatched: 0,  // hormigas ya enviadas
      });
      idx += cap;
    }
    jarsByColor.push(colorJars);
  });

  const jars = [];
  let lastColor = -1;
  while (jarsByColor.some((queue) => queue.length > 0)) {
    let choices = [];
    for (let color = 0; color < jarsByColor.length; color++) {
      if (jarsByColor[color].length) choices.push(color);
    }
    const alternatives = choices.filter((color) => color !== lastColor);
    if (alternatives.length) choices = alternatives;
    const color = choices[Math.floor(rnd() * choices.length)];
    jars.push(jarsByColor[color].shift());
    lastColor = color;
  }

  const columns = Array.from({ length: numColumns }, () => []);
  jars.forEach((jar, i) => {
    jar.col = i % numColumns;
    columns[jar.col].push(jar);
  });
  return columns;
}
