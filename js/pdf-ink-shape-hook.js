/**
 * Shape-assist layer for PDF.js Draw tool (editorInk).
 * Intercepts ink mode and draws on a scroll-synced canvas with line/circle snap.
 * Approach: Excalidraw-style RDP + overlay (tldraw/Nebo pattern).
 */
import {
  recognizeLineAndCircle,
  shapeToPoints,
  smoothStroke,
} from "./stroke-engine.js";

const INK_MODE = 15;
const STORAGE_KEY = "pdf-shape-assist-strokes";

function waitForApp() {
  return new Promise((resolve) => {
    if (window.PDFViewerApplication?.initialized) {
      resolve(window.PDFViewerApplication);
      return;
    }
    const timer = setInterval(() => {
      if (window.PDFViewerApplication?.initialized) {
        clearInterval(timer);
        resolve(window.PDFViewerApplication);
      }
    }, 40);
  });
}

function injectStyles() {
  if (document.getElementById("shape-assist-style")) return;
  const style = document.createElement("style");
  style.id = "shape-assist-style";
  style.textContent = `
    #viewerContainer { position: relative !important; }
    .shape-assist-canvas {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 100001;
      pointer-events: none;
    }
    .shape-assist-canvas.active { pointer-events: auto; cursor: crosshair; }
    .shape-assist-hint {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 5000;
      padding: 8px 14px;
      border-radius: 8px;
      background: rgba(22, 163, 74, 0.94);
      color: #fff;
      font: 13px system-ui, sans-serif;
      display: none;
      pointer-events: none;
    }
    .shape-assist-hint.visible { display: block; }
    body.shape-assist-on .annotationEditorLayer.inkEditing {
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

function getInkStyle() {
  const color = document.getElementById("editorInkColor")?.value || "#000000";
  const thickness = Number(document.getElementById("editorInkThickness")?.value || 1);
  const opacity = Number(document.getElementById("editorInkOpacity")?.value || 1);
  return { color, width: Math.max(1, thickness * 2.2), opacity };
}

class ShapeAssistLayer {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "shape-assist-canvas";
    this.hint = document.createElement("div");
    this.hint.className = "shape-assist-hint";
    this.hint.textContent = "Forma detectada — soltá para confirmar";
    container.appendChild(this.canvas);
    document.body.appendChild(this.hint);
    this.ctx = this.canvas.getContext("2d");
    this.strokes = [];
    this.enabled = false;
    this.drawing = false;
    this.raw = [];
    this.preview = null;
    this.holdTimer = null;
    this.lastMove = { x: 0, y: 0 };
    this._bind();
    this._resize();
    this._load();
  }

  setEnabled(on) {
    this.enabled = on;
    this.canvas.classList.toggle("active", on);
    document.body.classList.toggle("shape-assist-on", on);
    if (!on) {
      this._cancelHold();
      this.preview = null;
      this.hint.classList.remove("visible");
    }
  }

  _docPoint(e) {
    const r = this.container.getBoundingClientRect();
    return {
      x: e.clientX - r.left + this.container.scrollLeft,
      y: e.clientY - r.top + this.container.scrollTop,
    };
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(this.container.scrollWidth, this.container.clientWidth);
    const h = Math.max(this.container.scrollHeight, this.container.clientHeight);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  _bind() {
    const onDown = (e) => {
      if (!this.enabled || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.canvas.setPointerCapture(e.pointerId);
      this.drawing = true;
      this.raw = [this._docPoint(e)];
      this.preview = null;
      this.hint.classList.remove("visible");
      this._cancelHold();
    };

    const onMove = (e) => {
      if (!this.drawing) return;
      const p = this._docPoint(e);
      this.raw.push(p);
      this.lastMove = p;
      this._cancelHold();
      if (this.raw.length > 10) this._scheduleHold();
      this._drawLive();
    };

    const onUp = (e) => {
      if (!this.drawing) return;
      this._cancelHold();
      this.drawing = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}

      const pts = this.raw.map((p) => ({ ...p }));
      if (pts.length < 2) {
        this.raw = [];
        this.preview = null;
        this.redraw();
        return;
      }

      const shape = this.preview ?? recognizeLineAndCircle(pts);
      const style = getInkStyle();
      const points = shape ? shapeToPoints(shape) : smoothStroke(pts, { streamline: 0.5 });

      this.strokes.push({ points, ...style });
      this.raw = [];
      this.preview = null;
      this.hint.classList.remove("visible");
      this.redraw();
      this._save();
    };

    this.canvas.addEventListener("pointerdown", onDown);
    this.canvas.addEventListener("pointermove", onMove);
    this.canvas.addEventListener("pointerup", onUp);
    this.canvas.addEventListener("pointercancel", onUp);
    this.container.addEventListener("scroll", () => this._resize(), { passive: true });
    window.addEventListener("resize", () => this._resize());
  }

  _scheduleHold() {
    this._cancelHold();
    const n = this.raw.length;
    this.holdTimer = setTimeout(() => {
      if (!this.drawing || this.raw.length !== n) return;
      const tail = this.raw.slice(-4);
      const still = tail.every((p) => distance(p, this.lastMove) < 5);
      if (!still) return;
      const shape = recognizeLineAndCircle(this.raw);
      if (shape) {
        this.preview = shape;
        this.hint.textContent =
          shape.type === "line"
            ? "Línea detectada — soltá para confirmar"
            : "Círculo detectado — soltá para confirmar";
        this.hint.classList.add("visible");
        this._drawLive();
      }
    }, 420);
  }

  _cancelHold() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  _drawLive() {
    this.redraw();
    const style = getInkStyle();
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.globalAlpha = this.preview ? style.opacity * 0.55 : style.opacity * 0.85;

    let points;
    if (this.preview) {
      points = shapeToPoints(this.preview);
    } else {
      points = this.raw.length > 2 ? smoothStroke(this.raw, { streamline: 0.5 }) : this.raw;
    }
    this._stroke(ctx, points);
    ctx.restore();
  }

  _stroke(ctx, points) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  redraw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.strokes) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.globalAlpha = s.opacity;
      this._stroke(ctx, s.points);
      ctx.restore();
    }
  }

  _save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.strokes));
    } catch (_) {}
  }

  _load() {
    try {
      this.strokes = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
      this.redraw();
    } catch (_) {}
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isInkMode(app) {
  const btn = document.getElementById("editorInkButton");
  if (btn?.classList.contains("toggled")) return true;
  try {
    return app.pdfViewer?.annotationEditorMode === INK_MODE;
  } catch (_) {
    return false;
  }
}

async function main() {
  injectStyles();
  const app = await waitForApp();
  await app.initializedPromise;

  const container = document.getElementById("viewerContainer");
  if (!container) return;

  const layer = new ShapeAssistLayer(container);

  const sync = () => layer.setEnabled(isInkMode(app));
  app.eventBus.on("annotationeditormodechanged", sync);
  document.getElementById("editorInkButton")?.addEventListener("click", () => {
    setTimeout(sync, 0);
  });
  setInterval(sync, 350);
  sync();
}

main().catch(console.error);
