/**
 * Hormigas comedoras y partículas.
 * El tamaño de la hormiga es relativo a la celda: ~2,5 celdas de largo y
 * ~1,5 de ancho (como en el juego de referencia). Cada hormiga se lleva
 * UNA celda.
 */

export function shade(hex, amt) {
  const v = parseInt(hex.slice(1), 16);
  let r = (v >> 16) & 255,
    g = (v >> 8) & 255,
    b = v & 255;
  if (amt < 0) {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  } else {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export class Particle {
  constructor(x, y, color, size) {
    this.x = x;
    this.y = y;
    this.color = color;
    const a = Math.random() * Math.PI * 2;
    const sp = 30 + Math.random() * 70;
    this.vx = Math.cos(a) * sp;
    this.vy = Math.sin(a) * sp - 40;
    this.life = 1;
    this.size = size * (0.25 + Math.random() * 0.25);
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 260 * dt;
    this.life -= dt * 2.4;
    return this.life > 0;
  }

  draw(ctx) {
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.fillRect(
      this.x - this.size / 2,
      this.y - this.size / 2,
      this.size,
      this.size,
    );
    ctx.globalAlpha = 1;
  }
}

export class Ant {
  /**
   * @param {{points:{x:number,y:number}[], returnPoints:{x:number,y:number}[], jar:object,
   *          target:number, colorHex:string, cellSize:number, speed:number}} o
   */
  constructor(o) {
    this.points = o.points;
    this.returnPoints = o.returnPoints;
    this.jar = o.jar;
    this.target = o.target;
    this.colorHex = o.colorHex;
    this.cs = o.cellSize;
    this.speed = o.speed;
    this.len = Math.max(14, o.cellSize * 2.5);
    this.wid = Math.max(8.5, o.cellSize * 1.5);
    this.fill = o.colorHex;
    this.outline = shade(o.colorHex, -0.45);
    this.light = shade(o.colorHex, 0.35);

    this.x = this.points[0].x;
    this.y = this.points[0].y;
    this.idx = 1;
    this.angle = -Math.PI / 2;
    this.phase = "go"; // go -> bite -> back -> fade -> dead
    this.timer = 0;
    this.alpha = 0;
    this.scale = 0.4;
    this.walk = Math.random() * 6;
    this.carry = null; // color de la celda que lleva
  }

  /** @returns {'bite'|'dead'|null} evento */
  update(dt) {
    this.walk += dt * 22;
    if (this.alpha < 1 && this.phase !== "fade")
      this.alpha = Math.min(1, this.alpha + dt * 5);
    if (this.scale < 1) this.scale = Math.min(1, this.scale + dt * 4);

    if (this.phase === "go" || this.phase === "back") {
      if (this.moveAlong(dt)) {
        if (this.phase === "go") {
          this.phase = "bite";
          this.timer = 0.09;
        } else {
          this.phase = "fade";
          this.timer = 0.25;
        }
      }
      return null;
    }

    if (this.phase === "bite") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "back";
        this.points = this.returnPoints;
        this.idx = 0;
        return "bite";
      }
      return null;
    }

    if (this.phase === "fade") {
      this.timer -= dt;
      this.alpha = Math.max(0, this.timer / 0.25);
      this.scale = 0.6 + 0.4 * this.alpha;
      if (this.timer <= 0) {
        this.phase = "dead";
        return "dead";
      }
    }
    return null;
  }

  moveAlong(dt) {
    let step = this.speed * dt;
    while (step > 0) {
      const t = this.points[this.idx];
      if (!t) return true;
      const dx = t.x - this.x,
        dy = t.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01) {
        const target = Math.atan2(dy, dx);
        let diff = target - this.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.angle += diff * Math.min(1, dt * 18);
      }
      if (d <= step) {
        this.x = t.x;
        this.y = t.y;
        step -= d;
        this.idx++;
      } else {
        this.x += (dx / d) * step;
        this.y += (dy / d) * step;
        step = 0;
      }
    }
    return this.idx >= this.points.length;
  }

  draw(ctx) {
    const L = this.len * this.scale,
      W = this.wid * this.scale;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const lw = Math.max(0.8, W * 0.08);
    const moving = this.phase === "go" || this.phase === "back";
    const swing = moving ? Math.sin(this.walk) : 0;
    const chew = this.phase === "bite" ? Math.sin(this.walk * 3) * W * 0.06 : 0;

    // Patitas (3 pares)
    ctx.strokeStyle = this.outline;
    ctx.lineWidth = lw * 1.1;
    ctx.lineCap = "round";
    const legX = [-0.12, 0.02, 0.14];
    for (let k = 0; k < 3; k++) {
      const s = (k % 2 === 0 ? swing : -swing) * L * 0.07;
      const x0 = legX[k] * L;
      ctx.beginPath();
      ctx.moveTo(x0, -W * 0.15);
      ctx.lineTo(x0 + s - L * 0.03, -W * 0.62);
      ctx.moveTo(x0, W * 0.15);
      ctx.lineTo(x0 - s - L * 0.03, W * 0.62);
      ctx.stroke();
    }

    ctx.lineWidth = lw;
    ctx.strokeStyle = this.outline;

    // Abdomen (grande, atrás)
    ctx.fillStyle = this.fill;
    ctx.beginPath();
    ctx.ellipse(-L * 0.22, 0, L * 0.25, W * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.light;
    ctx.beginPath();
    ctx.ellipse(-L * 0.26, -W * 0.18, L * 0.1, W * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tórax
    ctx.fillStyle = this.fill;
    ctx.beginPath();
    ctx.ellipse(L * 0.04, 0, L * 0.1, W * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Cabeza
    const hx = L * 0.24 + chew;
    ctx.beginPath();
    ctx.arc(hx, 0, W * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Antenas
    ctx.beginPath();
    ctx.moveTo(hx + W * 0.15, -W * 0.2);
    ctx.quadraticCurveTo(hx + W * 0.35, -W * 0.55, hx + W * 0.62, -W * 0.48);
    ctx.moveTo(hx + W * 0.15, W * 0.2);
    ctx.quadraticCurveTo(hx + W * 0.35, W * 0.55, hx + W * 0.62, W * 0.48);
    ctx.stroke();

    // Ojos grandes
    for (const sgn of [-1, 1]) {
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(hx + W * 0.12, sgn * W * 0.15, W * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1B1B1B";
      ctx.beginPath();
      ctx.arc(hx + W * 0.17, sgn * W * 0.15, W * 0.075, 0, Math.PI * 2);
      ctx.fill();
    }

    // Celda que lleva cargada (delante de la cabeza)
    if (this.carry) {
      const s = this.cs * this.scale;
      const cx = hx + W * 0.42;
      ctx.fillStyle = this.carry;
      ctx.fillRect(cx, -s / 2, s, s);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = Math.max(0.6, s * 0.1);
      ctx.strokeRect(cx, -s / 2, s, s);
    }

    ctx.restore();
  }
}
