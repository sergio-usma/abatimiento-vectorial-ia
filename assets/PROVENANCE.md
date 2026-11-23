# Procedencia de recursos

| Archivo | Origen | Proceso |
|---|---|---|
| `map/z17-single.webp` | `map/z17-single.png` (5937 × 8160 px, RGBA, georreferenciado con `.pngw`, `.prj`, `.tab`) | Convertido con Pillow 13.0 (`Image.save(..., "WEBP", quality=80, method=6)`). Sin remuestreo: mismas dimensiones, mismos límites geográficos. 17.4 MB → 3.4 MB. |
| `controles/control.webp` | `controles/control.png` (2048 × 2048 px, RGBA) | Reducido a 640 × 640 px (LANCZOS) y guardado como WebP calidad 88 con Pillow 13.0. 3.5 MB → 27 KB. |
| `assets/fonts/*.woff2` | Google Fonts: Manrope (variable) y DM Mono 400/500, subconjuntos latin y latin-ext | Descargados con `impeccable font-fetch`. Licencia SIL OFL 1.1. |
| `vendor/leaflet.*` | Leaflet 1.9.4 (unpkg) | Copia sin modificar. Licencia BSD-2-Clause. |
| `vendor/chart.umd.min.js` | Chart.js 4.4.0 (jsDelivr) | Copia sin modificar. Licencia MIT. |
| `vendor/matter.min.js` | Matter.js 0.20.0 (cdnjs) | Copia sin modificar. Licencia MIT. |

**Pendiente de confirmar por el equipo:** la fuente y la licencia de la carta náutica original (`z17-single.png`) y de la imagen de la rueda (`control.png`). El repositorio no las documenta; no se asumieron.

Los PNG originales se conservan junto a las versiones WebP.
