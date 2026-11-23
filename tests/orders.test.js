'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../js/orders.js');

/* Buque de referencia: mismas fórmulas que construirBuque() para el remolcador por defecto. */
function makeShip(){
  const L = 32, B = 11, T = 4.5, D = 6.5, Cb = 0.55, RHO_W = 1025;
  const mass = Math.max(L*B*T*Cb*RHO_W, 3e4);
  const thrustMax = (2670/70)*9800*2;
  const Iyaw = mass*(L*L+B*B)/12;
  const maxTorque = thrustMax*0.45*L;
  const yawDesign = 8*Math.PI/180;
  const kYawQuad = maxTorque/(yawDesign*yawDesign);
  const kYawLin = kYawQuad*yawDesign*0.15;
  return { L, B, mass, thrustMax, maxTorque, yawDesign, kYawQuad, kYawLin,
           longOffset: -0.33*L, latOffset: 0.30*B, effIyaw: Iyaw*(1+0.10+0.20*Cb) };
}
const ship = makeShip();

/* Momento de guiñada que produce una asignación (misma ecuación que calcularFuerzas()). */
function torqueOf(a){
  const Tmax = ship.thrustMax*0.5, D2R = Math.PI/180;
  const t = (thr, az, y) => {
    const T = thr*Tmax, Fx = T*Math.cos(az*D2R), Fy = T*Math.sin(az*D2R);
    return ship.longOffset*Fy - y*Fx;
  };
  return t(a.thrP, a.azP, -ship.latOffset) + t(a.thrS, a.azS, ship.latOffset);
}

test('allocate: el momento producido tiene el signo pedido, avante y atrás', () => {
  const T0 = 0.55*ship.thrustMax*0.5;
  for(const phi of [0, 180]){
    for(const sgn of [1, -1]){
      const Nd = sgn*0.2*ship.maxTorque;
      const a = O.allocate({ ship, Nd, T0, phi });
      const N = torqueOf(a);
      assert.ok(N*sgn > 0, `phi=${phi} sgn=${sgn} N=${N}`);
    }
  }
});

test('allocate: alcanza el momento pedido cuando hay autoridad suficiente', () => {
  const T0 = 0.55*ship.thrustMax*0.5;
  const Nd = 0.05*ship.maxTorque;
  const N = torqueOf(O.allocate({ ship, Nd, T0, phi:0 }));
  assert.ok(Math.abs(N - Nd) / Nd < 0.05, `N=${N} Nd=${Nd}`);
});

test('allocate: con empuje cero no inventa momento ni potencia', () => {
  const a = O.allocate({ ship, Nd: 0.3*ship.maxTorque, T0: 0, phi: 0 });
  assert.equal(a.thrP, 0); assert.equal(a.thrS, 0);
  assert.equal(torqueOf(a), 0);
});

test('allocate: respeta saturaciones (0-1) y el sesgo máximo', () => {
  const a = O.allocate({ ship, Nd: ship.maxTorque, T0: ship.thrustMax*0.5, phi: 0 });
  assert.ok(a.thrP >= 0 && a.thrP <= 1 && a.thrS >= 0 && a.thrS <= 1);
  assert.ok(Math.abs(a.biasDeg) <= O.CFG.maxBiasDeg + 1e-9);
});

test('allocate: sin demanda de momento deja los azimutales a proa (o a popa)', () => {
  const T0 = 0.3*ship.thrustMax*0.5;
  assert.equal(O.allocate({ ship, Nd:0, T0, phi:0 }).azP, 0);
  assert.equal(O.allocate({ ship, Nd:0, T0, phi:180 }).azP, 180);
});

