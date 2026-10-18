import { PixelGame } from "./game.js";
import {
  getAllLevels,
  getLevelData,
  saveCustomLevel,
  deleteCustomLevel,
  hashString,
} from "./levels.js";
import { loadImage, imageToLevel } from "./imageLevel.js";
import { sfx } from "./audio.js";
import confetti from "canvas-confetti";

const $ = (id) => document.getElementById(id);
const LAST_KEY = "foodhunt.lastLevel";

const ui = {
  levelName: $("level-name"),
  progressFill: $("progress-fill"),
  progressText: $("progress-text"),
  targetName: $("target-name"),
  targetSwatch: $("target-swatch"),
  targetCount: $("target-count"),
  select: $("level-select"),
  loading: $("loading"),
  btnDelete: $("btn-delete"),
  modalWin: $("modal-win"),
  modalLose: $("modal-lose"),
  modalImport: $("modal-import"),
};

const game = new PixelGame($("game-canvas"), {
  onProgress(eaten, total) {
    const pct = total ? Math.floor((eaten / total) * 100) : 0;
    ui.progressFill.style.width = pct + "%";
    ui.progressText.textContent = pct + "%";
  },
  onTarget(target) {
    if (!target) {
      ui.targetName.textContent = "Elige un frasco de color";
      ui.targetSwatch.style.backgroundColor = "#d8c8b8";
      ui.targetCount.textContent = "Toca un frasco";
      return;
    }
    ui.targetName.textContent = target.name;
    ui.targetSwatch.style.backgroundColor = target.hex;
    ui.targetCount.textContent = target.reachable
      ? `${target.remaining} píxeles`
      : "Sin ruta · ocupa sitio";
  },
  onWin() {
    ui.modalWin.classList.remove("hidden");
    confetti({ particleCount: 110, spread: 75, origin: { y: 0.55 } });
  },
  onLose() {
    ui.modalLose.classList.remove("hidden");
  },
});

let levels = getAllLevels();
let current = 0;
let loadToken = 0;

