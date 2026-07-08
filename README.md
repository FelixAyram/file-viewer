# File Viewer

Visor web inspirado en [Anna's Archive /view](https://annas-archive.gl/view), desplegable en GitHub Pages.

## Formatos soportados

| Formato | Motor |
|---------|-------|
| PDF | PDF.js (Mozilla) |
| EPUB, FB2, MOBI, AZW3 | Foliate (embed) |
| DJVU | DjVu.js |
| CBZ, CBR, RAR, ZIP | Villain.js |

## Dibujo con suavizado

- **Dibujar** (`D`): capa de anotación sobre cualquier visor
- **Suavizado**: Catmull-Rom + streamline — corrige trazos erráticos del mouse
- **Formas**: dibujá un trazo y **mantené el click quieto** ~0,5 s para convertir a línea, círculo, elipse o rectángulo (estilo iPad)
- Deshacer / rehacer, color y grosor configurables
- Los trazos se guardan en `localStorage` por documento

## Uso local

Abrí `index.html` con un servidor estático (los módulos ES requieren HTTP):

```powershell
cd file-viewer
npx --yes serve .
```

## GitHub Pages

El sitio se publica desde la rama `main` en la carpeta raíz.

Demo: `https://felixayram.github.io/file-viewer/`

## Créditos

- Visor base: [Anna's Archive](https://annas-archive.gl/) (código abierto)
- [Villain.js](https://github.com/btzr-io/Villain) — cómics
- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF
- [DjVu.js](https://github.com/rcombs/djvu.js)
