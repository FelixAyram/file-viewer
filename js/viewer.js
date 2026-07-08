import { saveFile } from "./doc-store.js";
import { renderPdf } from "./pdf-viewer.js";
import { renderEbook } from "./ebook-viewer.js";

const supportedExtensions = {
  pdfjs: ["pdf"],
  djvujs: ["djvu"],
  foliatejs: ["epub", "fb2", "mobi", "azw3"],
  villainjs: ["cbz", "cbr", "rar", "zip"],
};

let loadingDepth = 0;

export function showLoading(message = "Procesando documento…") {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  if (loadingDepth === 0) {
    overlay.classList.add("visible");
    overlay.setAttribute("aria-busy", "true");
  }
  loadingDepth += 1;
  setLoadingMessage(message);
}

export function setLoadingMessage(message) {
  const label = document.getElementById("loading-overlay")?.querySelector(".loading-message");
  if (label) label.textContent = message;
}

export function hideLoading() {
  if (loadingDepth <= 0) return;
  loadingDepth -= 1;
  if (loadingDepth > 0) return;
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.classList.remove("visible");
  overlay.setAttribute("aria-busy", "false");
}

async function waitForNextPaint() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function parseUrl(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function extFromName(name) {
  return name?.split(".").pop()?.toLowerCase() || "";
}

function displayError(error) {
  const popup = document.getElementById("error-popup");
  const msg = typeof error === "string" ? error : error?.message || String(error);
  popup.classList.add("visible");
  document.getElementById("error-message").textContent = msg;
  console.error("Viewer error:", error);
}

function clearError() {
  document.getElementById("error-popup")?.classList.remove("visible");
}

function prepareViewer() {
  document.getElementById("drop-area")?.remove();
  return document.getElementById("viewer-container");
}

export function setViewerHash({ doc, file, type, name }) {
  const params = new URLSearchParams();
  if (doc) params.set("doc", doc);
  if (file) params.set("file", file);
  if (type) params.set("type", type);
  if (name) params.set("name", name);
  location.hash = params.toString();
}

export function parseViewerHash() {
  const raw = location.hash.slice(1);
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  return {
    doc: params.get("doc"),
    file: params.get("file"),
    type: params.get("type"),
    name: params.get("name"),
  };
}

async function toFile(source, name, type) {
  if (source instanceof File) return source;
  const blob =
    source instanceof Blob
      ? source
      : await (async () => {
          try {
            const res = await fetch(source);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            return res.blob();
          } catch (err) {
            if (err?.message === "Failed to fetch") {
              throw new Error(
                "No se pudo descargar el archivo remoto. Subilo con arrastrar y soltar."
              );
            }
            throw err;
          }
        })();
  if (!blob) throw new Error("No se pudo leer el archivo");
  return new File([blob], name || "document", { type: type || blob.type });
}

function loadWithVillain(file) {
  const Villain = window.villain;
  const props = {
    source: file,
    style: { width: "100%", height: "100%" },
    options: {
      allowFullScreen: true,
      autoHideControls: false,
    },
    workerUrl: "./vendor/libarchive/worker-bundle.js",
  };
  const container = prepareViewer();
  container.innerHTML = "";
  const root = ReactDOM.createRoot(container);
  root.render(React.createElement(Villain, props));
}

async function loadZip(source) {
  setLoadingMessage("Leyendo archivo comprimido…");
  const blob = source instanceof Blob ? source : await (await fetch(source)).blob();
  const reader = new zip.ZipReader(new zip.BlobReader(blob));
  let entries = await reader.getEntries();
  entries.sort((a, b) => a.filename.localeCompare(b.filename));
  if (entries.length === 0) {
    displayError("Zip file is empty");
    return;
  }
  if (entries.some((e) => !e.filename.endsWith(".txt"))) {
    setLoadingMessage("Preparando visor de cómics…");
    loadWithVillain(blob);
    await waitForNextPaint();
    return;
  }

  setLoadingMessage("Extrayendo texto…");
  const container = prepareViewer();
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "zip-text-view";
  wrap.style.cssText =
    "width:100%;height:100%;overflow:auto;padding:2rem;color:#ddd;background:#111;";
  container.appendChild(wrap);

  for (const entry of entries) {
    const text = await entry.getData(new zip.TextWriter());
    if (!text.trim()) continue;
    const block = document.createElement("pre");
    block.style.whiteSpace = "pre-wrap";
    block.textContent = text;
    wrap.appendChild(block);
    wrap.appendChild(document.createElement("hr"));
  }
}

function getBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function loadDjvu(source) {
  const container = prepareViewer();
  container.innerHTML = "";
  const viewer = new DjVu.Viewer();
  const buffer =
    source instanceof ArrayBuffer
      ? source
      : await getBuffer(await toFile(source, "file.djvu"));
  setLoadingMessage("Renderizando DJVU…");
  viewer.render(container);
  await viewer.loadDocument(buffer);
}

export async function loadDocument(source, fileType, { name } = {}) {
  showLoading("Preparando visor…");
  clearError();
  try {
    if (!fileType && name) fileType = extFromName(name);
    if (!fileType && typeof source === "string") {
      fileType = parseUrl(source).split(".").pop()?.toLowerCase();
    }

    const file =
      source instanceof File || source instanceof ArrayBuffer
        ? source
        : await toFile(source, name || `file.${fileType}`);

    if (supportedExtensions.pdfjs.includes(fileType)) {
      setLoadingMessage("Cargando PDF…");
      await renderPdf(prepareViewer(), file, { onMessage: setLoadingMessage });
    } else if (supportedExtensions.djvujs.includes(fileType)) {
      setLoadingMessage("Cargando DJVU…");
      await loadDjvu(file);
    } else if (supportedExtensions.foliatejs.includes(fileType)) {
      setLoadingMessage("Cargando ebook…");
      const ebookFile = file instanceof File ? file : await toFile(file, name || `file.${fileType}`);
      await renderEbook(prepareViewer(), ebookFile);
    } else if (supportedExtensions.villainjs.includes(fileType)) {
      if (fileType === "zip") {
        await loadZip(file);
        return;
      }
      setLoadingMessage("Preparando visor de cómics…");
      loadWithVillain(file);
      await waitForNextPaint();
    } else {
      displayError(`File type not supported: .${fileType}`);
    }
  } catch (error) {
    displayError(error);
    throw error;
  } finally {
    hideLoading();
  }
}

export async function loadViewerByUrl(fileUrl, fileType) {
  if (!fileType) {
    fileType = parseUrl(encodeURI(fileUrl)).split(".").pop()?.toLowerCase();
  }
  setViewerHash({ file: fileUrl, type: fileType });
  await loadDocument(fileUrl, fileType, {
    name: parseUrl(fileUrl).split("/").pop(),
  });
}

export async function handleFileUpload(file) {
  try {
    const fileType = extFromName(file.name);
    const docId = await saveFile(file);
    setViewerHash({ doc: docId, type: fileType, name: file.name });
    await loadDocument(file, fileType, { name: file.name });
  } catch (error) {
    displayError(error);
  }
}

export function initDropZone() {
  const dropArea = document.getElementById("drop-area");
  const fileInput = document.getElementById("file-upload");

  dropArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropArea.classList.add("drag-over");
  });
  dropArea.addEventListener("dragleave", () => dropArea.classList.remove("drag-over"));
  dropArea.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropArea.classList.remove("drag-over");
    const files = e.dataTransfer.files;
    if (files.length > 1) {
      displayError("Please upload only one file.");
      return;
    }
    if (files.length > 0) await handleFileUpload(files[0]);
  });
  dropArea.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    if (fileInput.files.length > 0) {
      await handleFileUpload(fileInput.files[0]);
    }
  });
}

window.addEventListener("error", (e) => {
  hideLoading();
  displayError(e.error?.message || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  hideLoading();
  displayError(e.reason?.message || e.reason);
});

export { displayError, supportedExtensions };
