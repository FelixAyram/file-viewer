import {
  smoothStroke,
  recognizeShape,
  shapeToPoints,
} from "./stroke-engine.js";

const STORAGE_KEY = "file-viewer-strokes";

export class DrawLayer {
  constructor(overlayEl, hintEl) {
    this.overlay = overlayEl;
    this.hint = hintEl;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.overlay.appendChild(this.canvas);

    this.toolbar = null;
    this.enabled = false;
    this.strokes = [];
    this.redoStack = [];

    this.drawing = false;
    this.currentRaw = [];
    this.previewShape = null;
    this.holdTimer = null;
    this.lastMove = { x: 0, y: 0 };
    this.holdStillMs = 450;

    this.color = "#facc15";
    this.width = 3;
    this.opacity = 1;

    this._bindCanvas();
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  bindToolbar(toolbarEl) {
    this.toolbar = toolbarEl;
    this._bindToolbar();
  }

  _bindToolbar() {
    if (!this.toolbar) return;

    const penBtn = this.toolbar.querySelector("#editorInkButton");
    const popover = this.toolbar.querySelector("#editorInkParamsToolbar");
    const colorInput = this.toolbar.querySelector("#editorInkColor");
    const widthInput = this.toolbar.querySelector("#editorInkThickness");
    const opacityInput = this.toolbar.querySelector("#editorInkOpacity");
    const undoBtn = this.toolbar.querySelector("#tool-undo");
    const redoBtn = this.toolbar.querySelector("#tool-redo");
    const clearBtn = this.toolbar.querySelector("#tool-clear");

    penBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setEnabled(!this.enabled);
    });

    popover.addEventListener("click", (e) => e.stopPropagation());

    colorInput.addEventListener("input", (e) => {
      this.color = e.target.value;
    });
    widthInput.addEventListener("input", (e) => {
      this.width = Number(e.target.value);
    });
    opacityInput.addEventListener("input", (e) => {
      this.opacity = Number(e.target.value);
    });
    undoBtn.addEventListener("click", () => this.undo());
    redoBtn.addEventListener("click", () => this.redo());
    clearBtn.addEventListener("click", () => this.clear());
  }

  setEnabled(on) {
    this.enabled = on;
    this.overlay.classList.toggle("active", on);
    const penBtn = this.toolbar?.querySelector("#editorInkButton");
    const popover = this.toolbar?.querySelector("#editorInkParamsToolbar");
    penBtn?.classList.toggle("toggled", on);
    if (on) {
      popover?.classList.remove("hidden");
      penBtn?.setAttribute("aria-expanded", "true");
    } else {
      popover?.classList.add("hidden");
      penBtn?.setAttribute("aria-expanded", "false");
      this._cancelHold();
    }
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  _finalizeStroke(rawPoints) {
    if (rawPoints.length > 2) {
      return smoothStroke(rawPoints, { streamline: 0.62, smoothing: 0.65 });
    }
    return rawPoints;
  }

  _bindCanvas() {
    const onDown = (e) => {
      if (!this.enabled || e.button !== 0) return;
      e.preventDefault();
      this.overlay.setPointerCapture(e.pointerId);
      this.drawing = true;
      this.currentRaw = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
      this.previewShape = null;
      this._hideHint();
      this._cancelHold();
    };

    const onMove = (e) => {
      if (!this.drawing) return;
      const pt = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.currentRaw.push(pt);
      this.lastMove = pt;
      this._cancelHold();

      if (this.currentRaw.length > 8) {
        this._scheduleHoldCheck();
      }

      this._drawLive();
    };

    const onUp = (e) => {
      if (!this.drawing) return;
      this._cancelHold();
      this.drawing = false;
      try {
        this.overlay.releasePointerCapture(e.pointerId);
      } catch (_) {}

      const raw = this.currentRaw.map(({ x, y }) => ({ x, y }));
      if (raw.length < 2) {
        this.currentRaw = [];
        this.previewShape = null;
        this.redraw();
        return;
      }

      const shape = this.previewShape ?? recognizeShape(raw);
      const points = shape ? shapeToPoints(shape) : this._finalizeStroke(raw);

      this.strokes.push({
        points,
        color: this.color,
        width: this.width,
        opacity: this.opacity,
        shape: shape?.type ?? null,
      });
      this.redoStack = [];
      this.currentRaw = [];
      this.previewShape = null;
      this._hideHint();
      this.redraw();
      this._persist();
    };

    this.overlay.addEventListener("pointerdown", onDown);
    this.overlay.addEventListener("pointermove", onMove);
    this.overlay.addEventListener("pointerup", onUp);
    this.overlay.addEventListener("pointercancel", onUp);
  }

  _scheduleHoldCheck() {
    this._cancelHold();
    const snapshot = this.currentRaw.length;
    this.holdTimer = setTimeout(() => {
      if (!this.drawing || this.currentRaw.length !== snapshot) return;
      const tail = this.currentRaw.slice(-4);
      const still = tail.every(
        (p) => Math.hypot(p.x - this.lastMove.x, p.y - this.lastMove.y) < 4
      );
      if (!still) return;
      const raw = this.currentRaw.map(({ x, y }) => ({ x, y }));
      const shape = recognizeShape(raw);
      if (shape) {
        this.previewShape = shape;
        this._showHint(shape.type);
        this._drawLive();
      }
    }, this.holdStillMs);
  }

  _cancelHold() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  _showHint(type) {
    const labels = {
      line: "Línea — soltá para confirmar",
      circle: "Círculo — soltá para confirmar",
      ellipse: "Elipse — soltá para confirmar",
      rectangle: "Rectángulo — soltá para confirmar",
    };
    this.hint.textContent = labels[type] || "Forma detectada — soltá para confirmar";
    this.hint.classList.add("visible");
  }

  _hideHint() {
    this.hint.classList.remove("visible");
  }

  _drawLive() {
    this.redraw();
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.width;
    ctx.globalAlpha = this.previewShape ? this.opacity * 0.55 : this.opacity * 0.9;

    const raw = this.currentRaw.map(({ x, y }) => ({ x, y }));
    const points = this.previewShape
      ? shapeToPoints(this.previewShape)
      : raw.length > 2
        ? smoothStroke(raw, { streamline: 0.62, smoothing: 0.65 })
        : raw;

    this._strokePath(ctx, points);
    ctx.restore();
  }

  _strokePath(ctx, points) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
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
      ctx.globalAlpha = s.opacity ?? 1;
      this._strokePath(ctx, s.points);
      ctx.restore();
    }
  }

  undo() {
    if (!this.strokes.length) return;
    this.redoStack.push(this.strokes.pop());
    this.redraw();
    this._persist();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.strokes.push(this.redoStack.pop());
    this.redraw();
    this._persist();
  }

  clear() {
    this.strokes = [];
    this.redoStack = [];
    this.redraw();
    this._persist();
  }

  _docKey() {
    return location.hash || "default";
  }

  _persist() {
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      all[this._docKey()] = this.strokes;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  loadPersisted() {
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      this.strokes = all[this._docKey()] || [];
      this.redraw();
    } catch (_) {}
  }
}
