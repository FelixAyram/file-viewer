const supportedExtensions = {
  pdfjs: ["pdf"],
  djvujs: ["djvu"],
  foliatejs: ["epub", "fb2", "mobi", "azw3"],
  villainjs: ["cbz", "cbr", "rar", "zip"],
};

function parseUrl(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function displayError(error) {
  const popup = document.getElementById("error-popup");
  const msg = typeof error === "string" ? error : error?.message || String(error);
  popup.classList.add("visible");
  document.getElementById("error-message").textContent = msg;
  console.error("Viewer error:", error);
}

function attachFrameListener() {
  const iframe = document.querySelector(".viewer-frame");
  if (!iframe?.contentWindow) return;
  const { contentWindow } = iframe;
  contentWindow.addEventListener("error", (e) => displayError(e.error?.message || e.message));
  contentWindow.addEventListener("unhandledrejection", (e) => displayError(e.reason?.message || e.reason));
  contentWindow.EventTarget.prototype.addEventListener = new Proxy(
    contentWindow.EventTarget.prototype.addEventListener,
    {
      apply(target, that, args) {
        if (args[0] === "drop") return;
        return Reflect.apply(target, that, args);
      },
    }
  );
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
  document.getElementById("viewer-container").innerHTML = "";
  const root = ReactDOM.createRoot(document.getElementById("viewer-container"));
  root.render(React.createElement(Villain, props));
}

async function loadZip(fileUrl) {
  const blob = await (await fetch(fileUrl)).blob();
  const reader = new zip.ZipReader(new zip.BlobReader(blob));
  let entries = await reader.getEntries();
  entries.sort((a, b) => a.filename.localeCompare(b.filename));
  if (entries.length === 0) {
    displayError("Zip file is empty");
    return;
  }
  if (entries.some((e) => !e.filename.endsWith(".txt"))) {
    loadWithVillain(blob);
    return;
  }

  const container = document.getElementById("viewer-container");
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "zip-text-view";
  wrap.style.cssText = "width:100%;height:100%;overflow:auto;padding:2rem;color:#ddd;background:#111;";
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

export async function loadViewerByUrl(fileUrl, fileType) {
  if (!fileType) {
    const parsedUrl = parseUrl(encodeURI(fileUrl));
    fileType = parsedUrl.split(".").pop()?.toLowerCase();
  }

  const viewerContainer = document.getElementById("viewer-container");
  const dropArea = document.getElementById("drop-area");
  if (dropArea) dropArea.remove();

  function replaceViewerWithFrame(src, id) {
    const iframe = document.createElement("iframe");
    if (id) iframe.id = id;
    iframe.src = src;
    iframe.title = "webviewer";
    iframe.setAttribute("frameborder", "0");
    iframe.className = "viewer-frame w-full h-full";
    viewerContainer.replaceChildren(iframe);
    attachFrameListener();
  }

  const encodedFileUrl = encodeURIComponent(fileUrl);
  location.hash = `file=${encodeURIComponent(fileUrl)}&type=${fileType}`;

  if (supportedExtensions.pdfjs.includes(fileType)) {
    // PDF.js viewer (Mozilla CDN) — ink tools built-in; our overlay adds smooth strokes on top
    replaceViewerWithFrame(
      `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodedFileUrl}`
    );
  } else if (supportedExtensions.djvujs.includes(fileType)) {
    viewerContainer.innerHTML = "";
    const viewer = new DjVu.Viewer();
    viewer.render(viewerContainer);
    viewer.loadDocumentByUrl(fileUrl);
  } else if (supportedExtensions.foliatejs.includes(fileType)) {
    // Foliate reader via Anna's Archive CDN (read-only embed)
    replaceViewerWithFrame(
      `https://annas-archive.gl/foliatejs/reader.html?url=${encodedFileUrl}`,
      "foliate-iframe"
    );
  } else if (supportedExtensions.villainjs.includes(fileType)) {
    if (fileType === "zip") {
      await loadZip(fileUrl);
      return;
    }
    loadWithVillain(fileUrl);
  } else {
    displayError(`File type not supported: .${fileType}`);
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

async function loadDjvuByFile(file) {
  const viewerContainer = document.getElementById("viewer-container");
  document.getElementById("drop-area")?.remove();
  viewerContainer.innerHTML = "";
  const viewer = new DjVu.Viewer();
  const buffer = await getBuffer(file);
  viewer.render(viewerContainer);
  viewer.loadDocument(buffer);
}

window.fileInfoForMonkeyPatchedFetchFile = {};
window.fetchFile = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const fileInfo = window.fileInfoForMonkeyPatchedFetchFile;
  if (url.startsWith("blob:") && "name" in fileInfo && "type" in fileInfo) {
    return new File([await res.blob()], fileInfo.name, { type: fileInfo.type });
  }
  return new File([await res.blob()], new URL(res.url).pathname);
};

export async function handleFileUpload(file, drawLayer) {
  const fileType = file.name.split(".").pop()?.toLowerCase();
  if (supportedExtensions.djvujs.includes(fileType)) {
    await loadDjvuByFile(file);
  } else {
    const fileUrl = URL.createObjectURL(file);
    window.fileInfoForMonkeyPatchedFetchFile = { name: file.name, type: file.type };
    await loadViewerByUrl(fileUrl, fileType);
  }
  drawLayer?.loadPersisted();
}

export function initDropZone(drawLayer) {
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
    if (files.length > 0) await handleFileUpload(files[0], drawLayer);
  });
  dropArea.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    if (fileInput.files.length > 0) {
      await handleFileUpload(fileInput.files[0], drawLayer);
    }
  });
}

window.addEventListener("error", (e) => displayError(e.error?.message || e.message));
window.addEventListener("unhandledrejection", (e) => displayError(e.reason?.message || e.reason));

export { displayError, supportedExtensions };
