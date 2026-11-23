# ASD Bridge Simulator

Simulador de puente para remolcadores con doble propulsor azimutal (ASD) sobre la carta de la bahía de Cartagena. SPA estática: no necesita servidor ni paso de build.

## Ejecutar en local

El micrófono solo funciona en `https://` o `localhost` (no en `file://`):

```bash
python -m http.server 8000
# abre http://localhost:8000
```

## Sonido

Todo se sintetiza con Web Audio (sin archivos ni librerías): clics de interfaz, estados, alarmas de UKC y encallamiento, guiado, y ambiente continuo (motor de cada propulsor, viento y oleaje). Botón del altavoz en la cabecera: volumen general y silencio por grupo. Las preferencias se guardan en el navegador.

## Control por voz: órdenes de puente (OpenAI Realtime)

Tú eres el práctico; **Marina** es la timonel y maquinista. Das órdenes normalizadas (IMO SMCP y órdenes estándar de timón) en **español o inglés** y ella las repite y las ejecuta. No manejas los azimutales: el simulador los resuelve con la lógica interna de los controles.

- **Hablar:** mantén la tecla `V` o el botón del micrófono (cabecera). Suelta para enviar.
- **Manos libres:** actívalo en *Voz e IA*; solo actúa si la frase empieza con "Marina". Apagado por defecto.
- **Escribir:** el campo "Escribir orden" y los botones de la **Guía de voz** (panel derecho, último grupo) envían la frase sin micrófono.
- **Mando:** una orden de rumbo o máquinas bloquea los controles manuales. "Control manual" / "Take the con" los devuelve. Sigue la derrota (piloto) las reemplaza.
- **Circuito cerrado:** Marina repite la orden y, cuando el HDG llega al rumbo ordenado, informa ("Rumbo cero nueve cero, así").

| Tipo | Español | English |
|---|---|---|
| Rumbo | "Navega con rumbo 090", "Así, rumbo 000" | "Steer course 090", "Steady on 000" |
| Cambio de rumbo | "Cae 5 grados a babor / estribor" | "Alter course 5 degrees to port / starboard" |
| Timón | "Diez a babor", "Todo a estribor", "Timón a la vía", "Así" | "Port ten", "Hard to starboard", "Midships", "Steady" |
| Máquinas | "Full avante", "Media avante", "Poca avante", "Muy poca avante", "Para máquinas", "Poca atrás", "Full atrás" | "Full ahead", "Half ahead", "Slow ahead", "Dead slow ahead", "Stop engines", "Slow astern", "Full astern" |
| Viento (siempre *desde*) | "Aumenta viento a 40 nudos por el Este", "Viento por el 045" | "Increase wind to 40 knots from the east" |
| Corriente | "Incrementa corriente 1 nudo por el 003" (*desde* 003), "…hacia el 180" | "Increase current 1 knot from 003" |
| Sistema | "Control manual", "Sigue la derrota", "Informa el estado" | "Take the con", "Follow the route", "Report status" |

Los rumbos son de tres dígitos ("cero cero cinco"). "A N" fija el valor; "en N" lo incrementa. Reiniciar todo, borrar la derrota y ubicar el buque piden un "confirmo" hablado (o los botones Sí/No en pantalla).

Las herramientas están en `js/voice-tools.js`, la lógica de gobierno en `js/orders.js` (tabla `TELEGRAPH` y ganancias ajustables) y se prueban con `node --test tests/`.

### Claves: léelo antes de publicar

En un sitio estático **cualquier clave incluida en el código, en un secreto de build o en un archivo del repositorio queda pública**. Por eso hay dos modos:

1. **Pruebas:** pega tu clave en *Voz e IA → Clave de OpenAI* (se guarda solo en la pestaña, `sessionStorage`), o ponla en `js/config.local.js` (ignorado por git y solo cargado en `localhost`):
   ```js
   window.ASD_CONFIG = Object.assign(window.ASD_CONFIG || {}, { openaiKey: 'sk-...' });
   ```
   La app usa tu clave solo para pedir una clave efímera a OpenAI.
2. **Producción (GitHub Pages):** despliega el Worker de `worker/` y pon su URL en `js/config.js`:
   ```bash
   cd worker
   # edita ALLOWED_ORIGINS en wrangler.toml con el origen de tu Pages
   npx wrangler secret put OPENAI_API_KEY
   npx wrangler deploy
   ```
   ```js
   // js/config.js
   tokenEndpoint: 'https://asd-realtime-token.TU-CUENTA.workers.dev'
   ```
   El Worker solo acepta peticiones desde tu origen y entrega claves que caducan en ~60 s. Pon además un límite de gasto en el proyecto de OpenAI.

**Si una clave se pegó en un chat, ticket o captura, rótala** en el panel de OpenAI cuando termines las pruebas.

## Despliegue en GitHub Pages

`.github/workflows/pages.yml` ejecuta las pruebas, comprueba que no haya claves en el repositorio y publica solo lo necesario (`index.html`, `js/`, `vendor/`, fuentes, y las imágenes WebP). En *Settings → Pages* elige **GitHub Actions** como fuente.

## Recursos

Procedencia y licencias: `assets/PROVENANCE.md`.