/* Lazo cerrado con dinámica de guiñada simple (misma estructura que pasoFisico). */
function simulate(ctl, { hdg0, secs, order }){
  let hdg = hdg0*Math.PI/180, r = 0, t = 0, maxErr = 0, overshoot = 0, reachedAt = null;
  const dt = 0.1, events = [];
  const target = ctl.state.hdgTarget;
  while(t < secs){
    const u = ctl.step({ ship, hdgDeg: O.norm360(hdg*180/Math.PI), yawRateRad: r, dt });
    const a = O.allocate({ ship, Nd:u.Nd, T0:u.T0, phi:u.phi });
    const N = torqueOf(a) - (ship.kYawLin*r + ship.kYawQuad*r*Math.abs(r));
    r += N/ship.effIyaw*dt; hdg += r*dt; t += dt;
    u.events.forEach(e => events.push({ t, ...e }));
    const err = O.angDiff(target, hdg*180/Math.PI);
    if(reachedAt === null && Math.abs(err) < 2) reachedAt = t;
    if(reachedAt !== null) overshoot = Math.max(overshoot, -Math.sign(O.angDiff(target, hdg0))*err);
    maxErr = err;
  }
  return { finalErr: maxErr, overshoot, reachedAt, events };
}

test('lazo de rumbo: converge a ±2° con "slow ahead" sin sobreimpulso excesivo', () => {
  const c = O.create();
  c.engine('slow_ahead'); c.steerCourse(90);
  const r = simulate(c, { hdg0: 0, secs: 400 });
  assert.ok(Math.abs(r.finalErr) < 2, `error final ${r.finalErr}`);
  assert.ok(r.overshoot < 8, `sobreimpulso ${r.overshoot}°`);
  assert.ok(r.events.some(e => e.type === 'heading_achieved'), 'sin informe de cumplimiento');
});

test('lazo de rumbo: cambio pequeño (5°) y rumbo por el otro lado del 000', () => {
  const c = O.create();
  c.engine('dead_slow_ahead'); c.steerCourse(355);
  const r = simulate(c, { hdg0: 3, secs: 400 });
  assert.ok(Math.abs(r.finalErr) < 2, `error final ${r.finalErr}`);
});

test('lazo de rumbo: también gobierna marcha atrás', () => {
  const c = O.create();
  c.engine('slow_astern'); c.steerCourse(270);
  const r = simulate(c, { hdg0: 300, secs: 500 });
  assert.ok(Math.abs(r.finalErr) < 3, `error final ${r.finalErr}`);
});

test('alterCourse: relativo al rumbo ordenado, y al actual si no hay orden', () => {
  const c = O.create();
  assert.equal(c.alterCourse('port', 5, 100).ordered_heading, 95);
  assert.equal(c.alterCourse('starboard', 10, 100).ordered_heading, 105);   // acumula sobre lo ordenado
  c.release();
  assert.equal(c.alterCourse('port', 10, 5).ordered_heading, 355);          // cruza el 000
});

test('helm: port/starboard fijan velocidad de giro; midships y steady fijan rumbo', () => {
  const c = O.create();
  const p = c.helm('port', 10, 90, 0, 8);
  assert.ok(p.target_rate_deg_s < 0);
  const h = c.helm('hard_starboard', null, 90, 0, 8);
  assert.equal(h.helm_angle, 35);
  assert.ok(Math.abs(h.target_rate_deg_s - 8) < 0.11);
  const m = c.helm('midships', null, 120, 0.5, 8);
  assert.equal(c.state.mode, 'rate');                                        // a la vía: timón a cero, no fija rumbo
  assert.equal(c.state.rateDegS, 0); assert.equal(m.helm_angle, 0); assert.equal(c.state.hdgTarget, null);
  const st = c.helm('steady', null, 120, 0.5, 8);
  assert.equal(c.state.mode, 'heading');                                     // así: mantiene el rumbo alcanzado
  assert.equal(st.ordered_heading, 122);                                     // anticipa 4 s de giro residual
});

test('engine: telégrafo completo y orden desconocida', () => {
  const c = O.create();
  for(const k of Object.keys(O.TELEGRAPH)) assert.ok(c.engine(k), k);
  assert.equal(c.engine('ludicrous_speed'), null);
  c.engine('full_astern');
  assert.equal(c.telegraphEntry().dir, -1);
});

test('describe y release', () => {
  const c = O.create();
  assert.equal(c.describe(), '');
  c.engine('slow_ahead'); c.steerCourse(5);
  assert.equal(c.describe(), '005° · Slow ahead');
  c.release();
  assert.equal(c.isActive(), false);
  assert.equal(c.describe(), '');
});

