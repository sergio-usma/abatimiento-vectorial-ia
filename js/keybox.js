/* ASD Bridge Simulator: caja de clave OFUSCADA (AES-GCM con WebCrypto).
 *
 * Sirve para que la clave por defecto no aparezca como texto en el repositorio ni en el código fuente publicado.
 * ADVERTENCIA: esto es OFUSCACIÓN, no seguridad. La app tiene que descifrar la clave para usarla y la envía en la cabecera
 * Authorization, así que cualquiera con las herramientas del navegador (pestaña Red / consola) puede obtenerla. Úsala solo con una
 * clave temporal y con límite de gasto. Para producción real, usa el Worker de worker/realtime-token.js (claves efímeras).
 *
 * Módulo sin DOM: navegador (`window.ASDKeybox`) y Node (`tools/encrypt-default-key.js`, `node --test tests/`).
 */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.ASDKeybox = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  const PASS = 'asd-bridge-simulator/default-key/v1';       // constante pública: la caja solo evita el texto plano, no es un secreto
  const ITER = 100000;
  const te = new TextEncoder(), td = new TextDecoder();
  const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle) || (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle);

  const b64 = u8 => { let s = ''; u8.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));

  async function derive(salt, usage){
    const km = await subtle().importKey('raw', te.encode(PASS), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, usage);
  }

  async function encrypt(plain){
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derive(salt, ['encrypt']);
    const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, te.encode(plain)));
    return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) };
  }

  async function decrypt(box){
    if(!box || box.v !== 1) throw new Error('Caja de clave no válida');
    const key = await derive(unb64(box.salt), ['decrypt']);
    return td.decode(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data)));
  }

  return { encrypt, decrypt };
});
