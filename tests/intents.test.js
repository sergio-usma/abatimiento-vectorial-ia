'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const G = require('../js/grammar.js');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bridge-commands.json'), 'utf8'));
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'orders-corpus.json'), 'utf8'));
const g = G.create(db);

test('corpus de órdenes (SMCP, marineras, variantes y errores de unidad): cada frase da la llamada esperada', () => {
  const bad = [];
  corpus.forEach(c => {
    const p = g.parse(c.t);
    if(c.status){
      if(p.status !== c.status || (c.missing && p.missing !== c.missing)) bad.push(`${c.t} -> ${p.status}/${p.missing || ''}, esperaba ${c.status}/${c.missing || ''}`);
      return;
    }
    if(p.status !== 'ok'){ bad.push(`${c.t} -> ${p.status} (${p.normalized || ''})`); return; }
    if(p.tool !== c.tool){ bad.push(`${c.t} -> herramienta ${p.tool}, esperaba ${c.tool}`); return; }
    const a = p.args || {};
    Object.keys(c.args).forEach(k => { if(a[k] !== c.args[k]) bad.push(`${c.t} -> ${k}=${JSON.stringify(a[k])}, esperaba ${JSON.stringify(c.args[k])} (args ${JSON.stringify(a)})`); });
  });
  assert.deepEqual(bad, [], '\n' + bad.join('\n'));
  assert.ok(corpus.length >= 100, 'corpus: ' + corpus.length);
});

test('charla y preguntas no se confunden con órdenes (el analizador flexible no inventa)', () => {
  ['¿qué hora es?', 'hola, ¿me escuchas?', 'el viento está fuerte hoy', '¿cómo está el mar?', 'vamos bien', 'gracias', 'what a nice day', 'puerto a la vista',
   'qué opinas de la corriente', 'esto está difícil', 'speed is important', 'the weather is nice'].forEach(t => {
    const p = g.parse(t);
    assert.notEqual(p.status, 'ok', `"${t}" -> ${p.tool} ${JSON.stringify(p.args)}`);
  });
});

test('repetición de lo ejecutado: valor ya aplicado, es y en, sin "Repita" ni "así"', () => {
  const say = (t, res) => g.speak(g.parse(t), res || { status: 'ok' }).text;
  assert.equal(say('viento de 45 grados por el 000'), 'Viento 45 nudos por el cero cero cero.');
  assert.equal(say('wind from 270 at 30 knots'), 'Wind 30 knots from two seven zero.');
  assert.equal(say('aumenta el viento en 5 nudos', { status: 'ok', knots: 17 }), 'Viento, 5 nudos más.');   // frase de la base
  assert.equal(say('pon proa al cero nueve cero'), 'Rumbo cero nueve cero.');
  assert.equal(say('máquina de babor poca avante, estribor poca atrás'), 'Babor poca avante, estribor poca atrás.');
  assert.equal(say('port engine slow ahead starboard engine slow astern'), 'Port slow ahead, starboard slow astern.');
  assert.equal(say('stop the port engine'), 'Port engine stopped.');
  assert.equal(say('mantén seis nudos'), 'Velocidad 6 nudos.');
  assert.equal(say('push 50 percent'), 'Power 50 percent ahead.');
  assert.equal(say('stand by engines'), 'Engines ready.');
  assert.equal(say('nada a babor', { status: 'ok', no_change: true }), 'Nada a babor.');
  assert.equal(say('rumbo'), '¿Qué rumbo?');
  assert.equal(say('cae a babor'), '¿Cuántos grados?');
  assert.equal(say('rumbo treinta'), 'Rumbo por dígitos.');
  const warn = g.speak(g.parse('viento norte 25 nudos'), { status: 'ok', note_code: 'sim_paused' }).text;
  assert.match(warn, /Simulación en pausa\.$/);
  ['viento de 45 grados por el 000', 'reduce speed', 'ease to ten'].forEach(t => assert.ok(!/repita|say again|así/i.test(say(t, { status: 'ok', engine_order: 'Slow ahead', helm_angle: -10 })), t));
});
