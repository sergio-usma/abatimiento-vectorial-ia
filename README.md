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

Tú eres el práctico; **Marina** es la timonel y maquinista. Das órdenes normalizadas (IMO SMCP y órdenes estándar de timón y máquinas) en **español o inglés**. Ella ejecuta **exactamente** lo que ordenas, la repite con una frase fija y breve, y no hace nada más: nunca improvisa, no conversa y solo da informes o recomendaciones si se los pides.

**Cómo funciona (una sola vuelta).** El modelo **oye** el audio y responde solo con una llamada a herramienta (`tool_choice: required`, salida de texto: no habla ni escribe prosa). Esa llamada se valida contra `data/bridge-commands.json`: si la orden no existe en la base, **no se ejecuta** ("Repita."). Si existe, se ejecuta al instante y Marina la repite con una frase fija y breve generada localmente, con la voz del navegador (sin segunda vuelta al modelo; hay una opción para usar la voz natural de OpenAI, más lenta). La transcripción llega en paralelo, solo muestra "Oí: …" y avisa si lo oído era otra orden de la base. Una cifra dicha como número ("rumbo treinta") es `unclear`: los rumbos van por dígitos. Las órdenes de rumbo no cambian las máquinas (la potencia se mantiene hasta que ordenes máquinas) y no desactivan el piloto automático ni sacan de deriva libre: se informa y no se hace nada. Sin que se lo pidas, Marina solo habla para una **alarma crítica** (varada, UKC crítico) y para "rumbo alcanzado". La práctica escrita y la guía usan la gramática local (`js/grammar.js`), sin conexión.

**Ampliar la base.** Cada entrada de `data/bridge-commands.json` tiene `id`, `tool` (herramienta de `js/voice-tools.js`), `args` con huecos tipados (`{heading}`, `{deg}`, `{angle}`, `{kn}`, `{dir}`, `{side}`, `{speed}`), patrones `es` y `en` (expresiones regulares sobre texto normalizado, con `%MACROS%`), la frase `say` que Marina repite y `examples`. `node --test tests/` comprueba que cada ejemplo resuelve a su propia orden, que no hay ambigüedades y que `parse` tarda menos de 5 ms. La Guía de voz del panel se genera de esa misma base.

- **Hablar:** mantén la tecla `V` o el botón del micrófono (cabecera). Suelta para enviar.
- **Manos libres:** actívalo en *Voz e IA*; solo actúa si la frase empieza con "Marina". Apagado por defecto.
- **Escribir:** el campo "Práctica sin voz" y los botones de la **Guía de voz** (panel derecho, último grupo) pasan por la misma gramática, sin micrófono y sin conexión.
- **Mando:** una orden de rumbo o máquinas bloquea los controles manuales. "Control manual" / "Take the con" los devuelve. Sigue la derrota (piloto) las reemplaza.
- **Circuito cerrado:** Marina repite la orden y, cuando el HDG llega al rumbo ordenado, informa ("Rumbo cero nueve cero, así"). En el panel de puente verás lo que oyó ("Oí: …").

| Tipo | Español | English |
|---|---|---|
| Rumbo | "Navega con rumbo 090", "Así, rumbo 000" | "Steer course 090", "Steady on 000" |
| Cambio de rumbo | "Cae 5 grados a babor / estribor" | "Alter course 5 degrees to port / starboard" |
| Timón | "Diez a babor", "Todo a estribor", "Timón a la vía", "Así" | "Port ten", "Hard to starboard", "Midships", "Steady" |
| Máquinas | "Full avante", "Media avante", "Poca avante", "Muy poca avante", "Para máquinas", "Poca atrás", "Full atrás" | "Full ahead", "Half ahead", "Slow ahead", "Dead slow ahead", "Stop engines", "Slow astern", "Full astern" |
| Viento (siempre *desde*) | "Aumenta viento a 40 nudos por el Este", "Viento por el 045" | "Increase wind to 40 knots from the east" |
| Corriente | "Incrementa corriente 1 nudo por el 003" (*desde* 003), "…hacia el 180" | "Increase current 1 knot from 003" |
| Sistema | "Control manual", "Sigue la derrota", "Informa el estado" | "Take the con", "Follow the route", "Report status" |
| Deriva y caída | "¿Cómo cae la proa?", "Informe de deriva", "Recomendación" | "How is the bow falling?", "Report drift" |

**Diagrama de fuerzas y velocidad transversal.** El diagrama (botón de vectores en la barra de la carta) se calcula cada frame con *todas* las fuerzas de `calcularFuerzas()`: un **chorro de agua por propulsor** (en su posición real, hacia donde sale el agua: azimut + 180°; el largo es el % de máquinas), el **empuje** (suma vectorial de los dos), el viento, el agua (corriente y oleaje) y la **fuerza neta**. Los cuatro triángulos (amura y aleta de estribor en verde, de babor en rojo) son los *vectores de velocidad transversal* de proa y popa sobre el fondo, `V = v ± r·L/2`, en nudos. Otro botón de la barra muestra u oculta la lista de valores de los vectores. Marina informa de abatimiento, deriva y caída y da una **sugerencia** (nunca actúa). Fórmulas en `js/forces.js`.

Los rumbos se dicen y se leen siempre dígito a dígito: 030 = "cero tres cero", 305 = "tres cero cinco". "A N" fija el valor; "en N" lo incrementa. Reiniciar todo, borrar la derrota y ubicar el buque piden un "confirmo" hablado. Escribir una orden o pulsar una frase de la guía es **práctica sin voz**.

**Rendimiento.** Abre la app con `?perf` para ver fps, ms por frame y el coste del bucle. El bucle principal dibuja primero todos los canvas y después toca el DOM, limita a 20-30 Hz lo que no necesita más, escribe texto solo si cambió y mueve la cámara con un único `panBy` por frame.

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
