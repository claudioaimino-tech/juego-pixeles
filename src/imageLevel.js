/**
 * Conversión de imágenes a niveles de píxeles.
 *
 * Toma cualquier imagen (pixel art, ícono o dibujo), la recorta al aspecto de la
 * grilla, reduce los colores a una paleta pequeña (k-means) y limpia manchas
 * sueltas para que cada color forme zonas conectadas (no píxeles desparramados).
 *
 * Se usa tanto para los niveles incluidos como para el importador de imágenes.
 */

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(`No se pudo cargar la imagen: ${src}`));
    img.src = src;
  });
}

/** Generador pseudoaleatorio determinista (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUB = 6; // sub-muestras por celda (por lado) para decidir el color dominante

/**
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {{cols:number, rows:number, maxColors?:number, minRegion?:number, minColorCells?:number}} opts
 * @returns {{cols:number, rows:number, palette:{hex:string,name:string}[], cells:Int16Array}}
 */
export function imageToLevel(img, opts) {
  const { cols, rows, maxColors = 7, minRegion = 4, minColorCells = 12 } = opts;

  // 1. Recortar al centro con el aspecto de la grilla y muestrear
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const targetAR = cols / rows;
  let sx = 0,
    sy = 0,
    sw = iw,
    sh = ih;
  if (iw / ih > targetAR) {
    sw = ih * targetAR;
    sx = (iw - sw) / 2;
  } else {
    sh = iw / targetAR;
    sy = (ih - sh) / 2;
  }

  const W = cols * SUB,
    H = rows * SUB;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  cx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  const px = cx.getImageData(0, 0, W, H).data;

  // 2. Paleta por k-means
  let centroids = kmeans(px, W * H, maxColors);
  centroids = mergeClose(centroids, 34);

  // 3. Color dominante por celda (voto de sub-muestras => bordes nítidos)
  const n = cols * rows;
  let cells = new Int16Array(n);
  const votes = new Int32Array(centroids.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      votes.fill(0);
      for (let y = 0; y < SUB; y++) {
        for (let x = 0; x < SUB; x++) {
          const i = ((r * SUB + y) * W + (c * SUB + x)) * 4;
          votes[nearest(centroids, px[i], px[i + 1], px[i + 2])]++;
        }
      }
      let best = 0;
      for (let k = 1; k < votes.length; k++)
        if (votes[k] > votes[best]) best = k;
      cells[r * cols + c] = best;
    }
  }

  // 4. Colores con muy pocas celdas -> se funden con el color más parecido
  for (let pass = 0; pass < 3; pass++) {
    const counts = countColors(cells, centroids.length);
    let changed = false;
    for (let k = 0; k < centroids.length; k++) {
      if (counts[k] > 0 && counts[k] < minColorCells) {
        let best = -1,
          bestD = Infinity;
        for (let j = 0; j < centroids.length; j++) {
          if (j === k || counts[j] < minColorCells) continue;
          const d = dist2(centroids[k], centroids[j]);
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        }
        if (best >= 0) {
          for (let i = 0; i < n; i++) if (cells[i] === k) cells[i] = best;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // 5. Limpiar manchas sueltas: regiones pequeñas adoptan el color vecino dominante
  cleanRegions(cells, cols, rows, minRegion, centroids.length);

  // 6. Compactar la paleta (eliminar colores sin uso) y ordenarla por cantidad
  const counts = countColors(cells, centroids.length);
  const used = [];
  for (let k = 0; k < centroids.length; k++) if (counts[k] > 0) used.push(k);
  used.sort((a, b) => counts[b] - counts[a]);
  const remap = new Int16Array(centroids.length).fill(-1);
  used.forEach((k, idx) => (remap[k] = idx));
  for (let i = 0; i < n; i++) cells[i] = remap[cells[i]];

  const palette = used.map((k) => {
    const [r, g, b] = centroids[k];
    return { hex: rgbToHex(r, g, b), name: colorName(r, g, b) };
  });

  return { cols, rows, palette, cells };
}

/* ------------------------------------------------------------------ */

function kmeans(px, count, k) {
  const rnd = seededRandom(1234);
  // Submuestreo para velocidad
  const stride = Math.max(1, Math.floor(count / 9000));
  const samples = [];
  for (let i = 0; i < count; i += stride) {
    const o = i * 4;
    if (px[o + 3] < 128) continue;
    samples.push([px[o], px[o + 1], px[o + 2]]);
  }
  if (samples.length === 0) return [[255, 255, 255]];

  // k-means++
  const cents = [samples[Math.floor(rnd() * samples.length)].slice()];
  const d = new Float64Array(samples.length);
  while (cents.length < k) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      let m = Infinity;
      for (const c of cents) m = Math.min(m, dist2(samples[i], c));
      d[i] = m;
      sum += m;
    }
    if (sum === 0) break;
    let t = rnd() * sum,
      idx = 0;
    while (idx < samples.length - 1 && (t -= d[idx]) > 0) idx++;
    cents.push(samples[idx].slice());
  }

  const assign = new Int16Array(samples.length);
  for (let iter = 0; iter < 14; iter++) {
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      assign[i] = nearest(cents, s[0], s[1], s[2]);
    }
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i++) {
      const a = acc[assign[i]],
        s = samples[i];
      a[0] += s[0];
      a[1] += s[1];
      a[2] += s[2];
      a[3]++;
    }
    for (let j = 0; j < cents.length; j++) {
      if (acc[j][3] > 0)
        cents[j] = [
          acc[j][0] / acc[j][3],
          acc[j][1] / acc[j][3],
          acc[j][2] / acc[j][3],
        ];
    }
  }
  return cents.map((c) => c.map(Math.round));
}

