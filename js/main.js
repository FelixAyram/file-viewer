import { DrawLayer } from "./draw-layer.js";
import { initDropZone, loadViewerByUrl, loadDocument, parseViewerHash } from "./viewer.js";
import { loadFile } from "./doc-store.js";
import { mountDocToolbar } from "./doc-toolbar.js";

const drawLayer = new DrawLayer(
  document.getElementById("draw-overlay"),
  document.getElementById("shape-preview-hint")
);
drawLayer.bindToolbar(mountDocToolbar());
initDropZone(drawLayer);

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.key === "d" || e.key === "D") drawLayer.setEnabled(!drawLayer.enabled);
  if (e.ctrlKey && e.key === "z") {
    e.preventDefault();
    drawLayer.undo();
  }
  if (e.ctrlKey && e.key === "y") {
    e.preventDefault();
    drawLayer.redo();
  }
});

async function restoreFromLocation() {
  const params = new URLSearchParams(location.search);
  const fileParam = params.get("file");
  const typeParam = params.get("type");
  if (fileParam) {
    await loadViewerByUrl(decodeURIComponent(fileParam), typeParam?.toLowerCase());
    return true;
  }

  const hash = parseViewerHash();
  if (hash?.doc) {
    const file = await loadFile(hash.doc);
    if (file) {
      await loadDocument(file, hash.type || file.name.split(".").pop(), {
        name: hash.name || file.name,
      });
      return true;
    }
  }
  if (hash?.file) {
    await loadViewerByUrl(decodeURIComponent(hash.file), hash.type?.toLowerCase());
    return true;
  }
  return false;
}

restoreFromLocation()
  .then(() => drawLayer.loadPersisted())
  .catch(() => drawLayer.loadPersisted());