test('rosa de rumbos en español e inglés', () => {
  assert.equal(O.pointToDeg('E'), 90);
  assert.equal(O.pointToDeg('ne'), 45);
  assert.equal(O.pointToDeg('O'), 270);      // Oeste
  assert.equal(O.pointToDeg('NNO'), 337.5);
  assert.equal(O.pointToDeg('x'), null);
});

test('fromThrust: hereda la orden de máquinas más parecida a la potencia previa', () => {
  assert.equal(O.fromThrust(0, 1), 'stop');
  assert.equal(O.fromThrust(0.04, 1), 'stop');
  assert.equal(O.fromThrust(0.14, 1), 'dead_slow_ahead');
  assert.equal(O.fromThrust(0.33, 1), 'slow_ahead');
  assert.equal(O.fromThrust(0.5, 1), 'half_ahead');
  assert.equal(O.fromThrust(0.9, 1), 'full_ahead');
  assert.equal(O.fromThrust(0.5, -1), 'half_astern');
  assert.equal(O.fromThrust(1, -1), 'full_astern');
});

test('hold: una orden de rumbo desde el mando manual mantiene la potencia tal cual, sin inventar una orden de máquinas', () => {
  const c = O.create();
  c.seed(0.42, 1); c.steerCourse(90);
  assert.equal(c.state.telegraph, 'hold');
  const e = c.telegraphEntry();
  assert.equal(e.f, 0.42); assert.equal(e.dir, 1); assert.equal(e.label, 'Hold power');
  const u = c.step({ ship, hdgDeg: 0, yawRateRad: 0, dt: 0.1 });
  assert.ok(Math.abs(u.T0 - 0.42 * ship.thrustMax * 0.5) < 1e-6);
  assert.match(c.describe(), /090°/);
});

test('hold: solo una orden de máquinas cambia la potencia; seed no pisa una orden ya activa', () => {
  const c = O.create();
  c.seed(0.42, 1); c.steerCourse(90);
  c.engine('slow_ahead');
  assert.equal(c.telegraphEntry().f, 0.30);
  c.seed(0.9, -1);                                  // ya activa: se ignora
  assert.equal(c.telegraphEntry().f, 0.30);
  c.release(); assert.equal(c.state.holdF, 0);
});

test('hold: marcha atrás mantenida conserva el sentido', () => {
  const c = O.create(); c.seed(0.3, -1); c.steerCourse(10);
  const u = c.step({ ship, hdgDeg: 0, yawRateRad: 0, dt: 0.1 });
  assert.equal(u.phi, 180);
});

test('rumbos por dígito: 000, 005, 030, 090, 305, 359 en español e inglés', () => {
  const s = d => O.spokenHeading(d);
  assert.equal(s(0).es, 'cero cero cero'); assert.equal(s(0).en, 'zero zero zero');
  assert.equal(s(5).es, 'cero cero cinco');
  assert.equal(s(30).es, 'cero tres cero'); assert.equal(s(30).en, 'zero three zero');
  assert.equal(s(90).es, 'cero nueve cero');
  assert.equal(s(305).es, 'tres cero cinco'); assert.equal(s(305).en, 'three zero five');
  assert.equal(s(359).es, 'tres cinco nueve');
  assert.equal(s(-10).digits, '350'); assert.equal(s(360).digits, '000');
});

/* ---------- Velocidad en nudos, porcentaje, por motor, ease / nothing ---------- */
function simSurge(ctl, { v0 = 0, secs = 400 }){
  let v = v0, t = 0, reachedAt = null; const dt = 0.5, events = [];
  while(t < secs){
    const u = ctl.step({ ship, hdgDeg: 0, yawRateRad: 0, dt, surgeKn: v });
    const dir = u.phi === 180 ? -1 : 1, f = u.T0 / (ship.thrustMax * 0.5);
    // casco: aceleración proporcional a la potencia, resistencia cuadrática (máx ~10 kn a plena potencia)
    v += (dir * f * 0.9 - 0.0090 * v * Math.abs(v)) * dt; t += dt;
    u.events.forEach(e => events.push({ t, ...e }));
    if(reachedAt === null && Math.abs(Math.abs(ctl.state.speedKn) - Math.abs(v)) < 0.3) reachedAt = t;
  }
  return { v, reachedAt, events };
}

