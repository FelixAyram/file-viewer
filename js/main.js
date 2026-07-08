import { initDropZone, loadViewerByUrl, loadDocument, parseViewerHash } from "./viewer.js";
import { loadFile } from "./doc-store.js";

initDropZone();

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

restoreFromLocation().catch(() => {});
