'use strict';
// Ejecutar con: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const VoiceTools = require('../js/voice-tools.js');

function fakeSim(over){
  const calls = [];
  const rec = (name, ret) => (...a) => { calls.push([name, ...a]); return ret === undefined ? { status:'ok', message:name } : ret; };
  const sim = Object.assign({
    calls,
    steerCourse: rec('steerCourse'), alterCourse: rec('alterCourse'), helm: rec('helm'), engine: rec('engine'),
    allStop: rec('allStop'), manualControl: rec('manualControl'),
    setAutopilot: rec('setAutopilot'), simControl: rec('simControl'), setSimSpeed: rec('setSimSpeed'),
    setWind: (r) => { calls.push(['setWind', r]); return { knots: r.knots != null ? r.knots : 10 + (r.deltaKnots || 0) }; },
    setCurrent: (r) => { calls.push(['setCurrent', r]); return { knots: r.knots != null ? r.knots : 1 + (r.deltaKnots || 0) }; },
    setSea: rec('setSea'), route: rec('route'), placeVessel: rec('placeVessel'), insideChart: () => true,
    ui: rec('ui'), getStatus: () => ({ heading_deg: 300 })
  }, over || {});
  return sim;
}

test('steer_course normaliza a 0-359 y valida', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  t.execute('steer_course', { degrees: 0 });
  t.execute('steer_course', { degrees: 450 });
  t.execute('steer_course', { degrees: -10 });
  assert.deepEqual(sim.calls, [['steerCourse', 0], ['steerCourse', 90], ['steerCourse', 350]]);
  assert.equal(t.execute('steer_course', {}).error, 'bad_args');
  assert.equal(t.execute('steer_course', { degrees: 'norte' }).error, 'bad_args');
});

test('alter_course: banda obligatoria y grados acotados', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  t.execute('alter_course', { side: 'port', degrees: 5 });
  t.execute('alter_course', { side: 'starboard', degrees: -7 });   // el signo lo da la banda, no los grados
  t.execute('alter_course', { side: 'port', degrees: 500 });
  assert.deepEqual(sim.calls, [['alterCourse', 'port', 5], ['alterCourse', 'starboard', 7], ['alterCourse', 'port', 180]]);
  assert.equal(t.execute('alter_course', { side: 'babor', degrees: 5 }).error, 'bad_args');
  assert.equal(t.execute('alter_course', { side: 'port' }).error, 'bad_args');
});

test('helm_order: port/starboard exigen ángulo; midships y steady no', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  assert.equal(t.execute('helm_order', { order: 'port' }).error, 'bad_args');
  t.execute('helm_order', { order: 'port', angle: 10 });
  t.execute('helm_order', { order: 'starboard', angle: 99 });
  t.execute('helm_order', { order: 'hard_port' });
  t.execute('helm_order', { order: 'midships' });
  t.execute('helm_order', { order: 'steady' });
  assert.deepEqual(sim.calls, [['helm', 'port', 10], ['helm', 'starboard', 35], ['helm', 'hard_port', null], ['helm', 'midships', null], ['helm', 'steady', null]]);
  assert.equal(t.execute('helm_order', { order: 'a_la_gira' }).error, 'bad_args');
});

test('engine_order: todo el telégrafo y rechazo de órdenes desconocidas', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  for(const o of ['full_ahead','half_ahead','slow_ahead','dead_slow_ahead','stop','dead_slow_astern','slow_astern','half_astern','full_astern']){
    assert.equal(t.execute('engine_order', { order: o }).status, 'ok', o);
  }
  assert.equal(sim.calls.length, 9);
  assert.equal(t.execute('engine_order', { order: 'ludicrous' }).error, 'bad_args');
});

test('viento: "por el Este" (punto) y grados son DESDE; intensidad absoluta o incremento', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  t.execute('set_wind', { from_point: 'E', knots: 40 });
  t.execute('set_wind', { from_deg: 45, knots: 25 });
  t.execute('set_wind', { delta_knots: 5 });
  t.execute('set_wind', { from_point: 'NNW' });
  t.execute('set_wind', { from_deg: 405, knots: 999 });
  assert.deepEqual(sim.calls.map(c => c[1]), [
    { fromDeg: 90, knots: 40 }, { fromDeg: 45, knots: 25 }, { deltaKnots: 5 }, { fromDeg: 337.5 }, { fromDeg: 45, knots: 60 }
  ]);
  assert.equal(t.execute('set_wind', {}).error, 'bad_args');
});

test('viento: el español "Oeste" llega como W', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  t.execute('set_wind', { from_point: 'O', knots: 10 });
  assert.deepEqual(sim.calls[0][1], { fromDeg: 270, knots: 10 });
});

