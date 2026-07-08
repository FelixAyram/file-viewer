let mounted = false;

export function mountDocToolbar() {
  if (mounted) return document.getElementById("doc-toolbar");
  mounted = true;

  const bar = document.createElement("header");
  bar.id = "doc-toolbar";
  bar.className = "doc-toolbar hidden";
  bar.innerHTML = `
    <div class="doc-toolbar-outer">
      <div id="toolbarContainer">
        <div id="toolbarViewer" class="toolbar">
          <div id="toolbarViewerRight" class="toolbarHorizontalGroup">
            <div id="editorInk" class="toolbarButtonWithContainer">
              <button
                id="editorInkButton"
                class="toolbarButton"
                type="button"
                title="Dibujar (D)"
                role="radio"
                aria-expanded="false"
                aria-haspopup="true"
                aria-controls="editorInkParamsToolbar"
              >
                <span>Draw</span>
              </button>
              <div class="editorParamsToolbar hidden doorHangerRight" id="editorInkParamsToolbar">
                <div class="editorParamsToolbarContainer">
                  <p class="editorParamsHint">
                    Líneas, círculos y rectángulos se reconocen al soltar. Mantené el trazo quieto para previsualizar.
                  </p>
                  <div class="editorParamsSetter">
                    <label for="editorInkColor" class="editorParamsLabel">Color</label>
                    <input type="color" id="editorInkColor" class="editorParamsColor" value="#facc15">
                  </div>
                  <div class="editorParamsSetter">
                    <label for="editorInkThickness" class="editorParamsLabel">Thickness</label>
                    <input
                      type="range"
                      id="editorInkThickness"
                      class="editorParamsSlider"
                      value="3"
                      min="1"
                      max="20"
                      step="1"
                    >
                  </div>
                  <div class="editorParamsSetter">
                    <label for="editorInkOpacity" class="editorParamsLabel">Opacity</label>
                    <input
                      type="range"
                      id="editorInkOpacity"
                      class="editorParamsSlider"
                      value="1"
                      min="0.05"
                      max="1"
                      step="0.05"
                    >
                  </div>
                  <div class="editorParamsSetter doc-extra-actions">
                    <button type="button" id="tool-undo" class="toolbarButton" title="Deshacer (Ctrl+Z)">↩</button>
                    <button type="button" id="tool-redo" class="toolbarButton" title="Rehacer (Ctrl+Y)">↪</button>
                    <button type="button" id="tool-clear" class="toolbarButton" title="Borrar todo">🗑</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.prepend(bar);

  const penBtn = bar.querySelector("#editorInkButton");
  const popover = bar.querySelector("#editorInkParamsToolbar");

  document.addEventListener("click", (e) => {
    if (!bar.contains(e.target)) {
      popover.classList.add("hidden");
      penBtn.setAttribute("aria-expanded", "false");
    }
  });

  return bar;
}

export function showDocToolbar() {
  mountDocToolbar().classList.remove("hidden");
  document.body.classList.add("has-doc-toolbar");
}

export function hideDocToolbar() {
  document.getElementById("doc-toolbar")?.classList.add("hidden");
  document.body.classList.remove("has-doc-toolbar");
}
