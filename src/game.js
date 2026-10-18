import { Ant, Particle, shade } from "./creature.js";
import { sfx } from "./audio.js";
import { buildJarColumns } from "./levels.js";

const EMPTY = -1;
const SLOT_COUNT = 5;
const RESERVE_COLS = 5;
const MAX_ANTS = 150;
const SPAWN_INTERVAL = 0.085; // segundos entre hormigas de un mismo frasco
const STUCK_SECONDS = 2.5;

const COLORS = {
  bg: "#F6DCC4",
  frame: "#F7F1EA",
  frameEdge: "#E2D3C2",
  rail: "#EFE5DA",
  emptyCell: "#EADCCB",
  slot: "#EBD3BC",
  slotEdge: "#DDBFA3",
};

/**
 * Motor del juego.
 *
 * Reglas de movimiento:
 *  - Las hormigas salen del agujero, suben al riel del marco y caminan por él.
 *  - Solo pueden comer celdas EXPUESTAS de su color: las que tocan el borde
 *    del tablero o una celda ya vacía.
 *  - Para llegar a celdas interiores entran caminando SOLO por celdas vacías
 *    (nunca atraviesan píxeles de otro color).
 */
export class PixelGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cb = callbacks;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    this.data = null;
    this.cells = null;
    this.reserved = null;
    this.slots = Array(SLOT_COUNT).fill(null);
    this.columns = [];
    this.ants = [];
    this.particles = [];
    this.speed = 1;
    this.state = "idle"; // idle | playing | won | lost
    this.stuckTimer = 0;
    this.stuckCheck = 0;
    this.winTimer = 0;
    this.L = null;

    this.boardCanvas = document.createElement("canvas");
    this.bctx = this.boardCanvas.getContext("2d");

    window.addEventListener("resize", () => this.resize());
    canvas.addEventListener("pointerdown", (e) => this.onPointer(e));

    this.resize();
    this.last = performance.now();
    const loop = (t) => {
      const dt = Math.min((t - this.last) / 1000, 0.05);
      this.last = t;
      this.update(dt * this.speed);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ============================ Nivel ============================ */

  setLevel(data, seed) {
    this.data = data;
    const n = data.cols * data.rows;
    this.cells = Int16Array.from(data.cells);
    this.reserved = new Uint8Array(n);
    this.visit = new Int32Array(n);
    this.parent = new Int32Array(n);
    this.queue = new Int32Array(n);
    this.stamp = 0;

    this.total = 0;
    for (let i = 0; i < n; i++) if (this.cells[i] !== EMPTY) this.total++;
    this.eaten = 0;
    this.remainingByColor = new Int32Array(data.palette.length);
    for (let i = 0; i < n; i++)
      if (this.cells[i] !== EMPTY) this.remainingByColor[this.cells[i]]++;
    this.targetColor = -1;

    this.columns = buildJarColumns(data, RESERVE_COLS, seed);
    this.slots = Array(SLOT_COUNT).fill(null);
    this.ants = [];
    this.particles = [];
    this.state = "playing";
    this.stuckTimer = 0;
    this.winTimer = 0;

    this.layout();
    this.redrawBoard();
    const availableTarget = this.columns
      .map((column) => column[0])
      .find((jar) => jar && this.findTarget(jar.color) >= 0);
    const firstTarget =
      availableTarget ||
      this.columns.map((column) => column[0]).find((jar) => jar);
    if (firstTarget) this.setTargetColor(firstTarget.color);
    else this.cb.onTarget?.(null);
    this.cb.onProgress?.(0, this.total);
  }

  toggleSpeed() {
    this.speed = this.speed === 1 ? 2 : 1;
    return this.speed;
  }

  /* ============================ Layout =========================== */

  resize() {
    const p = this.canvas.parentElement;
    this.w = p.clientWidth;
    this.h = p.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (this.data) {
      this.layout();
      this.redrawBoard();
    }
  }

  layout() {
    const { cols, rows } = this.data;
    const W = this.w,
      H = this.h;
    const rail = Math.max(12, Math.min(18, Math.round(W * 0.035)));

    const maxBW = W - 2 * rail - 12;
    const maxBH = H * 0.48 - 2 * rail; // Reserva espacio para dos filas de frascos siguientes
    const cs = Math.max(
      3,
      Math.floor(Math.min(maxBW / cols, maxBH / rows) * this.dpr) / this.dpr,
    );
    const bw = cs * cols,
      bh = cs * rows;
    const bx = Math.round((W - bw) / 2);
    const by = Math.round(8 + rail);

    const frame = {
      x: bx - rail,
      y: by - rail,
      w: bw + 2 * rail,
      h: bh + 2 * rail,
    };
    const railR = {
      x: bx - rail / 2,
      y: by - rail / 2,
      w: bw + rail,
      h: bh + rail,
    };
    const hole = {
      x: W / 2,
      y: frame.y + frame.h + 12,
      r: Math.max(10, Math.min(16, cs * 2)),
    };

    const gap = 6;
    // Casilleros más chicos
    const slotW = Math.min(
      50,
      Math.floor((W - 20 - gap * (SLOT_COUNT - 1)) / SLOT_COUNT),
    );
    const slotH = Math.round(slotW * 1.08);
    const trayX = (W - (SLOT_COUNT * slotW + (SLOT_COUNT - 1) * gap)) / 2;
    const trayY = hole.y + hole.r + 8;
    const reserveY = trayY + slotH + 27;

    this.L = {
      cs,
      bx,
      by,
      bw,
      bh,
      rail,
      frame,
      railR,
      hole,
      gap,
      slotW,
      slotH,
      trayX,
      trayY,
      reserveY,
      perim: 2 * (railR.w + railR.h),
      antSpeed: 210 + cs * 6,
    };
    this.boardCanvas.width = Math.round(bw * this.dpr);
    this.boardCanvas.height = Math.round(bh * this.dpr);
  }

  slotRect(i) {
    const L = this.L;
    return {
      x: L.trayX + i * (L.slotW + L.gap),
      y: L.trayY,
      w: L.slotW,
      h: L.slotH,
    };
  }

  columnRect(c) {
    const L = this.L;
    return {
      x: L.trayX + c * (L.slotW + L.gap),
      y: L.reserveY,
      w: L.slotW,
      h: L.slotH,
    };
  }

  /* ======================= Riel del marco ======================== */

  railPoint(s) {
    const R = this.L.railR,
      P = this.L.perim;
    s = ((s % P) + P) % P;
    if (s < R.w) return { x: R.x + s, y: R.y };
    s -= R.w;
    if (s < R.h) return { x: R.x + R.w, y: R.y + s };
    s -= R.h;
    if (s < R.w) return { x: R.x + R.w - s, y: R.y + R.h };
    s -= R.w;
    return { x: R.x, y: R.y + R.h - s };
  }

  /** Puntos para ir por el riel de s0 a s1 por el camino más corto. */
  railPath(s0, s1) {
    const R = this.L.railR,
      P = this.L.perim;
    const fwd = (s1 - s0 + P) % P;
    const dir = fwd <= P / 2 ? 1 : -1;
    const len = dir > 0 ? fwd : P - fwd;
    const corners = [0, R.w, R.w + R.h, 2 * R.w + R.h];
    const pts = [];
    for (const c of corners) {
      const dc = dir > 0 ? (c - s0 + P) % P : (s0 - c + P) % P;
      if (dc > 0.01 && dc < len) pts.push({ dc, p: this.railPoint(c) });
    }
    pts.sort((a, b) => a.dc - b.dc);
    const out = pts.map((q) => q.p);
    out.push(this.railPoint(s1));
    return out;
  }

  railDist(a, b) {
    const P = this.L.perim;
    const d = Math.abs(a - b) % P;
    return Math.min(d, P - d);
  }

  holeRailS() {
    const R = this.L.railR;
    return R.w + R.h + (R.x + R.w - this.L.hole.x);
  }

  /** Punto del riel por el que se entra a una celda del borde. */
  entryFor(cell) {
    const { cols, rows } = this.data;
    const { cs, bx, by, railR: R } = this.L;
    const r = (cell / cols) | 0,
      c = cell % cols;
    const cx = bx + c * cs + cs / 2,
      cy = by + r * cs + cs / 2;
    const opts = [];
    if (r === rows - 1) opts.push(R.w + R.h + (R.x + R.w - cx));
    if (r === 0) opts.push(cx - R.x);
    if (c === 0) opts.push(2 * R.w + R.h + (R.y + R.h - cy));
    if (c === cols - 1) opts.push(R.w + (cy - R.y));
    const hs = this.holeRailS();
    opts.sort((a, b) => this.railDist(hs, a) - this.railDist(hs, b));
    return opts[0];
  }

  /* ===================== Lógica de la grilla ===================== */

  cellCenter(i) {
    const { cs, bx, by } = this.L;
    const cols = this.data.cols;
    return {
      x: bx + (i % cols) * cs + cs / 2,
      y: by + ((i / cols) | 0) * cs + cs / 2,
    };
  }

  isBoundary(i) {
    const { cols, rows } = this.data;
    const r = (i / cols) | 0,
      c = i % cols;
    return r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
  }

  isExposed(i) {
    if (this.isBoundary(i)) return true;
    const cols = this.data.cols,
      cells = this.cells;
    return (
      cells[i - cols] === EMPTY ||
      cells[i + cols] === EMPTY ||
      cells[i - 1] === EMPTY ||
      cells[i + 1] === EMPTY
    );
  }

  /** Celda expuesta y libre del color indicado, la más cercana al agujero. */
  findTarget(color) {
    const { cols } = this.data;
    const { cs, bx, by, hole } = this.L;
    const cells = this.cells,
      reserved = this.reserved;
    let best = -1,
      bestD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== color || reserved[i] || !this.isExposed(i)) continue;
      const dx = bx + (i % cols) * cs - hole.x;
      const dy = by + ((i / cols) | 0) * cs - hole.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  setTargetColor(color) {
    if (color < 0 || color >= this.data.palette.length) {
      this.targetColor = -1;
      this.cb.onTarget?.(null);
      return;
    }
    this.targetColor = color;
    const paletteColor = this.data.palette[color];
    this.cb.onTarget?.({
      color,
      name: paletteColor.name,
      hex: paletteColor.hex,
      remaining: this.remainingByColor[color],
      reachable: this.findTarget(color) >= 0,
    });
  }

  nextTargetColor() {
    const available = [
      ...this.slots,
      ...this.columns.map((column) => column[0]),
    ].find(
      (jar) =>
        jar &&
        this.remainingByColor[jar.color] > 0 &&
        this.findTarget(jar.color) >= 0,
    );
    if (available) return available.color;
    return this.remainingByColor.findIndex((count) => count > 0);
  }

  /**
   * Camino desde el borde hasta la celda objetivo pasando solo por celdas
   * vacías (BFS). Devuelve [celdaBorde, ..., objetivo] o null.
   */
  pathFromBoundary(target) {
    if (this.isBoundary(target)) return [target];
    const { cols, rows } = this.data;
    const cells = this.cells,
      visit = this.visit,
      parent = this.parent,
      q = this.queue;
    const st = ++this.stamp;
    let h = 0,
      t = 0;
    visit[target] = st;
    parent[target] = -1;
    q[t++] = target;
    while (h < t) {
      const i = q[h++];
      const r = (i / cols) | 0,
        c = i % cols;
      const nb = [
        r > 0 ? i - cols : -1,
        r < rows - 1 ? i + cols : -1,
        c > 0 ? i - 1 : -1,
        c < cols - 1 ? i + 1 : -1,
      ];
      for (const j of nb) {
        if (j < 0 || visit[j] === st || cells[j] !== EMPTY) continue;
        visit[j] = st;
        parent[j] = i;
        if (this.isBoundary(j)) {
          const path = [];
          for (let k = j; k !== -1; k = parent[k]) path.push(k);
          return path;
        }
        q[t++] = j;
      }
    }
    return null;
  }

  /* =========================== Entrada =========================== */

  onPointer(e) {
    if (this.state !== "playing" || !this.L) return;
    e.preventDefault();
    sfx.init();
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top;
    const inside = (R) =>
      x >= R.x && x <= R.x + R.w && y >= R.y && y <= R.y + R.h;

    // Solo se puede devolver un frasco sin ruta si todavía puede empezar a comer.
    for (let i = 0; i < SLOT_COUNT; i++) {
      const jar = this.slots[i];
      if (jar && inside(this.slotRect(i))) {
        if (jar.dispatched === 0 && this.findTarget(jar.color) >= 0) {
          this.slots[i] = null;
          this.columns[jar.col].unshift(jar);
          this.setTargetColor(this.nextTargetColor());
          jar.bounce = 1;
          sfx.playJarTap();
        } else {
          jar.shake = 1;
        }
        return;
      }
    }

    // Tocar el frasco de arriba de una columna de la reserva
    for (let c = 0; c < RESERVE_COLS; c++) {
      const col = this.columns[c];
      if (!col.length || !inside(this.columnRect(c))) continue;
      const free = this.slots.indexOf(null);
      if (free === -1) {
        col[0].shake = 1;
        sfx.playError();
        return;
      }
      const jar = col.shift();
      jar.cool = 0;
      jar.bounce = 1;
      this.slots[free] = jar;
      this.setTargetColor(jar.color);
      this.stuckTimer = 0;
      sfx.playJarTap();
      return;
    }
  }

  /** Modo de prueba (?autoplay): elige un frasco cuyo color tenga píxeles alcanzables. */
  autoStep() {
    if (this.state !== "playing") return;
    const free = this.slots.indexOf(null);
    if (free === -1) return;
    let pick = -1;
    for (let c = 0; c < RESERVE_COLS; c++) {
      const top = this.columns[c][0];
      if (top && this.findTarget(top.color) >= 0) {
        pick = c;
        break;
      }
    }
    if (pick < 0) pick = this.columns.findIndex((col) => col.length > 0);
    if (pick < 0) return;
    const jar = this.columns[pick].shift();
    jar.cool = 0;
    jar.bounce = 1;
    this.slots[free] = jar;
    this.setTargetColor(jar.color);
  }

  /* ========================= Actualización ======================= */

  update(dt) {
    if (!this.data || !this.L) return;

    // Animaciones de frascos
    const anim = (jar) => {
      if (!jar) return;
      if (jar.bounce > 0) jar.bounce = Math.max(0, jar.bounce - dt * 4);
      if (jar.shake > 0) jar.shake = Math.max(0, jar.shake - dt * 3);
    };
    this.slots.forEach(anim);
    this.columns.forEach((col) => anim(col[0]));

    if (this.state === "playing") {
      // Envío de hormigas
      for (let i = 0; i < SLOT_COUNT; i++) {
        const jar = this.slots[i];
        if (!jar || jar.dispatched >= jar.capacity) continue;
        jar.cool -= dt;
        if (jar.cool <= 0 && this.ants.length < MAX_ANTS) {
          jar.cool = SPAWN_INTERVAL;
          this.spawnAnt(i, jar);
        }
      }
    }

    // Hormigas
    for (let k = this.ants.length - 1; k >= 0; k--) {
      const ant = this.ants[k];
      const ev = ant.update(dt);
      if (ev === "bite") this.eat(ant);
      else if (ev === "dead") this.ants.splice(k, 1);
    }

    // Partículas
    for (let k = this.particles.length - 1; k >= 0; k--) {
      if (!this.particles[k].update(dt)) this.particles.splice(k, 1);
    }

    // Frascos terminados
    for (let i = 0; i < SLOT_COUNT; i++) {
      const jar = this.slots[i];
      if (jar && jar.remaining <= 0) {
        this.slots[i] = null;
        const R = this.slotRect(i);
        for (let p = 0; p < 14; p++)
          this.particles.push(
            new Particle(R.x + R.w / 2, R.y + R.h / 2, jar.hex, 14),
          );
        sfx.playJarClear();
      }
    }

    if (this.state === "playing") {
      if (this.eaten >= this.total) {
        this.state = "won";
        this.winTimer = 0.7;
      } else {
        this.checkStuck(dt);
      }
    } else if (this.state === "won" && this.winTimer > 0) {
      this.winTimer -= dt;
      if (this.winTimer <= 0) {
        sfx.playVictory();
        this.cb.onWin?.();
      }
    }
  }

  spawnAnt(slotIdx, jar) {
    const target = this.findTarget(jar.color);
    if (target < 0) {
      if (!jar.blocked) sfx.playError();
      jar.blocked = true;
      return;
    }
    jar.blocked = false;
    const path = this.pathFromBoundary(target);
    if (!path) return;

    this.reserved[target] = 1;
    jar.dispatched++;

    const L = this.L;
    const R = this.slotRect(slotIdx);
    const hs = this.holeRailS();
    const es = this.entryFor(path[0]);
    const entry = this.railPoint(es);
    const inner = path.map((c) => this.cellCenter(c));

    const points = [
      { x: R.x + R.w / 2, y: R.y + 6 },
      { x: L.hole.x, y: L.hole.y },
      this.railPoint(hs),
      ...this.railPath(hs, es),
      ...inner,
    ];
    const returnPoints = [
      ...inner.slice(0, -1).reverse(),
      entry,
      ...this.railPath(es, hs),
      { x: L.hole.x, y: L.hole.y },
    ];

    this.ants.push(
      new Ant({
        points,
        returnPoints,
        jar,
        target,
        colorHex: jar.hex,
        cellSize: L.cs,
        speed: L.antSpeed * (0.92 + Math.random() * 0.16),
      }),
    );
  }

  eat(ant) {
    const t = ant.target;
    const color = this.cells[t];
    if (color === EMPTY) return;
    const hex = this.data.palette[color].hex;
    this.cells[t] = EMPTY;
    this.reserved[t] = 0;
    this.drawCell(t);
    ant.carry = hex;
    ant.jar.remaining--;
    this.eaten++;
    this.remainingByColor[color]--;

    const p = this.cellCenter(t);
    if (this.particles.length < 260) {
      for (let k = 0; k < 3; k++)
        this.particles.push(new Particle(p.x, p.y, hex, this.L.cs));
    }
    sfx.playEatPop((this.eaten % 10) * 18);
    this.cb.onProgress?.(this.eaten, this.total);
    if (color === this.targetColor) {
      if (this.remainingByColor[color] === 0)
        this.setTargetColor(this.nextTargetColor());
      else this.setTargetColor(color);
    } else if (this.targetColor >= 0) {
      this.setTargetColor(this.targetColor);
    }
  }

  /** Derrota: bandeja llena y ningún frasco puede avanzar. */
  checkStuck(dt) {
    this.stuckCheck -= dt;
    if (this.stuckCheck > 0) return;
    this.stuckCheck = 0.25;

    if (this.slots.includes(null)) {
      this.stuckTimer = 0;
      return;
    }
    const busy = this.ants.some((a) => a.phase === "go" || a.phase === "bite");
    const canMove = this.slots.some(
      (j) => j.dispatched < j.capacity && this.findTarget(j.color) >= 0,
    );
    if (busy || canMove) {
      this.stuckTimer = 0;
      return;
    }
    this.stuckTimer += 0.25;
    if (this.stuckTimer >= STUCK_SECONDS) {
      this.state = "lost";
      sfx.playError();
      this.cb.onLose?.();
    }
  }

  /* ============================ Dibujo =========================== */

  redrawBoard() {
    const ctx = this.bctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (let i = 0; i < this.cells.length; i++) this.drawCell(i);
  }

  drawCell(i) {
    const ctx = this.bctx,
      cs = this.L.cs,
      cols = this.data.cols;
    const x = (i % cols) * cs,
      y = ((i / cols) | 0) * cs;
    const line = Math.max(1 / this.dpr, cs * 0.07);
    const v = this.cells[i];
    if (v === EMPTY) {
      ctx.fillStyle = COLORS.emptyCell;
      ctx.fillRect(x, y, cs, cs);
      ctx.fillStyle = "rgba(0,0,0,0.04)";
      ctx.fillRect(x + cs - line, y, line, cs);
      ctx.fillRect(x, y + cs - line, cs, line);
      return;
    }
    ctx.fillStyle = this.data.palette[v].hex;
    ctx.fillRect(x, y, cs, cs);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(x, y, cs, Math.max(line, cs * 0.16));
    ctx.fillStyle = "rgba(0,0,0,0.13)";
    ctx.fillRect(x + cs - line, y, line, cs);
    ctx.fillRect(x, y + cs - line, cs, line);
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this.data || !this.L) return;
    const L = this.L;

    // Marco + riel
    ctx.save();
    ctx.shadowColor = "rgba(120, 70, 30, 0.22)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = COLORS.frame;
    rr(ctx, L.frame.x, L.frame.y, L.frame.w, L.frame.h, 14);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = COLORS.frameEdge;
    ctx.lineWidth = 2;
    rr(ctx, L.frame.x, L.frame.y, L.frame.w, L.frame.h, 14);
    ctx.stroke();
    ctx.fillStyle = COLORS.rail;
    rr(ctx, L.frame.x + 4, L.frame.y + 4, L.frame.w - 8, L.frame.h - 8, 11);
    ctx.fill();

    // Tablero
    ctx.drawImage(this.boardCanvas, L.bx, L.by, L.bw, L.bh);
    this.drawTargetHints(ctx);
    ctx.strokeStyle = "rgba(90, 60, 30, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(L.bx - 0.75, L.by - 0.75, L.bw + 1.5, L.bh + 1.5);

    // Agujero
    const { x: hx, y: hy, r: hr } = L.hole;
    ctx.fillStyle = "#E7C3A2";
    ctx.beginPath();
    ctx.ellipse(hx, hy, hr + 4, (hr + 4) * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(hx, hy - 2, 1, hx, hy, hr);
    g.addColorStop(0, "#3A2416");
    g.addColorStop(1, "#7A4E33");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(hx, hy, hr, hr * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hormigas y partículas
    for (const a of this.ants) a.draw(ctx);
    for (const p of this.particles) p.draw(ctx);

    // Bandeja (5 slots)
    for (let i = 0; i < SLOT_COUNT; i++) {
      const R = this.slotRect(i);
      ctx.fillStyle = "rgba(235, 211, 188, 0.4)"; // Más transparente como fondo
      rr(ctx, R.x, R.y, R.w, R.h, 8);
      ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(180, 150, 120, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      if (this.slots[i]) this.drawBlock(ctx, R, this.slots[i], 1, false);
    }

    // Reserva en grilla
    ctx.fillStyle = "rgba(80, 50, 30, 0.65)";
    ctx.font = "800 10px 'Outfit', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("EN FILA · TOCA EL PRIMERO", this.w / 2, L.reserveY - 12);

    for (let c = 0; c < RESERVE_COLS; c++) {
      const col = this.columns[c];
      const rowHeight = L.slotH + L.gap;
      const visibleRows = Math.max(
        2,
        Math.min(4, Math.floor((this.h - L.reserveY - 18) / rowHeight)),
      );
      const limit = Math.min(col.length, visibleRows);
      for (let k = limit - 1; k >= 0; k--) {
        const R = this.columnRect(c);
        R.y += k * (L.slotH + L.gap);
        const isActive = k === 0;
        this.drawBlock(ctx, R, col[k], isActive ? 1 : 0.88, !isActive, k + 1);
      }
      if (col.length > limit) {
        ctx.fillStyle = "rgba(80, 50, 30, 0.6)";
        ctx.font = "700 11px 'Outfit', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const R = this.columnRect(c);
        ctx.fillText(
          `+${col.length - limit}`,
          R.x + R.w / 2,
          R.y + limit * rowHeight + 2,
        );
      }
    }
  }

  drawTargetHints(ctx) {
    if (this.targetColor < 0) return;
    const { cs, bx, by } = this.L;
    const cols = this.data.cols;
    const pulse = 0.55 + Math.sin(performance.now() / 180) * 0.2;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = "#FFF6A5";
    ctx.lineWidth = Math.max(1, Math.min(2.5, cs * 0.16));
    for (let i = 0; i < this.cells.length; i++) {
      if (
        this.cells[i] !== this.targetColor ||
        this.reserved[i] ||
        !this.isExposed(i)
      )
        continue;
      const x = bx + (i % cols) * cs,
        y = by + ((i / cols) | 0) * cs;
      ctx.strokeRect(x + 0.6, y + 0.6, cs - 1.2, cs - 1.2);
    }
    ctx.restore();
  }

  drawBlock(ctx, R, jar, alpha, isLocked = false, queuePosition = 0) {
    ctx.save();
    ctx.globalAlpha = alpha;
    let { x, y, w, h } = R;
    const b = jar.bounce || 0,
      sh = jar.shake || 0;
    if (sh) x += Math.sin(sh * 30) * 4 * sh;
    if (b) {
      const s = 1 + Math.sin(b * Math.PI) * 0.12;
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(s, 1 / s);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }

    const r = Math.min(10, w * 0.2);
    // Base 3D shadow/depth
    ctx.fillStyle = shade(jar.hex, -0.4);
    rr(ctx, x, y + h * 0.15, w, h * 0.85, r);
    ctx.fill();
    // Top face
    ctx.fillStyle = jar.hex;
    rr(ctx, x, y, w, h * 0.85, r);
    ctx.fill();
    if (!isLocked && jar.color === this.targetColor) {
      ctx.strokeStyle = "#FFF6A5";
      ctx.lineWidth = 2.5;
      rr(ctx, x + 1, y + 1, w - 2, h * 0.85 - 1, Math.max(2, r - 1));
      ctx.stroke();
    }
    if (jar.blocked) {
      ctx.strokeStyle = "#C0392B";
      ctx.lineWidth = 3;
      rr(ctx, x + 1.5, y + 1.5, w - 3, h * 0.85 - 2, Math.max(2, r - 1));
      ctx.stroke();
    }

    // Highlight
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    rr(ctx, x + 2, y + 2, w - 4, h * 0.3, r - 2);
    ctx.fill();

    if (isLocked) {
      const badgeSize = Math.max(12, Math.round(w * 0.27));
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.beginPath();
      ctx.arc(
        x + badgeSize * 0.68,
        y + badgeSize * 0.68,
        badgeSize * 0.58,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = "rgba(59,42,32,0.85)";
      ctx.font = `800 ${Math.round(badgeSize * 0.72)}px 'Outfit', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        String(queuePosition),
        x + badgeSize * 0.68,
        y + badgeSize * 0.68,
      );

      const fsNum = Math.round(w * 0.38);
      ctx.font = `800 ${fsNum}px 'Outfit', sans-serif`;
      ctx.lineWidth = Math.max(2, fsNum * 0.15);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineJoin = "round";
      const ty = y + h * 0.48;
      ctx.strokeText(String(jar.remaining), x + w / 2, ty);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(String(jar.remaining), x + w / 2, ty);
    } else {
      const fs = Math.round(w * 0.45);
      ctx.font = `800 ${fs}px 'Outfit', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(2, fs * 0.15);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineJoin = "round";
      const ty = y + h * 0.42;
      ctx.strokeText(String(jar.remaining), x + w / 2, ty);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(String(jar.remaining), x + w / 2, ty);
    }
    ctx.restore();
  }
}

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
