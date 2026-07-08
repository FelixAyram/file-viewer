import "../vendor/foliate-js/view.js";

export async function renderEbook(container, file) {
  container.innerHTML = "";
  container.classList.add("ebook-shell");

  const view = document.createElement("foliate-view");
  view.className = "foliate-reader";
  container.appendChild(view);
  await view.open(file);
}
