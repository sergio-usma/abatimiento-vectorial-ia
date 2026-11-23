'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const G = require('../js/grammar.js');
const VT = require('../js/voice-tools.js');
const P = require('../js/voice-prompt.js');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bridge-commands.json'), 'utf8'));
const g = G.create(db);

test('las herramientas de la sesión: report con todos los temas, control y lang en todas', () => {
  const tools = P.buildTools(VT.definitions, { handsFree: false });
  const names = tools.map(t => t.name);
  ['report', 'unclear', 'ignore', 'confirm', 'cancel', 'repeat', 'steer_course', 'set_wind'].forEach(n => assert.ok(names.includes(n), n));
  ['get_status', 'drift_report', 'confirm_action'].forEach(n => assert.ok(!names.includes(n), n + ' no va suelta'));
  assert.equal(new Set(names).size, names.length);
  const rep = tools.find(t => t.name === 'report');
  assert.deepEqual(rep.parameters.properties.topic.enum, Object.keys(P.REPORTS));
  tools.forEach(t => { assert.ok(t.parameters.properties.lang, t.name); assert.ok(t.parameters.required.includes('lang'), t.name); assert.ok(!t.parameters.properties.wake, t.name + ' sin wake en PTT'); });
});

test('manos libres añade wake obligatorio en todas las herramientas', () => {
  P.buildTools(VT.definitions, { handsFree: true }).forEach(t => { assert.ok(t.parameters.properties.wake, t.name); assert.ok(t.parameters.required.includes('wake'), t.name); });
});

test('cada tema de informe apunta a una consulta de la base y viceversa', () => {
  Object.keys(P.REPORTS).forEach(t => { const c = db.commands.find(x => x.id === P.REPORTS[t].id); assert.ok(c && c.kind === 'query', t); });
  db.commands.filter(c => c.kind === 'query').forEach(c => assert.ok(P.TOPIC_BY_ID[c.id], 'consulta sin tema: ' + c.id));
});

test('las instrucciones: secciones, ejemplos reales, estables y de tamaño razonable', () => {
  const a = P.buildInstructions(db, g.parse, { handsFree: false });
  assert.equal(a, P.buildInstructions(db, g.parse, { handsFree: false }), 'texto idéntico entre turnos (caché de prompt)');
  ['# Rol', '# Regla de mando', '# Idioma', '# Audio poco claro', '# Datos', '# Ejemplos (frase -> llamada)', '# Ejemplos que NO son orden'].forEach(s => assert.ok(a.includes(s), s));
  assert.match(a, /SIN preámbulo/);
  ['# Intención', '# Familias de órdenes'].forEach(x => assert.ok(a.includes(x), x));
  assert.match(a, /NUNCA solo porque la frase no está en los ejemplos/);
  assert.match(a, /viento de 45 grados por el 000/);
  assert.ok(!/no está en la lista ENTONCES unclear/i.test(a));
  assert.match(a, /SOLO SI los pide con claridad/);
  assert.match(a, /"Navega con rumbo cero nueve cero" -> steer_course \{"degrees":90\}/);
  assert.match(a, /-> report \{"topic":"weather"\}/);
  assert.match(a, /-> report \{"topic":"leeway"\}/);
  const tools = new Set(P.buildTools(VT.definitions).map(t => t.name));
  a.split('\n').filter(l => /^".*" -> /.test(l)).forEach(l => {
    const call = l.split(' -> ')[1].split(/\s/)[0];
    assert.ok(tools.has(call), `la línea llama a una herramienta que no existe: ${l}`);
  });
  assert.ok(a.length / 3.5 < 7000, 'tokens aprox: ' + Math.round(a.length / 3.5));
  assert.notEqual(a, P.buildInstructions(db, g.parse, { handsFree: true }));
});

test('unclear lleva missing y las herramientas nuevas están en la sesión', () => {
  const tools = P.buildTools(VT.definitions);
  const u = tools.find(t => t.name === 'unclear');
  assert.deepEqual(u.parameters.properties.missing.enum, P.MISSING);
  assert.ok(u.parameters.required.includes('missing'));
  ['speed_order', 'power_percent', 'engine_step', 'engine_pair', 'standby'].forEach(n => assert.ok(tools.some(t => t.name === n), n));
  P.FAMILIES.forEach(f => assert.ok(f.length > 20));
});

test('el prompt distingue timón, cambio de rumbo, así y a la vía', () => {
  const a = P.buildInstructions(db, g.parse, {});
  assert.match(a, /# Distinciones/);
  assert.match(a, /"Estribor 10" -> helm_order \{"order":"starboard","angle":10\}/);
  assert.match(a, /"Cae diez grados a estribor" -> alter_course/);
  assert.match(a, /NUNCA es alter_course/);
  assert.match(a, /HASTA NUEVA ORDEN/);
  const d = Object.fromEntries(VT.definitions.map(x => [x.name, x.description]));
  assert.match(d.alter_course, /NO la uses para "estribor 10"/);
  assert.match(d.helm_order, /GRADOS DE TIMÓN/);
});
