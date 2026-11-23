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

**Cómo funciona (una sola vuelta).** El modelo **oye** el audio y responde solo con una llamada a herramienta (`tool_choice: required`, salida de texto: no habla ni escribe prosa). Esa llamada se valida contra `data/bridge-commands.json`: si la orden no existe en la base, **no se ejecuta** ("Repita."). Si existe, se ejecuta al instante y Marina la repite con una frase fija y breve generada localmente, con la voz del navegador (sin segunda vuelta al modelo; hay una opción para usar la voz natural de OpenAI, más lenta). La transcripción llega en paralelo, solo muestra "Oí: …" y avisa si lo oído era otra orden de la base. Una cifra dicha como número ("rumbo treinta") es `unclear`: los rumbos van por dígitos. Las órdenes de rumbo no cambian las máquinas (la potencia se mantiene hasta que ordenes máquinas) y no desactivan el piloto automático ni sacan de deriva libre: se informa y no se hace nada. La práctica escrita y la guía usan la gramática local (`js/grammar.js`), sin conexión.

**Órdenes fuera de lista.** Además de las frases exactas de la base, `js/intents.js` entiende la intención sin depender del orden de las palabras: busca la familia (viento, corriente, mar, rumbo, caída, timón, máquinas, velocidad, empuje) y los valores con su unidad. "Viento de 45 grados por el 000" se entiende como 45 nudos desde el 000 (un número con "grados" junto a un "por el…" es la intensidad). El modelo también ejecuta una herramienta real aunque la frase no esté en la base; los manejadores validan los rangos y lo crítico pide confirmación. **Marina no dice "Repita" por una frase que no esté en la lista**: si falta un dato lo pregunta ("¿Qué rumbo?", "¿Cuántos grados?") y espera un instante la transcripción para rescatar la orden; "Repita" queda solo para audio ininteligible.

| Familia (SMCP A.918(22) y uso de puente) | Español | English |
|---|---|---|
| Timón | "Meta diez a babor", "Caña a la vía", "Menos caña, diez", "Nada a babor", "Así" | "Port ten", "Ease to ten", "Nothing to port", "Meet her", "Steady as she goes" |
| Rumbo | "Pon proa al cero nueve cero", "Por babor, rumbo uno ocho dos" | "Port, steer one eight two", "Steady on 270" |
| Máquinas | "Ciar poca", "Máquina de babor poca avante, estribor poca atrás", "Atención máquinas", "Fin de maniobra" | "Emergency full astern", "Port engine slow ahead, starboard engine slow astern", "Stand by engines", "Finished with engines" |
| Velocidad | "Mantén seis nudos", "Reduce la velocidad a 4 nudos", "Aumenta velocidad" | "Maintain a speed of 6 knots", "Reduce speed by 1 knot" |
| Empuje | "Empuje cincuenta por ciento", "Potencia 30 por ciento atrás" | "Push 50 percent", "Power 25 percent astern" |

El vocabulario en español sigue el uso marinero estándar; la versión oficial en español de la OMI no estaba disponible, así que conviene que un práctico lo revise (están en `data/bridge-commands.json` y `js/intents.js`).

**Qué significa cada orden (no se confunden).** "Estribor 10" / "Starboard ten" son **grados de timón**: la pala queda a 10° y la proa **cae sin parar** hacia esa banda hasta nueva orden ("Así", "A la vía", otro ángulo o un rumbo). "Cae 10 grados a estribor" es un **cambio de rumbo**: la proa gira 10° y se queda en el rumbo nuevo. "Rumbo 090" va a un rumbo absoluto. **"Así" / "Steady"** frena el giro y mantiene el rumbo al que llegó la proa; **"A la vía" / "Midships"** pone la pala al centro y no fija rumbo. "Menos caña, diez" reduce el timón a 10° en la misma banda; "Nada a babor" evita que la proa vaya más a babor. Si el modelo confunde timón con cambio de rumbo, la gramática exacta corrige con lo que transcribió. **Marina responde siempre en español**, aunque las órdenes sean en inglés.

