import { DrawLayer } from "./draw-layer.js";
import { initDropZone, loadViewerByUrl } from "./viewer.js";

const drawLayer = new DrawLayer(
  document.getElementById("draw-overlay"),
  document.getElementById("draw-toolbar"),
  document.getElementById("shape-preview-hint")
);

initDropZone(drawLayer);

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.key === "d" || e.key === "D") drawLayer.setEnabled(!drawLayer.enabled);
  if (e.ctrlKey && e.key === "z") { e.preventDefault(); drawLayer.undo(); }
  if (e.ctrlKey && e.key === "y") { e.preventDefault(); drawLayer.redo(); }
});

// ?file= URL param support
const params = new URLSearchParams(location.search);
const fileParam = params.get("file");
const typeParam = params.get("type");
if (fileParam) {
  loadViewerByUrl(decodeURIComponent(fileParam), typeParam?.toLowerCase()).then(() => {
    drawLayer.loadPersisted();
  });
}

drawLayer.loadPersisted();