function populateSelect() {
  levels = getAllLevels();
  ui.select.innerHTML = "";
  levels.forEach((lvl, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i + 1}. ${lvl.name}`;
    ui.select.appendChild(opt);
  });
}

async function loadLevel(i) {
  levels = getAllLevels();
  current = ((i % levels.length) + levels.length) % levels.length;
  const def = levels[current];
  const token = ++loadToken;

  ui.modalWin.classList.add("hidden");
  ui.modalLose.classList.add("hidden");
  ui.select.value = current;
  ui.levelName.textContent = `Nivel ${current + 1}: ${def.name}`;
  ui.btnDelete.classList.toggle("hidden", !def.custom);
  localStorage.setItem(LAST_KEY, def.id);

  ui.loading.classList.remove("hidden");
  try {
    const data = await getLevelData(def);
    if (token !== loadToken) return;
    game.setLevel(data, hashString(`${def.id}:${Date.now()}:${Math.random()}`));
  } catch (err) {
    console.error(err);
    ui.levelName.textContent = "⚠️ No se pudo cargar el nivel";
  } finally {
    if (token === loadToken) ui.loading.classList.add("hidden");
  }
}

/* ---------------- Controles ---------------- */

$("btn-speed").addEventListener("click", (e) => {
  const s = game.toggleSpeed();
  e.currentTarget.textContent = `⏩ ${s}x`;
  e.currentTarget.classList.toggle("on", s === 2);
});
$("btn-sound").addEventListener("click", (e) => {
  e.currentTarget.textContent = sfx.toggleMute() ? "🔇" : "🔊";
});
$("btn-restart").addEventListener("click", () => loadLevel(current));
$("btn-prev").addEventListener("click", () => loadLevel(current - 1));
$("btn-next").addEventListener("click", () => loadLevel(current + 1));
$("btn-win-next").addEventListener("click", () => loadLevel(current + 1));
$("btn-lose-retry").addEventListener("click", () => loadLevel(current));
ui.select.addEventListener("change", (e) =>
  loadLevel(parseInt(e.target.value, 10)),
);

ui.btnDelete.addEventListener("click", () => {
  const def = levels[current];
  if (!def?.custom) return;
  if (!confirm(`¿Eliminar el nivel "${def.name}"?`)) return;
  deleteCustomLevel(def.id);
  populateSelect();
  loadLevel(Math.max(0, current - 1));
});

/* ---------------- Importador de imágenes ---------------- */

const imp = {
  file: $("import-file"),
  fileLabel: $("import-file-label"),
  name: $("import-name"),
  size: $("import-size"),
  colors: $("import-colors"),
  preview: $("import-preview"),
  stats: $("import-stats"),
  save: $("btn-import-save"),
  img: null,
  data: null,
};

function openImport() {
  imp.img = null;
  imp.data = null;
  imp.file.value = "";
  imp.name.value = "";
  imp.fileLabel.textContent = "📁 Elegir imagen";
  imp.stats.textContent = "";
  imp.save.disabled = true;
  imp.preview
    .getContext("2d")
    .clearRect(0, 0, imp.preview.width, imp.preview.height);
  ui.modalImport.classList.remove("hidden");
}

function renderPreview() {
  if (!imp.img) return;
  const [cols, rows] = imp.size.value.split("x").map(Number);
  const data = imageToLevel(imp.img, {
    cols,
    rows,
    maxColors: parseInt(imp.colors.value, 10),
  });
  imp.data = data;

  const cs = 8;
  const cv = imp.preview;
  cv.width = cols * cs;
  cv.height = rows * cs;
  const ctx = cv.getContext("2d");
  for (let i = 0; i < data.cells.length; i++) {
    const x = (i % cols) * cs,
      y = ((i / cols) | 0) * cs;
    ctx.fillStyle = data.palette[data.cells[i]].hex;
    ctx.fillRect(x, y, cs, cs);
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.fillRect(x + cs - 1, y, 1, cs);
    ctx.fillRect(x, y + cs - 1, cs, 1);
  }
  imp.stats.textContent = `${cols}×${rows} = ${cols * rows} píxeles · ${data.palette.length} colores: ${data.palette.map((p) => p.name).join(", ")}`;
  imp.save.disabled = false;
}

imp.file.addEventListener("change", async () => {
  const f = imp.file.files[0];
  if (!f) return;
  imp.fileLabel.textContent = "📷 " + f.name;
  if (!imp.name.value)
    imp.name.value = f.name.replace(/\.[^.]+$/, "").slice(0, 28);
  const url = URL.createObjectURL(f);
  try {
    imp.img = await loadImage(url);
    renderPreview();
  } catch {
    imp.stats.textContent = "⚠️ No se pudo leer la imagen.";
  } finally {
    URL.revokeObjectURL(url);
  }
});
imp.size.addEventListener("change", renderPreview);
imp.colors.addEventListener("change", renderPreview);

$("btn-import").addEventListener("click", openImport);
$("btn-import-cancel").addEventListener("click", () =>
  ui.modalImport.classList.add("hidden"),
);
imp.save.addEventListener("click", () => {
  if (!imp.data) return;
  const id = saveCustomLevel(imp.name.value.trim() || "Mi figura", imp.data);
  ui.modalImport.classList.add("hidden");
  populateSelect();
  loadLevel(levels.findIndex((l) => l.id === id));
});

/* ---------------- Inicio ---------------- */

populateSelect();
const params = new URLSearchParams(location.search);
const lastId = localStorage.getItem(LAST_KEY);
const lastIdx = levels.findIndex((l) => l.id === lastId);
const paramLevel = params.has("level")
  ? parseInt(params.get("level"), 10) - 1
  : -1;
loadLevel(paramLevel >= 0 ? paramLevel : lastIdx >= 0 ? lastIdx : 0);

// Modo de prueba: ?autoplay elige frascos automáticamente
if (params.has("autoplay")) {
  if (params.has("fast")) game.speed = 2;
  setInterval(() => game.autoStep(), 350);
}