**Avisos al cumplirse.** Cuando una orden con duración se cumple, Marina lo dice en el idioma de la orden: "Rumbo cero nueve cero alcanzado" / "On course zero nine zero", "Velocidad seis nudos alcanzada" / "Speed six knots reached". Las órdenes instantáneas se repiten con el valor **ya aplicado**, y si el simulador la rechaza (piloto activo, deriva libre) dice la causa.

**Solo habla si se lo pides.** Marina no tiene iniciativa: el modelo nunca habla y la app tampoco. Las alarmas (aguas poco profundas, varada) son **solo tono y pantalla**; lo que sí dice, como respuesta a tus órdenes, son los avisos de cumplimiento. Los informes y sugerencias se dicen únicamente cuando los pides, con frases locales armadas con datos reales del simulador (sin modelo, sin red, sin inventar cifras):

| Informe | Español | English |
|---|---|---|
| Meteo (viento relativo al buque, corriente, mar, marea del simulador) | "Informe meteorológico" | "Weather report" |
| Seguimiento de derrota (punto, distancia, demora, rumbo a gobernar, desvío, llegada) | "Informe de derrota" | "Track report" |
| Abatimiento y deriva (grados y banda) | "Informe de abatimiento", "Informe de deriva" | "Report leeway" |
| Caída de proa y popa | "¿Cómo cae la proa?" | "How is the bow falling?" |
| Profundidad y UKC | "Informe de profundidad" | "Depth report" |
| Velocidad, máquinas y empuje | "Informe de velocidad" | "Speed report" |
| Sugerencia (caída y desvío de derrota; nunca actúa) | "Recomendación" | "What do you recommend?" |
| Todo junto | "Informe completo" | "Full report" |

**Obediencia y latencia.** El prompt (`js/voice-prompt.js`, generado desde la base) sigue la guía de OpenAI para modelos Realtime: rol, regla de mando, idioma, audio poco claro, datos, ejemplos frase → llamada y ejemplos negativos. Hay una sola herramienta `report{topic}` para todos los informes y `wake` solo existe en manos libres. Cada turno es **sin estado**: al terminar la respuesta se borran de la conversación el audio, la llamada y su resultado (`conversation.item.delete`), así la latencia no crece ni el modelo imita órdenes anteriores. Al pasar el cursor por el micrófono (si el permiso ya está concedido) se abre la llamada por adelantado. Para comparar modelos o afinar el prompt sin hablar: en la consola, `await ASDVoice.evalPhrases()` envía cada ejemplo de la base y varias frases que **no** son órdenes, y devuelve aciertos y latencia (no ejecuta nada en el simulador); `ASDVoice.log` guarda lo oído, la herramienta llamada y los ms por turno.

**Ampliar la base.** Cada entrada de `data/bridge-commands.json` tiene `id`, `tool` (herramienta de `js/voice-tools.js`), `args` con huecos tipados (`{heading}`, `{deg}`, `{angle}`, `{kn}`, `{dir}`, `{side}`, `{speed}`), patrones `es` y `en` (expresiones regulares sobre texto normalizado, con `%MACROS%`), la frase `say` que Marina repite y `examples`. `node --test tests/` comprueba que cada ejemplo resuelve a su propia orden, que no hay ambigüedades y que `parse` tarda menos de 5 ms. La Guía de voz del panel se genera de esa misma base.

- **Hablar:** mantén la tecla `V` o el botón del micrófono (cabecera). Suelta para enviar.
- **Manos libres:** actívalo en *Voz e IA*; solo actúa si la frase empieza con "Marina". Apagado por defecto.
- **Escribir:** el campo "Práctica sin voz" y los botones de la **Guía de voz** (panel derecho, último grupo) pasan por la misma gramática, sin micrófono y sin conexión.
- **Mando:** una orden de rumbo o máquinas bloquea los controles manuales. "Control manual" / "Take the con" los devuelve. Sigue la derrota (piloto) las reemplaza.
- **Circuito cerrado:** Marina repite la orden; al llegar al rumbo o a la velocidad ordenados suena un tono y Marina lo avisa. En el panel de puente verás lo que oyó ("Oí: …").

