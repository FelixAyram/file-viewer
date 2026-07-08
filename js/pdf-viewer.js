async function toBlob(source) {
  if (source instanceof Blob) return source;
  if (source instanceof ArrayBuffer) return new Blob([source], { type: "application/pdf" });
  const res = await fetch(source);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.blob();
}

function hidePdfJsEditors(iframe) {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    const style = doc.createElement("style");
    style.textContent = `
      #editorModeButtons,
      #editorModeSeparator,
      #editorUndoBar { display: none !important; }
    `;
    doc.head.appendChild(style);
  } catch (_) {}
}

export async function renderPdf(container, source, { onMessage } = {}) {
  container.innerHTML = "";
  container.classList.add("pdf-shell");

  let fileUrl;
  if (typeof source === "string") {
    fileUrl = source;
  } else {
    fileUrl = URL.createObjectURL(await toBlob(source));
  }

  const iframe = document.createElement("iframe");
  iframe.className = "pdfjs-viewer-frame";
  iframe.title = "PDF";
  iframe.src = `./vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(fileUrl)}`;
  container.appendChild(iframe);

  onMessage?.("Cargando visor PDF…");
  await new Promise((resolve, reject) => {
    iframe.addEventListener("load", () => resolve(), { once: true });
    iframe.addEventListener("error", () => reject(new Error("No se pudo cargar el visor PDF")), {
      once: true,
    });
  });

  hidePdfJsEditors(iframe);
  iframe.addEventListener("load", () => hidePdfJsEditors(iframe));

  return iframe;
}
