#!/usr/bin/env node
/* Genera js/default-key.js con la clave por defecto OFUSCADA (ver js/keybox.js: no es seguridad real).
 *
 *   ASD_KEY='sk-...' node tools/encrypt-default-key.js        # cifra y escribe js/default-key.js
 *   node tools/encrypt-default-key.js --clear                  # deja la app sin clave por defecto
 *
 * La clave se lee del entorno para que no quede en el historial del repositorio ni en ningún archivo en texto plano.
 */
'use strict';
const fs = require('fs'), path = require('path');
const Keybox = require('../js/keybox.js');
const out = path.join(__dirname, '..', 'js', 'default-key.js');

(async () => {
  if(process.argv.includes('--clear')){
    fs.writeFileSync(out, '/* Sin clave por defecto. Genera una con: ASD_KEY=... node tools/encrypt-default-key.js */\nwindow.ASD_DEFAULT_KEY = null;\n');
    console.log('Clave por defecto eliminada.'); return;
  }
  const key = (process.env.ASD_KEY || '').trim();
  if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)){ console.error('Define ASD_KEY con una clave de OpenAI (sk-...).'); process.exit(1); }
  const box = await Keybox.encrypt(key);
  if(await Keybox.decrypt(box) !== key){ console.error('La verificación del cifrado falló.'); process.exit(1); }
  fs.writeFileSync(out, '/* Clave por defecto OFUSCADA (AES-GCM, js/keybox.js). No es seguridad: cualquiera con las herramientas del navegador puede obtenerla.\n' +
    '   Es temporal: rótala y limita el gasto del proyecto en OpenAI. Regenerar: ASD_KEY=... node tools/encrypt-default-key.js */\n' +
    'window.ASD_DEFAULT_KEY = ' + JSON.stringify(box) + ';\n');
  console.log('Escrito js/default-key.js (' + box.data.length + ' caracteres cifrados).');
})();
