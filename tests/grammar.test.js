'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const G = require('../js/grammar.js');
const O = require('../js/orders.js');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bridge-commands.json'), 'utf8'));
const g = G.create(db);

test('cada ejemplo de la base se resuelve a su propia orden (ES y EN)', () => {
  let n = 0;
  db.commands.forEach(c => ['es', 'en'].forEach(lang => (c.examples[lang] || []).forEach(t => {
    const r = g.parse(t); n++;
    assert.equal(r.status, 'ok', `"${t}" (${c.id}/${lang}) -> ${r.status} ${r.normalized || ''}`);
    assert.equal(r.id, c.id, `"${t}" resolvió ${r.id}, esperaba ${c.id}`);
    assert.equal(r.lang, lang, `"${t}" idioma ${r.lang}`);
  })));
  assert.ok(n >= 100, 'ejemplos: ' + n);
});

test('números hablados a cifras, con marca para los dichos como palabra', () => {
  assert.equal(G.normalize('cero nueve cero'), '090');
  assert.equal(G.normalize('zero niner zero'), '090');
  assert.equal(G.normalize('0 9 0'), '090');
  assert.equal(G.normalize('treinta y cinco'), '#35');
  assert.equal(G.normalize('twenty five'), '#25');
  assert.equal(G.normalize('cero punto cinco'), '0.5');
  assert.equal(G.normalize('Rumbo 090°'), 'rumbo 090');
});

test('rumbos: por dígito; una cifra dicha como número se rechaza', () => {
  const r = g.parse('Navega con rumbo cero tres cero');
  assert.equal(r.tool, 'steer_course'); assert.deepEqual(r.args, { degrees: 30 });
  assert.equal(g.parse('rumbo 000').args.degrees, 0);
  assert.equal(g.parse('Steer course three five nine').args.degrees, 359);
  assert.equal(g.parse('rumbo treinta').status, 'digits_required');
  assert.equal(g.parse('steer course ninety').status, 'digits_required');
  assert.equal(g.parse('rumbo cuatro cero cero').status, 'bad_range');
  assert.match(g.speak(g.parse('rumbo treinta')).text, /dígitos/);
});

test('timón y caídas: banda y grados, ES y EN', () => {
  assert.deepEqual(g.parse('Diez a babor').args, { order: 'port', angle: 10 });
  assert.deepEqual(g.parse('Port ten').args, { order: 'port', angle: 10 });
  assert.deepEqual(g.parse('Starboard twenty five').args, { order: 'starboard', angle: 25 });
  assert.deepEqual(g.parse('Todo a estribor').args, { order: 'hard_starboard' });
  assert.deepEqual(g.parse('Hard to port').args, { order: 'hard_port' });
  assert.equal(g.parse('Timón a la vía').args.order, 'midships');
  assert.equal(g.parse('Así').args.order, 'steady');
  assert.deepEqual(g.parse('Cae 5 grados a babor').args, { side: 'port', degrees: 5 });
  assert.deepEqual(g.parse('Alter course ten degrees to starboard').args, { side: 'starboard', degrees: 10 });
  assert.equal(g.parse('Port forty').status, 'bad_range');
});

test('telégrafo de máquinas: las nueve posiciones y alto general', () => {
  const m = { 'Full avante': 'full_ahead', 'Media avante': 'half_ahead', 'Poca avante': 'slow_ahead', 'Muy poca avante': 'dead_slow_ahead', 'Para máquinas': 'stop',
              'Muy poca atrás': 'dead_slow_astern', 'Poca atrás': 'slow_astern', 'Media atrás': 'half_astern', 'Full atrás': 'full_astern',
              'Full ahead': 'full_ahead', 'Half ahead': 'half_ahead', 'Slow ahead': 'slow_ahead', 'Dead slow ahead': 'dead_slow_ahead', 'Stop engines': 'stop',
              'Dead slow astern': 'dead_slow_astern', 'Slow astern': 'slow_astern', 'Half astern': 'half_astern', 'Full astern': 'full_astern' };
  Object.keys(m).forEach(t => { const r = g.parse(t); assert.equal(r.tool, 'engine_order', t); assert.equal(r.args.order, m[t], t); });
  assert.equal(g.parse('Alto general').tool, 'all_stop');
});

