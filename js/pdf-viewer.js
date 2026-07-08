async function toBlob(source) {
  if (source instanceof Blob) return source;
  if (source instanceof ArrayBuffer) return new Blob([source], { type: "application/pdf" });
  const res = await fetch(source);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.blob();
}

function injectInkShapeHook(iframe) {
  try {
    const doc = iframe.contentDocument;
    if (!doc || doc.getElementById("ink-shape-hook")) return;
    const script = doc.createElement("script");
    script.id = "ink-shape-hook";
    script.type = "module";
    const base = new URL(".", iframe.src);
    script.src = new URL("../../../js/pdf-ink-shape-hook.js", base).href;
    doc.head.appendChild(script);
  } catch (err) {
    console.warn("shape-assist inject failed", err);
  }
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
  iframe.className = "pdfjs-viewer-frame viewer-frame";
  iframe.title = "PDF";
  iframe.setAttribute("frameborder", "0");
  iframe.src = `./vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(fileUrl)}`;
  container.appendChild(iframe);

  onMessage?.("Cargando visor PDF…");
  await new Promise((resolve, reject) => {
    iframe.addEventListener("load", () => resolve(), { once: true });
    iframe.addEventListener("error", () => reject(new Error("No se pudo cargar el visor PDF")), {
      once: true,
    });
  });

  injectInkShapeHook(iframe);
  try {
    await iframe.contentWindow?.PDFViewerApplication?.initializedPromise;
    injectInkShapeHook(iframe);
  } catch (_) {}

  return iframe;
}
