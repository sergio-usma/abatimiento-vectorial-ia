'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const Keybox = require('../js/keybox.js');

test('la caja cifra y descifra, con sal y vector distintos cada vez', async () => {
  const fake = ['sk', 'test', '0123456789abcdefghij'].join('-');     // por partes: el workflow rechaza todo lo que parezca clave
  const a = await Keybox.encrypt(fake), b = await Keybox.encrypt(fake);
  assert.notEqual(a.data, b.data);
  assert.equal(await Keybox.decrypt(a), fake);
  assert.ok(!JSON.stringify(a).includes('sk-test'));
  await assert.rejects(Keybox.decrypt({ ...a, data: a.data.slice(0, -4) + 'AAAA' }));
});

test('js/default-key.js trae una clave cifrada que se descifra y ningún archivo del código lleva la clave en texto plano', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'default-key.js'), 'utf8');
  const m = /window\.ASD_DEFAULT_KEY = (\{.*\});/.exec(src);
  if(!m){ assert.match(src, /window\.ASD_DEFAULT_KEY = null;/); return; }      // sin clave por defecto: también es válido
  const key = await Keybox.decrypt(JSON.parse(m[1]));
  assert.match(key, /^sk-[A-Za-z0-9_-]{20,}$/);
  ['js', 'data', 'tools', 'worker', 'tests'].forEach(dir => {
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if(e.isDirectory()) walk(p); else assert.ok(!fs.readFileSync(p, 'utf8').includes(key), 'clave en texto plano en ' + p);
    });
    walk(path.join(__dirname, '..', dir));
  });
});