test('viento y corriente: desde, hacia, absoluto y delta con el signo correcto', () => {
  assert.deepEqual(g.parse('Aumenta viento a 40 nudos por el Este').args, { knots: 40, from_deg: 90 });
  assert.deepEqual(g.parse('Viento por el cero cuatro cinco, 25 nudos').args, { from_deg: 45, knots: 25 });
  assert.deepEqual(g.parse('Increase wind to forty knots from the east').args, { knots: 40, from_deg: 90 });
  assert.deepEqual(g.parse('Aumenta el viento en 5 nudos').args, { delta_knots: 5 });
  assert.deepEqual(g.parse('Baja el viento 3 nudos').args, { delta_knots: -3 });
  assert.deepEqual(g.parse('Incrementa corriente en 0.5 por el cero cero tres').args, { delta_knots: 0.5, from_deg: 3 });
  assert.deepEqual(g.parse('Corriente hacia el uno ocho cero').args, { toward_deg: 180 });
  assert.deepEqual(g.parse('Corriente de un nudo hacia el 180').args, { knots: 1, toward_deg: 180 });
  assert.deepEqual(g.parse('Current setting 180').args, { toward_deg: 180 });
  assert.equal(g.parse('Corriente ligada al viento').args.linked_to_wind, true);
  assert.deepEqual(g.parse('Mar de un metro').args, { hs_m: 1 });
});

test('mando, simulación, derrota y vista', () => {
  assert.equal(g.parse('Control manual').tool, 'manual_control');
  assert.equal(g.parse('Take the con').tool, 'manual_control');
  assert.deepEqual(g.parse('Sigue la derrota').args, { on: true });
  assert.deepEqual(g.parse('Desactiva el piloto automático').args, { on: false });
  assert.equal(g.parse('Reinicia la simulación').confirm, true);
  assert.equal(g.parse('Borra la derrota').confirm, true);
  assert.deepEqual(g.parse('Velocidad 15').args, { speed: 15 });
  assert.deepEqual(g.parse('Oculta la lista de vectores').args, { vectors: false });
  assert.deepEqual(g.parse('Muestra el diagrama de fuerzas').args, { forces: true });
  assert.deepEqual(g.parse('Centra el buque').args, { follow: true });
});

test('palabra de activación y relleno no estorban', () => {
  const r = g.parse('Marina, navega con rumbo cero nueve cero, por favor');
  assert.equal(r.status, 'ok'); assert.equal(r.wake, true); assert.equal(r.args.degrees, 90);
  assert.equal(g.parse('Capitán, full avante').args.order, 'full_ahead');
  assert.equal(g.parse('rumbo 090').wake, false);
});

test('lo que no es una orden no ejecuta nada', () => {
  ['', 'hola marina', 'qué tal el día', 'cuéntame un chiste', 'rumbo', 'cae a babor', 'full', 'viento', 'asdf qwer'].forEach(t => {
    const r = g.parse(t); assert.ok(r.status !== 'ok', `"${t}" -> ${r.id}`);
  });
});

test('consultas: solo las pedidas, y se componen con datos reales', () => {
  assert.equal(g.parse('¿Cómo cae la proa?').tool, 'drift_report');
  assert.equal(g.parse('Recomendación').id, 'q_recommend');
  assert.equal(g.parse('Informa el estado').tool, 'get_status');
  const drift = { status: 'ok', bow: { transverse_speed_kn: 0.4, side: 'estribor' }, stern: { transverse_speed_kn: 0.0, side: 'sin caída' } };
  assert.equal(g.speak(g.parse('informe de caída'), drift).text, 'Proa 0.4 nudos a estribor, popa quieta.');
  assert.equal(g.speak(g.parse('how is the bow falling'), drift).text, 'Bow 0.4 knots to starboard, stern still.');
  const rec = { status: 'ok', suggestion: { type: 'alter', side: 'port', degrees: 5 } };
  assert.equal(g.speak(g.parse('recomendación'), rec).text, 'Sugiero caer 5 grados a babor.');
  assert.equal(g.speak(g.parse('recomendación'), { status: 'ok', suggestion: null }).text, 'Sin caída significativa. Sin sugerencias.');
  const st = { status: 'ok', heading_spoken: { es: 'tres cero cero', en: 'three zero zero' }, ordered_heading_spoken: { es: 'cero nueve cero', en: 'zero nine zero' }, nav: { sog_kn: 4.2 }, engine_order: 'Slow ahead', alerts: [] };
  assert.equal(g.speak(g.parse('¿cuál es el rumbo?'), st).text, 'Rumbo tres cero cero, ordenado cero nueve cero.');
  assert.match(g.speak(g.parse('informa el estado'), st).text, /Poca avante/);
});