| Tipo | Español | English |
|---|---|---|
| Rumbo | "Navega con rumbo 090", "Así, rumbo 000" | "Steer course 090", "Steady on 000" |
| Cambio de rumbo | "Cae 5 grados a babor / estribor" | "Alter course 5 degrees to port / starboard" |
| Timón | "Diez a babor", "Todo a estribor", "Timón a la vía", "Así" | "Port ten", "Hard to starboard", "Midships", "Steady" |
| Máquinas | "Full avante", "Media avante", "Poca avante", "Muy poca avante", "Para máquinas", "Poca atrás", "Full atrás" | "Full ahead", "Half ahead", "Slow ahead", "Dead slow ahead", "Stop engines", "Slow astern", "Full astern" |
| Viento (siempre *desde*) | "Aumenta viento a 40 nudos por el Este", "Viento por el 045" | "Increase wind to 40 knots from the east" |
| Corriente | "Incrementa corriente 1 nudo por el 003" (*desde* 003), "…hacia el 180" | "Increase current 1 knot from 003" |
| Sistema | "Control manual", "Sigue la derrota", "Informa el estado" | "Take the con", "Follow the route", "Report status" |
| Caída y abatimiento | "¿Cómo cae la proa?", "Informe de abatimiento", "Recomendación" | "How is the bow falling?", "Report leeway" |

**Dinámica de proa y popa al virar.** El buque se integra en ejes propios con las ecuaciones de Kirchhoff (masa añadida de avance y de través, acoplo `u·r` / `v·r` y momento de Munk) y la resistencia lateral del casco se reparte en franjas de proa y popa más una sustentación a popa del centro (la quilla del remolcador). Resultado, con arrancada: el **pivote queda hacia 1/3 de eslora desde la proa**, la proa cae hacia el lado del giro y la popa sale hacia fuera con más velocidad (estribor 100 % y babor 25 % avante → proa a babor, popa a estribor unas 2,3 veces más). El par de los propulsores es una pareja: popa contra el giro y proa hacia el giro (arcos ±L/2 en `ASDForces.lateralEnds`, separados en acción y agua). Los nudos del diagrama son velocidades transversales sobre el fondo. Además, la velocidad del casco es siempre *a través del agua*: la corriente solo se suma para el movimiento sobre el fondo (antes se restaba dos veces en el arrastre).

**Diagrama de fuerzas y velocidad transversal.** El diagrama (botón de vectores en la barra de la carta) se calcula cada frame con *todas* las fuerzas de `calcularFuerzas()`: un **chorro de agua por propulsor** (en su posición real, hacia donde sale el agua: azimut + 180°; el largo es el % de máquinas), el **empuje** (suma vectorial de los dos), el viento, el agua (corriente y oleaje) y la **fuerza neta**. Los cuatro triángulos (amura y aleta de estribor en verde, de babor en rojo) son los *vectores de velocidad transversal* de proa y popa sobre el fondo, `V = v ± r·L/2`, en nudos. Otro botón de la barra muestra u oculta la lista de valores de los vectores. Marina informa de abatimiento, deriva y caída y da una **sugerencia** (nunca actúa), solo si se lo pides. Fórmulas en `js/forces.js`.

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

3. **Clave por defecto (solo temporal).** `js/default-key.js` guarda una clave **ofuscada** (AES-GCM, `js/keybox.js`) que la app usa si no pones ninguna en *Voz e IA* y no hay Worker. Se genera con `ASD_KEY='sk-...' node tools/encrypt-default-key.js` (y `--clear` la quita). **Es ofuscación, no seguridad:** la app debe descifrarla y mandarla a OpenAI, así que cualquiera con las herramientas del navegador (pestaña Red) la obtiene, y OpenAI suele revocar claves publicadas. Úsala solo con una clave temporal y un límite de gasto bajo, y rótala al terminar. Para un despliegue real usa el Worker.

**Si una clave se pegó en un chat, ticket o captura, rótala** en el panel de OpenAI cuando termines las pruebas.

## Despliegue en GitHub Pages

`.github/workflows/pages.yml` ejecuta las pruebas, comprueba que no haya claves en el repositorio y publica solo lo necesario (`index.html`, `js/`, `vendor/`, fuentes, y las imágenes WebP). En *Settings → Pages* elige **GitHub Actions** como fuente.

## Recursos

Procedencia y licencias: `assets/PROVENANCE.md`.