test('corriente: "por el 003" = DESDE 003 = hacia 183; "hacia" va directo', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  t.execute('set_current', { from_deg: 3, delta_knots: 0.5 });
  t.execute('set_current', { toward_deg: 200, knots: 1.2 });
  t.execute('set_current', { from_point: 'S', knots: 2 });
  t.execute('set_current', { from_deg: 200, knots: 1 });
  assert.deepEqual(sim.calls.map(c => c[1]), [
    { linked: false, toDeg: 183, deltaKnots: 0.5 },
    { linked: false, toDeg: 200, knots: 1.2 },
    { linked: false, toDeg: 0, knots: 2 },
    { linked: false, toDeg: 20, knots: 1 }
  ]);
  const r = t.execute('set_current', { from_deg: 3, delta_knots: 0.5 });
  assert.match(r.message, /desde el 003/);
});

test('corriente ligada al viento y validación', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  t.execute('set_current', { linked_to_wind: true });
  assert.deepEqual(sim.calls[0], ['setCurrent', { linked: true }]);
  assert.equal(t.execute('set_current', {}).error, 'bad_args');
});

test('ya no existen herramientas que mueven azimutales o palancas', () => {
  const names = VoiceTools.definitions.map(d => d.name);
  for(const gone of ['set_thrust','adjust_thrust','set_azimuth','rotate_azimuth','align_ahead','undo_last']) assert.ok(!names.includes(gone), gone);
  const { calls } = fakeSim(); const t = VoiceTools.create(fakeSim());
  assert.equal(t.execute('set_azimuth', { unit:'port', degrees: 10 }).error, 'unknown_tool');
  assert.equal(calls.length, 0);
});

test('acciones críticas exigen confirmación tras un turno del usuario', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  const r = t.execute('sim_control', { action: 'reset' });
  assert.equal(r.status, 'needs_confirmation');
  assert.equal(sim.calls.length, 0);
  assert.equal(t.execute('confirm_action', { token: r.token }).error, 'needs_user_reply');
  t.noteUserTurn();
  assert.equal(t.execute('confirm_action', { token: r.token }).status, 'ok');
  assert.deepEqual(sim.calls, [['simControl', 'reset']]);
  assert.equal(t.getPending(), null);
});

test('confirmación: token erróneo, caducidad y cancelación por otra orden', () => {
  let clock = 1000;
  const sim = fakeSim(); const t = VoiceTools.create(sim, { now: () => clock });
  let r = t.execute('route', { action: 'clear' });
  t.noteUserTurn();
  assert.equal(t.execute('confirm_action', { token: 'otro' }).error, 'bad_token');
  clock += VoiceTools.CONFIRM_TTL_MS + 1;
  assert.equal(t.execute('confirm_action', { token: r.token }).error, 'expired');

  r = t.execute('route', { action: 'clear' });
  t.noteUserTurn();
  t.execute('engine_order', { order: 'stop' });                       // otra orden cancela la pendiente
  assert.equal(t.execute('confirm_action', { token: r.token }).error, 'no_pending');
  assert.ok(!sim.calls.some(c => c[0] === 'route'));
});

test('botones Sí/No de la pantalla', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  t.execute('place_vessel', { lat: 10.4, lon: -75.5 });
  assert.equal(t.confirmPending().status, 'ok');
  assert.deepEqual(sim.calls, [['placeVessel', 10.4, -75.5]]);
  t.execute('place_vessel', { lat: 10.4, lon: -75.5 });
  t.cancelPending();
  assert.equal(t.getPending(), null);
});

test('place_vessel fuera de la carta se rechaza sin pedir confirmación', () => {
  const t = VoiceTools.create(fakeSim({ insideChart: () => false }));
  assert.equal(t.execute('place_vessel', { lat: 0, lon: 0 }).error, 'outside_chart');
  assert.equal(t.getPending(), null);
});

test('set_sim_speed, herramienta desconocida y excepciones', () => {
  const t = VoiceTools.create(fakeSim({ engine(){ throw new Error('boom'); } }));
  assert.equal(t.execute('set_sim_speed', { speed: 7 }).error, 'bad_args');
  assert.equal(t.execute('set_sim_speed', { speed: 15 }).status, 'ok');
  assert.equal(t.execute('hackear', {}).error, 'unknown_tool');
  assert.equal(t.execute('engine_order', { order: 'stop' }).error, 'exception');
});

test('definiciones: nombres únicos, esquema válido, y todas tienen manejador', () => {
  const names = VoiceTools.definitions.map(d => d.name);
  assert.equal(new Set(names).size, names.length);
  for(const d of VoiceTools.definitions){
    assert.equal(d.type, 'function');
    assert.equal(d.parameters.type, 'object');
    assert.ok(d.description.length > 20, d.name);
  }
  const t = VoiceTools.create(fakeSim());
  for(const n of names) assert.notEqual(t.execute(n, {}).error, 'unknown_tool', n);
});

test('ui admite follow y lo reenvía a la fachada', () => {
  const sim = fakeSim(); const t = VoiceTools.create(sim);
  const def = VoiceTools.definitions.find(d => d.name === 'ui');
  assert.equal(def.parameters.properties.follow.type, 'boolean');
  t.execute('ui', { follow: true });
  t.execute('ui', { follow: false });
  assert.deepEqual(sim.calls, [['ui', { follow: true }], ['ui', { follow: false }]]);
});