test('informes nuevos: meteo, derrota, abatimiento, profundidad, velocidad y sugerencia de derrota', () => {
  const ids = { 'informe meteorológico': 'q_weather', 'weather report': 'q_weather', 'informe de derrota': 'q_track', 'cross track': 'q_track',
                'informe de abatimiento': 'q_leeway', 'informe de deriva': 'q_leeway', 'report leeway': 'q_leeway', 'informe de profundidad': 'q_depth',
                'informe de velocidad': 'q_speed', '¿qué velocidad llevamos?': 'q_speed', 'informe completo': 'q_full', 'full report': 'q_full' };
  Object.keys(ids).forEach(t => assert.equal(g.parse(t).id, ids[t], t));
  const env = { wind_from_deg: 90, wind_kn: 20, wind_rel_deg: 60, wind_rel_side: 'estribor', current_toward_deg: 180, current_kn: 1.5, hs_m: 1, tide_m: 0.5 };
  assert.equal(g.speak(g.parse('informe meteorológico'), { status: 'ok', environment: env }).text,
    'Viento por el cero nueve cero, 20 nudos, por la amura de estribor. Corriente hacia el uno ocho cero, 1.5 nudos. Mar 1 metros. Marea 0.5 metros.');
  assert.match(g.speak(g.parse('weather report'), { status: 'ok', environment: env }).text, /^Wind from zero nine zero, 20 knots, on the starboard bow\./);
  const route = { waypoint: '2 de 4', distance_nm: 1.2, cross_track_m: 45, cross_track_side: 'estribor', eta_min: 9 };
  const tr = { status: 'ok', route, bearing_to_waypoint_spoken: { es: 'cero nueve cero', en: 'zero nine zero' }, cts_spoken: { es: 'cero ocho cinco', en: 'zero eight five' } };
  assert.equal(g.speak(g.parse('informe de derrota'), tr).text, 'Punto 2 de 4, 1.2 millas, demora cero nueve cero, rumbo a gobernar cero ocho cinco. Fuera de la derrota 45 metros a estribor. Llegada en 9 minutos.');
  assert.equal(g.speak(g.parse('informe de derrota'), { status: 'ok', route: 'sin derrota' }).text, 'Sin derrota guiada.');
  assert.equal(g.speak(g.parse('recomendación'), Object.assign({ suggestion: null }, tr)).text, 'Desvío de 45 metros a estribor: sugiero caer 10 grados a babor hacia la derrota.');
  assert.equal(g.speak(g.parse('recomendación'), { status: 'ok', suggestion: null, route: Object.assign({}, route, { cross_track_m: 5 }) }).text, 'Sin caída significativa. Sin sugerencias.');
  const lw = { status: 'ok', leeway_deg: 3.2, leeway_side: 'estribor', drift_deg: 4.1, drift_side: 'sin caída', sog_kn: 5 };
  assert.equal(g.speak(g.parse('informe de abatimiento'), lw).text, 'Abatimiento 3.2 grados a estribor. Deriva 4.1 grados. 5 nudos sobre el fondo.');
  const nav = { stw_kn: 5, sog_kn: 5.5, depth_m: 12, ukc_m: 1.2 };
  assert.equal(g.speak(g.parse('informe de profundidad'), { status: 'ok', nav, environment: { tide_m: 0 } }).text, 'Profundidad 12 metros. UKC 1.2 metros. UKC crítico.');
  assert.match(g.speak(g.parse('speed report'), { status: 'ok', nav, engine_order: 'Slow ahead', thrust_pct: { port: 30, stbd: 30 }, rate_of_turn_deg_s: 0 }).text, /^5 knots through water, 5\.5 over ground\. Slow ahead\. Thrust 30 and 30 percent\.$/);
  assert.equal(g.speak(g.parse('informe de profundidad'), { status: 'ok', nav: 'sin datos' }).text, 'Aún no hay datos.');
});