test('velocidad objetivo: converge a ±0.3 kn, avante y atrás, y avisa una sola vez', () => {
  let c = O.create(); c.speed(6);
  let r = simSurge(c, {});
  assert.ok(Math.abs(r.v - 6) < 0.3, `v final ${r.v}`);
  assert.equal(r.events.filter(e => e.type === 'speed_achieved').length, 1);
  assert.ok(c.state.speedF > 0 && c.state.speedF < 1);
  c = O.create(); c.speed(-3);
  r = simSurge(c, {});
  assert.ok(Math.abs(r.v + 3) < 0.3, `v final ${r.v}`);
});

test('velocidad: reducir desde más rápido no pone atrás y baja la potencia', () => {
  const c = O.create(); c.speed(3);
  const r = simSurge(c, { v0: 8 });
  assert.ok(Math.abs(r.v - 3) < 0.35, `v final ${r.v}`);
});

test('potencia en porcentaje: 50 % avante y 30 % atrás', () => {
  const c = O.create(); c.power(50, 1);
  let u = c.step({ ship, hdgDeg: 0, yawRateRad: 0, dt: 0.1 });
  assert.equal(u.phi, 0); assert.ok(Math.abs(u.T0 - 0.5 * ship.thrustMax * 0.5) < 1e-6);
  assert.match(c.describe(), /Power 50%/);
  c.power(30, -1);
  u = c.step({ ship, hdgDeg: 0, yawRateRad: 0, dt: 0.1 });
  assert.equal(u.phi, 180); assert.ok(Math.abs(u.T0 - 0.3 * ship.thrustMax * 0.5) < 1e-6);
});

test('por motor: babor avante y estribor atrás; "ambas" lo borra', () => {
  const c = O.create(); c.engine('slow_ahead', 'port'); c.engine('slow_astern', 'starboard');
  let u = c.step({ ship, hdgDeg: 0, yawRateRad: 0, dt: 0.1 });
  assert.ok(u.sides); assert.equal(u.sides.P.phi, 0); assert.equal(u.sides.S.phi, 180);
  const a = O.allocate({ ship, Nd: 0, T0: u.T0, phi: u.phi, sides: u.sides });
  assert.equal(a.azP, 0); assert.equal(a.azS, 180); assert.ok(a.thrP > 0 && a.thrS > 0);
  assert.match(c.describe(), /P Slow ahead \/ S Slow astern/);
  c.engine('half_ahead', 'both');
  u = c.step({ ship, hdgDeg: 0, yawRateRad: 0, dt: 0.1 });
  assert.equal(u.sides, null);
});

test('por motor: si ambos lados quedan iguales vuelve a la orden común', () => {
  const c = O.create(); c.engine('slow_ahead'); c.engine('half_ahead', 'port'); c.engine('half_ahead', 'starboard');
  assert.equal(c.state.telegraph, 'half_ahead'); assert.equal(c.perSide(), null);
});

test('un punto del telégrafo: aumenta y reduce avante, atrás y desde stop', () => {
  const c = O.create(); c.engine('slow_ahead');
  c.engineStep('up'); assert.equal(c.state.telegraph, 'half_ahead');
  c.engineStep('down'); c.engineStep('down'); assert.equal(c.state.telegraph, 'dead_slow_ahead');
  c.engineStep('down'); assert.equal(c.state.telegraph, 'stop');
  c.engineStep('up'); assert.equal(c.state.telegraph, 'dead_slow_ahead');
  c.engine('half_astern'); c.engineStep('down'); assert.equal(c.state.telegraph, 'slow_astern');
});

test('timón: ease conserva la banda; nothing to port solo frena un giro a babor', () => {
  const c = O.create();
  c.helm('port', 20, 90, 0, 8); assert.equal(c.state.rateDegS < 0, true);
  c.helm('ease', 10, 90, 0, 8); assert.match(c.state.helmLabel, /Port 10/);
  const c2 = O.create(); c2.helm('starboard', 15, 90, 0, 8);
  const r = c2.helm('nothing_port', null, 90, 0, 8);
  assert.equal(r.no_change, true); assert.match(c2.state.helmLabel, /Starboard 15/);
  const c3 = O.create(); c3.helm('port', 15, 90, 0, 8);
  c3.helm('nothing_port', null, 90, -1, 8); assert.equal(c3.state.mode, 'heading');
});
