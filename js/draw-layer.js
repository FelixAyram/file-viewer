import {
  smoothStroke,
  recognizeCircleOrRect,
  shapeToPoints,
} from "./stroke-engine.js";

const STORAGE_KEY = "file-viewer-strokes";

export class DrawLayer {
  constructor(overlayEl, toolbarEl, hintEl) {
    this.overlay = overlayEl;
    this.toolbar = toolbarEl;
    this.hint = hintEl;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.overlay.appendChild(this.canvas);

    this.enabled = false;
    this.smoothing = true;
    this.shapeSnap = true;
    this.color = "#ef4444";
    this.width = 3;
    this.strokes = [];
    this.redoStack = [];

    this.drawing = false;
    this.currentRaw = [];
    this.previewShape = null;
    this.holdTimer = null;
    this.lastMove = { x: 0, y: 0 };
    this.holdStillMs = 450;

    this._bindToolbar();
    this._bindCanvas();
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  _bindToolbar() {
    const penBtn = this.toolbar.querySelector("#tool-pen");
    const smoothToggle = this.toolbar.querySelector("#toggle-smooth");
    const snapToggle = this.toolbar.querySelector("#toggle-snap");
    const colorInput = this.toolbar.querySelector("#stroke-color");
    const widthInput = this.toolbar.querySelector("#stroke-width");
    const undoBtn = this.toolbar.querySelector("#tool-undo");
    const redoBtn = this.toolbar.querySelector("#tool-redo");
    const clearBtn = this.toolbar.querySelector("#tool-clear");

    penBtn.addEventListener("click", () => this.setEnabled(!this.enabled));
    smoothToggle.addEventListener("click", () => {
      this.smoothing = !this.smoothing;
      smoothToggle.classList.toggle("on", this.smoothing);
    });
    snapToggle.addEventListener("click", () => {
      this.shapeSnap = !this.shapeSnap;
      snapToggle.classList.toggle("on", this.shapeSnap);
    });
    colorInput.addEventListener("input", (e) => {
      this.color = e.target.value;
    });
    widthInput.addEventListener("input", (e) => {
      this.width = Number(e.target.value);
    });
    undoBtn.addEventListener("click", () => this.undo());
    redoBtn.addEventListener("click", () => this.redo());
    clearBtn.addEventListener("click", () => this.clear());

    smoothToggle.classList.add("on");
    snapToggle.classList.add("on");
  }

  setEnabled(on) {
    this.enabled = on;
    this.overlay.classList.toggle("active", on);
    this.toolbar.querySelector("#tool-pen").classList.toggle("active", on);
    if (!on) this._cancelHold();
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

      if (this.shapeSnap && this.currentRaw.length > 8) {
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

      let points = this.currentRaw.map(({ x, y }) => ({ x, y }));
      if (points.length < 2) {
        this.currentRaw = [];
        this.previewShape = null;
        this.redraw();
        return;
      }

      let shapeType = null;

      if (this.previewShape) {
        points = shapeToPoints(this.previewShape);
        shapeType = this.previewShape.type;
      } else if (this.shapeSnap) {
        const shape = recognizeCircleOrRect(points);
        if (shape) {
          points = shapeToPoints(shape);
          shapeType = shape.type;
        } else if (this.smoothing) {
          points = smoothStroke(points, { streamline: 0.62, smoothing: 0.65 });
        }
      } else if (this.smoothing) {
        points = smoothStroke(points, { streamline: 0.62, smoothing: 0.65 });
      }

      this.strokes.push({
        points,
        color: this.color,
        width: this.width,
        shape: shapeType,
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
      const shape = recognizeCircleOrRect(raw);
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
      circle: "Círculo detectado — soltá para confirmar",
      rectangle: "Rectángulo detectado — soltá para confirmar",
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
    ctx.globalAlpha = this.previewShape ? 0.55 : 0.9;

    let points;
    if (this.previewShape) {
      points = shapeToPoints(this.previewShape);
    } else {
      points = this.currentRaw.map(({ x, y }) => ({ x, y }));
      if (this.smoothing && points.length > 2) {
        points = smoothStroke(points, { streamline: 0.62, smoothing: 0.65 });
      }
    }

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