test('lo que Marina repite: frase fija y breve, rumbos por dígito, en el idioma de la orden', () => {
  assert.equal(g.speak(g.parse('navega con rumbo cero tres cero'), { status: 'ok' }).text, 'Rumbo cero tres cero.');
  assert.equal(g.speak(g.parse('steer course three zero five'), { status: 'ok' }).text, 'Steer course three zero five.');
  assert.equal(g.speak(g.parse('full avante'), { status: 'ok' }).text, 'Full avante.');
  assert.equal(g.speak(g.parse('port ten'), { status: 'ok' }).text, 'port 10.');
  const alt = { status: 'ok', ordered_heading_spoken: { es: 'cero nueve cinco', en: 'zero nine five' } };
  assert.equal(g.speak(g.parse('cae cinco a babor'), alt).text, 'Cae 5 a babor, rumbo cero nueve cinco.');
  assert.equal(g.speak(g.parse('viento por el este 20 nudos'), { status: 'ok' }).text, 'Viento 20 nudos por el este.');
  assert.equal(g.speak(g.parse('viento por el cero cuatro cinco'), { status: 'ok' }).text, 'Viento por el cero cuatro cinco.');
  assert.equal(g.speak(g.parse('full avante'), { status: 'error', error: 'autopilot_active' }).text, 'Piloto automático activo. Ordene control manual.');
  assert.equal(g.speak(g.parse('full ahead'), { status: 'error', error: 'free_drift' }).text, 'Free drift. Enable manual mode.');
  assert.equal(g.speak(g.parse('rumbo 090'), { status: 'ok', warning_code: 'engines_stopped' }).text, 'Rumbo cero nueve cero. Máquinas paradas.');
  assert.equal(g.speak({ status: 'no_match', lang: 'es' }).text, 'Repita.');
  assert.equal(g.speak(g.parse('reinicia la simulación'), { status: 'needs_confirmation', key: 'sim_reset' }).text, 'Reiniciar la simulación. ¿Confirma?');
});

test('el deletreo coincide con el de js/orders.js', () => {
  [0, 5, 30, 90, 180, 305, 359].forEach(d => { assert.equal(G.spoken(d, 'es'), O.spokenHeading(d).es); assert.equal(G.spoken(d, 'en'), O.spokenHeading(d).en); });
});

test('ninguna frase de la base coincide con dos órdenes distintas (sin ambigüedades)', () => {
  db.commands.forEach(c => ['es', 'en'].forEach(lang => c.examples[lang].forEach(t => assert.notEqual(g.parse(t).status, 'ambiguous', t))));
});

test('velocidad: parse < 5 ms (p95) con la base completa', () => {
  const phrases = db.commands.flatMap(c => c.examples.es.concat(c.examples.en));
  const times = [];
  for(let k = 0; k < 4; k++) phrases.forEach(t => { const t0 = process.hrtime.bigint(); g.parse(t); times.push(Number(process.hrtime.bigint() - t0) / 1e6); });
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  assert.ok(p95 < 5, 'p95 ' + p95.toFixed(3) + ' ms');
});

test('fromTool: la llamada del modelo solo se acepta si existe en la base, y da la misma frase que la voz', () => {
  const sp = (tool, args, lang, res) => { const p = g.fromTool(tool, args, lang); return p && g.speak(p, res || { status: 'ok' }).text; };
  assert.equal(sp('steer_course', { degrees: 30, lang: 'es', wake: false }, 'es'), 'Rumbo cero tres cero.');
  assert.equal(sp('steer_course', { degrees: 305 }, 'en'), 'Steer course three zero five.');
  assert.equal(sp('engine_order', { order: 'full_ahead' }, 'es'), 'Full avante.');
  assert.equal(sp('engine_order', { order: 'slow_astern' }, 'en'), 'Slow astern.');
  assert.equal(sp('helm_order', { order: 'port', angle: 10 }, 'en'), 'port 10.');
  assert.equal(sp('helm_order', { order: 'hard_starboard' }, 'es'), 'Todo a estribor.');
  assert.equal(sp('helm_order', { order: 'midships' }, 'en'), 'Midships.');
  assert.equal(sp('alter_course', { side: 'port', degrees: 5 }, 'es', { status: 'ok', ordered_heading_spoken: { es: 'cero ocho cinco', en: 'zero eight five' } }), 'Cae 5 a babor, rumbo cero ocho cinco.');
  assert.equal(sp('set_wind', { knots: 40, from_deg: 90 }, 'es'), 'Viento 40 nudos por el cero nueve cero.');
  assert.equal(sp('set_wind', { from_deg: 45 }, 'es'), 'Viento por el cero cuatro cinco.');
  assert.equal(sp('set_wind', { delta_knots: -3 }, 'en'), 'Wind, 3 knots less.');
  assert.equal(sp('set_current', { toward_deg: 180 }, 'es'), 'Corriente hacia el uno ocho cero.');
  assert.equal(sp('ui', { vectors: false }, 'es'), 'Lista oculta.');
  // lo que NO está en la base no se ejecuta
  assert.equal(g.fromTool('steer_course', { degrees: 30, speed: 5 }, 'es'), null);
  assert.equal(g.fromTool('engine_order', { order: 'ludicrous_speed' }, 'es'), null);
  assert.equal(g.fromTool('helm_order', { order: 'port', angle: 10, hack: 1 }, 'es'), null);
  assert.equal(g.fromTool('launch_missiles', {}, 'es'), null);
  assert.equal(g.fromTool('set_sim_speed', { speed: 15 }, 'es').id, 'sim_speed');
});