function mergeClose(cents, threshold) {
  const out = [];
  const t2 = threshold * threshold;
  for (const c of cents) {
    if (!out.some((o) => dist2(o, c) < t2)) out.push(c);
  }
  return out;
}

function cleanRegions(cells, cols, rows, minRegion, numColors) {
  const n = cols * rows;
  const seen = new Int32Array(n);
  const stack = new Int32Array(n);
  const region = new Int32Array(n);
  const neighborVotes = new Int32Array(numColors);

  for (let pass = 1; pass <= 4; pass++) {
    let changed = false;
    seen.fill(0);
    for (let start = 0; start < n; start++) {
      if (seen[start]) continue;
      const color = cells[start];
      let sp = 0,
        rl = 0;
      stack[sp++] = start;
      seen[start] = 1;
      neighborVotes.fill(0);
      while (sp > 0) {
        const i = stack[--sp];
        region[rl++] = i;
        const r = (i / cols) | 0,
          c = i % cols;
        const nb = [
          r > 0 ? i - cols : -1,
          r < rows - 1 ? i + cols : -1,
          c > 0 ? i - 1 : -1,
          c < cols - 1 ? i + 1 : -1,
        ];
        for (const j of nb) {
          if (j < 0) continue;
          if (cells[j] === color) {
            if (!seen[j]) {
              seen[j] = 1;
              stack[sp++] = j;
            }
          } else {
            neighborVotes[cells[j]]++;
          }
        }
      }
      if (rl < minRegion) {
        let best = -1,
          bestV = 0;
        for (let k = 0; k < numColors; k++)
          if (neighborVotes[k] > bestV) {
            bestV = neighborVotes[k];
            best = k;
          }
        if (best >= 0) {
          for (let q = 0; q < rl; q++) cells[region[q]] = best;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

function countColors(cells, k) {
  const counts = new Int32Array(k);
  for (let i = 0; i < cells.length; i++) if (cells[i] >= 0) counts[cells[i]]++;
  return counts;
}

function nearest(cents, r, g, b) {
  let best = 0,
    bestD = Infinity;
  for (let j = 0; j < cents.length; j++) {
    const c = cents[j];
    const dr = r - c[0],
      dg = g - c[1],
      db = b - c[2];
    // Distancia ponderada (más fiel a la percepción humana)
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  }
  return best;
}

function dist2(a, b) {
  const dr = a[0] - b[0],
    dg = a[1] - b[1],
    db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}

/** Nombre de color aproximado en español, para mostrar en la interfaz. */
export function colorName(r, g, b) {
  const max = Math.max(r, g, b) / 255,
    min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.9 && s < 0.35) return "Blanco";
  if (l < 0.13) return "Negro";
  if (s < 0.15) return l > 0.6 ? "Gris claro" : "Gris";
  let h;
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  if ((h < 40 && l < 0.4) || (h < 40 && s < 0.45 && l < 0.55)) return "Marrón";
  if (h < 12 || h >= 340) return l > 0.7 ? "Rosa" : "Rojo";
  if (h < 40) return "Naranja";
  if (h < 66) return "Amarillo";
  if (h < 160) return "Verde";
  if (h < 200) return "Celeste";
  if (h < 250) return "Azul";
  if (h < 290) return "Violeta";
  return "Rosa";
}
