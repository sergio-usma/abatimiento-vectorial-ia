/* Configuración pública de la app. Este archivo SÍ se versiona: nunca pongas aquí una clave.
 *
 * Para pruebas locales crea js/config.local.js (ignorado por git) y sobrescribe lo que necesites:
 *   window.ASD_CONFIG = Object.assign(window.ASD_CONFIG || {}, { openaiKey: '...' });
 *
 * Para producción (GitHub Pages) NO uses clave en el navegador: despliega worker/realtime-token.js
 * y apunta tokenEndpoint a su URL. El Worker guarda la clave real y entrega claves efímeras.
 */
window.ASD_CONFIG = {
  model: 'gpt-realtime',          // alternativa más económica: 'gpt-realtime-mini'
  voice: 'marin',                 // voz de mujer; respaldo: 'shimmer' o 'sage'
  transcriptionModel: 'gpt-4o-mini-transcribe',
  tokenEndpoint: null,            // p. ej. 'https://asd-realtime-token.TU-CUENTA.workers.dev'
  openaiKey: null                 // solo para pruebas locales vía config.local.js
};
