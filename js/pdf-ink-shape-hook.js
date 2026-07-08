/**
 * Shape-assist for PDF.js Draw (editorInk).
 * Captures pointer events in ink mode (tldraw/Excalidraw pattern) and snaps strokes to line/circle.
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
    const ready = () => window.PDFViewerApplication?.initialized;
    if (ready()) {
      resolve(window.PDFViewerApplication);
      return;
    }
    const timer = setInterval(() => {
      if (ready()) {
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
      box-shadow: 0 4px 14px rgba(0,0,0,0.2);
    }
    .shape-assist-hint.visible { display: block; }
    body.shape-assist-on .annotationEditorLayer {
      pointer-events: none !important;
    }
    body.shape-assist-on #viewerContainer {
      cursor: crosshair;
    }
  `;
  document.head.appendChild(style);
}

function getInkStyle() {
  const color = document.getElementById("editorInkColor")?.value || "#000000";
  const thickness = Number(document.getElementById("editorInkThickness")?.value || 1);
  const opacity = Number(document.getElementById("editorInkOpacity")?.value || 1);
  return { color, width: Math.max(1.5, thickness * 2.4), opacity };
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

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

class ShapeAssistLayer {
  constructor(container, app) {
    this.container = container;
    this.app = app;
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
    this._docW = 0;
    this._docH = 0;
    this._onCaptureDown = this._onCaptureDown.bind(this);
    this._onCaptureMove = this._onCaptureMove.bind(this);
    this._onCaptureUp = this._onCaptureUp.bind(this);
    this._bind();
    this._resize();
    this._load();
  }

  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    document.body.classList.toggle("shape-assist-on", on);
    if (on) {
      window.addEventListener("pointerdown", this._onCaptureDown, true);
      window.addEventListener("pointermove", this._onCaptureMove, true);
      window.addEventListener("pointerup", this._onCaptureUp, true);
      window.addEventListener("pointercancel", this._onCaptureUp, true);
    } else {
      window.removeEventListener("pointerdown", this._onCaptureDown, true);
      window.removeEventListener("pointermove", this._onCaptureMove, true);
      window.removeEventListener("pointerup", this._onCaptureUp, true);
      window.removeEventListener("pointercancel", this._onCaptureUp, true);
      this._cancelHold();
      this.preview = null;
      this.drawing = false;
      this.hint.classList.remove("visible");
    }
  }

  _inViewer(e) {
    const vc = this.container;
    if (!vc?.contains(e.target)) return false;
    if (e.target.closest?.("#toolbarContainer, #secondaryToolbar, .editorParamsToolbar")) return false;
    return true;
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
    const viewer = document.getElementById("viewer");
    const w = Math.max(
      this.container.scrollWidth,
      this.container.clientWidth,
      viewer?.scrollWidth || 0,
    );
    const h = Math.max(
      this.container.scrollHeight,
      this.container.clientHeight,
      viewer?.scrollHeight || 0,
    );
    this._docW = w;
    this._docH = h;
    this.canvas.width = Math.ceil(w * dpr);
    this.canvas.height = Math.ceil(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.container.appendChild(this.canvas);
    this.redraw();
  }

  _bind() {
    this.container.addEventListener("scroll", () => this._resize(), { passive: true });
    window.addEventListener("resize", () => this._resize());

    const viewer = document.getElementById("viewer");
    if (viewer && "ResizeObserver" in window) {
      new ResizeObserver(() => this._resize()).observe(viewer);
    }

    const bus = this.app.eventBus;
    for (const ev of ["pagesloaded", "scalechanging", "scalechanged", "pagerendered"]) {
      bus.on(ev, () => this._resize());
    }
  }

  _onCaptureDown(e) {
    if (!this.enabled || e.button !== 0 || !this._inViewer(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.drawing = true;
    this.raw = [this._docPoint(e)];
    this.preview = null;
    this.hint.classList.remove("visible");
    this._cancelHold();
    this._drawLive();
  }

  _onCaptureMove(e) {
    if (!this.drawing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const p = this._docPoint(e);
    this.raw.push(p);
    this.lastMove = p;
    this._cancelHold();
    if (this.raw.length > 8) this._scheduleHold();
    this._drawLive();
  }

  _onCaptureUp(e) {
    if (!this.drawing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this._cancelHold();
    this.drawing = false;

    const pts = this.raw.map((p) => ({ ...p }));
    if (pts.length < 2) {
      this.raw = [];
      this.preview = null;
      this.redraw();
      return;
    }

    const shape = this.preview ?? recognizeLineAndCircle(pts);
    const style = getInkStyle();
    const points = shape ? shapeToPoints(shape) : smoothStroke(pts, { streamline: 0.48 });

    this.strokes.push({ points, ...style });
    this.raw = [];
    this.preview = null;
    this.hint.classList.remove("visible");
    this.redraw();
    this._save();
  }

  _scheduleHold() {
    this._cancelHold();
    const n = this.raw.length;
    this.holdTimer = setTimeout(() => {
      if (!this.drawing || this.raw.length !== n) return;
      const tail = this.raw.slice(-5);
      const still = tail.every((p) => distance(p, this.lastMove) < 6);
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
    }, 380);
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
    ctx.globalAlpha = this.preview ? style.opacity * 0.55 : style.opacity * 0.88;

    let points;
    if (this.preview) {
      points = shapeToPoints(this.preview);
    } else {
      points = this.raw.length > 2 ? smoothStroke(this.raw, { streamline: 0.48 }) : this.raw;
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
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    ctx.restore();
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

async function main() {
  injectStyles();
  const app = await waitForApp();
  await app.initializedPromise;

  const container = document.getElementById("viewerContainer");
  if (!container) return;

  const layer = new ShapeAssistLayer(container, app);

  const sync = () => layer.setEnabled(isInkMode(app));
  app.eventBus.on("annotationeditormodechanged", sync);
  document.getElementById("editorInkButton")?.addEventListener("click", () => {
    setTimeout(sync, 0);
    setTimeout(sync, 120);
  });
  setInterval(sync, 400);
  sync();
}

main().catch(console.error);
