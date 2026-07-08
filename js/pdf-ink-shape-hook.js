import { recognizeLineAndCircle, shapeToPoints } from "./stroke-engine.js";

const INK_MODE = 15;

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
    }, 50);
  });
}

function getInkLayer() {
  return document.querySelector(".annotationEditorLayer.inkEditing");
}

function layerPoint(clientX, clientY, layer) {
  const r = layer.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

function pointerEvent(type, layer, point, pointerId) {
  const r = layer.getBoundingClientRect();
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: r.left + point.x,
    clientY: r.top + point.y,
    offsetX: point.x,
    offsetY: point.y,
    pressure: type === "pointerup" ? 0 : 0.5,
  });
}

function replayStroke(layer, points, pointerId) {
  if (!layer || points.length < 2) return;
  layer.dispatchEvent(pointerEvent("pointerdown", layer, points[0], pointerId));
  for (let i = 1; i < points.length - 1; i += 1) {
    layer.dispatchEvent(pointerEvent("pointermove", layer, points[i], pointerId));
  }
  layer.dispatchEvent(pointerEvent("pointerup", layer, points.at(-1), pointerId));
}

async function main() {
  const app = await waitForApp();
  await app.initializedPromise;

  let inkActive = false;
  let tracking = false;
  let points = [];
  let pointerId = 0;

  app.eventBus.on("annotationeditormodechanged", ({ mode }) => {
    inkActive = mode === INK_MODE;
  });

  const root = app.pdfViewer?.viewer;
  if (!root) return;

  root.addEventListener(
    "pointerdown",
    (e) => {
      if (!inkActive || e.button !== 0) return;
      const layer = getInkLayer();
      if (!layer) return;
      tracking = true;
      pointerId = e.pointerId;
      points = [layerPoint(e.clientX, e.clientY, layer)];
    },
    true
  );

  root.addEventListener(
    "pointermove",
    (e) => {
      if (!tracking || e.pointerId !== pointerId) return;
      const layer = getInkLayer();
      if (!layer) return;
      points.push(layerPoint(e.clientX, e.clientY, layer));
    },
    true
  );

  root.addEventListener(
    "pointerup",
    (e) => {
      if (!tracking || e.pointerId !== pointerId) return;
      tracking = false;
      const captured = points.slice();
      const pid = pointerId;
      setTimeout(() => {
        const shape = recognizeLineAndCircle(captured);
        if (!shape) return;
        const uiManager = app.pdfViewer.annotationEditorUIManager;
        const layer = getInkLayer();
        if (!uiManager || !layer) return;
        uiManager.undo();
        replayStroke(layer, shapeToPoints(shape), pid);
      }, 0);
    },
    true
  );
}

main().catch(console.error);
