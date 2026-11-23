'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F_ = require('../js/forces.js');

const ship = { L:32, effMassSurge:7.2e5, effMassSway:1.3e6, kSurge:3.2e4, kSway:4.2e5, linSurge:6e3, linSway:7.8e4 };

/* Reproduce la suma de calcularFuerzas(): total = Σ contribuciones. */
function build(c){
  const F = Object.assign({ FxP:0,FyP:0,FxS:0,FyS:0,torqueP:0,torqueS:0,windFx:0,windFy:0,torqueWind:0,Fu:0,Fw:0,torqueDamp:0 }, c);
  F.totalFx = F.FxP + F.FxS + F.windFx + F.Fu;
  F.totalFy = F.FyP + F.FyS + F.windFy + F.Fw;
  F.torqueTotal = F.torqueP + F.torqueS + F.torqueWind + F.torqueDamp;
  return F;
}
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b)), `${a} ≉ ${b}`);

test('equivalencia estática: proa + popa = fuerza lateral y reproducen el momento', () => {
  const cases = [
    { FyP:1e5, torqueP:-3.2e5 }, { windFy:-8e3, torqueWind:4.8e4 }, { Fw:2e4, torqueDamp:-9e5 },
    { FyP:5e4, FyS:-2e4, torqueP:-1e5, torqueS:3e4, windFy:5e3, torqueWind:-7e3, Fw:-1e4, torqueDamp:2e5 }
  ];
  cases.forEach(c => {
    const F = build(c), e = F_.lateralEnds(F, ship);
    close(e.bow + e.stern, F.totalFy);
    close((ship.L/4) * (e.bow - e.stern), F.torqueTotal);
  });
});

test('cada contribución se reparte con la misma equivalencia y la suma de contribuciones = total', () => {
  const F = build({ FyP:5e4, FyS:-2e4, torqueP:-1e5, torqueS:3e4, windFy:5e3, torqueWind:-7e3, Fw:-1e4, torqueDamp:2e5 });
  const e = F_.lateralEnds(F, ship);
  const sumBow = Object.keys(e.by).reduce((a, k) => a + e.by[k].bow, 0);
  const sumStern = Object.keys(e.by).reduce((a, k) => a + e.by[k].stern, 0);
  close(sumBow, e.bow); close(sumStern, e.stern);
});

test('caída: girar a estribor lleva la proa a estribor y la popa a babor', () => {
  const c = F_.caida(3, 0, 0.05, 32);             // r = +0,05 rad/s, sin deriva
  assert.ok(c.bow.v > 0 && c.stern.v < 0);
  assert.ok(c.bow.deg > 0 && c.stern.deg < 0);
  close(c.bow.v, 0.8); close(c.stern.v, -0.8);
});

test('caída: deriva pura mueve proa y popa al mismo lado con el mismo ángulo', () => {
  const c = F_.caida(3, 0.5, 0, 32);
  assert.ok(c.bow.deg > 0 && c.stern.deg > 0);
  close(c.bow.deg, c.stern.deg);
  close(c.bow.deg, Math.atan2(0.5, 3) * 180 / Math.PI);
});

test('caída: sin arrancada el ángulo no se dispara (suelo de 0,3 m/s) y la zona muerta calla el ruido', () => {
  const c = F_.caida(0, 0.2, 0, 32);
  assert.ok(Math.abs(c.bow.deg) < 45);
  const q = F_.caida(2, 0.01, 0, 32);
  assert.equal(q.bow.deg, 0); assert.equal(q.stern.deg, 0);
});

test('caída: marcha atrás conserva el signo lateral', () => {
  const c = F_.caida(-2, 0.4, 0, 32);
  assert.ok(c.bow.deg > 0 && c.stern.deg > 0);
});

test('fuerza neta: es la suma de TODAS las contribuciones, con rumbo relativo y absoluto', () => {
  const F = build({ FxP:1e5, FxS:1e5, windFx:-4e3, windFy:6e3, Fu:-1.5e5, Fw:-2e3 });
  const n = F_.net(F, ship, 300);
  close(n.fx, 1e5 + 1e5 - 4e3 - 1.5e5); close(n.fy, 6e3 - 2e3);
  assert.ok(n.relDeg > 0 && n.relDeg < 90);
  close(n.absDeg, ((300 + n.relDeg) % 360 + 360) % 360);
  assert.ok(n.accKnS > 0);
});

test('velocidad límite: crece con el empuje y se anula sin él; el arrastre lateral es mayor que el longitudinal', () => {
  const a = F_.terminalSpeed(build({ FxP:5e4, FxS:5e4 }), ship).knots;
  const b = F_.terminalSpeed(build({ FxP:2e5, FxS:2e5 }), ship).knots;
  assert.ok(b > a && a > 0);
  assert.equal(F_.terminalSpeed(build({}), ship).knots, 0);
  const lateral = F_.terminalSpeed(build({ FyP:1e5, FyS:1e5 }), ship).knots;
  const ahead = F_.terminalSpeed(build({ FxP:1e5, FxS:1e5 }), ship).knots;
  assert.ok(lateral < ahead);
});

test('recomendación: sin caída relevante', () => {
  const r = F_.recommend({ bowDeg:0.4, sternDeg:-0.3, yawDegS:0.05, cause:{bow:'viento',stern:'viento'} });
  assert.equal(r.level, 'ok'); assert.equal(r.suggest, null);
});

test('recomendación: abatimiento (mismo lado) sugiere caer a la banda contraria y nombra la causa', () => {
  const r = F_.recommend({ bowDeg:5, sternDeg:4, yawDegS:0.1, cause:{bow:'viento',stern:'viento'} });
  assert.equal(r.code, 'leeway'); assert.equal(r.side, 'estribor'); assert.equal(r.cause, 'viento');
  assert.equal(r.suggest.type, 'alter'); assert.equal(r.suggest.side, 'port'); assert.equal(r.suggest.degrees, 5);
  assert.match(r.text, /Cae 5° a babor/);
  const l = F_.recommend({ bowDeg:-7, sternDeg:-6, yawDegS:0, cause:{bow:'agua',stern:'agua'} });
  assert.equal(l.suggest.side, 'starboard'); assert.equal(l.level, 'warn');
});

test('recomendación: lados opuestos = girando; sugiere timón contrario según la velocidad de giro', () => {
  const slow = F_.recommend({ bowDeg:4, sternDeg:-3, yawDegS:1, cause:{} });
  assert.equal(slow.code, 'turning'); assert.equal(slow.suggest.type, 'helm'); assert.equal(slow.suggest.side, 'port'); assert.equal(slow.suggest.degrees, 5);
  const fast = F_.recommend({ bowDeg:-10, sternDeg:8, yawDegS:-4.5, cause:{} });
  assert.equal(fast.suggest.side, 'starboard'); assert.equal(fast.suggest.degrees, 20); assert.equal(fast.level, 'warn');
});

test('recomendación: niveles por magnitud y aviso de rumbo ordenado', () => {
  assert.equal(F_.recommend({ bowDeg:13, sternDeg:12, yawDegS:0 }).level, 'alert');
  assert.match(F_.recommend({ bowDeg:5, sternDeg:5, yawDegS:0, headingErrDeg:-8 }).text, /Rumbo ordenado a 8°/);
});

test('analyze integra todo sin mutar la física', () => {
  const F = build({ FxP:2e5, FxS:1.8e5, FyP:-1e4, windFx:-3e3, windFy:6e3, torqueWind:-4e3, Fu:-3e5, Fw:-4e3, torqueDamp:-2e5, torqueP:1e5, torqueS:-9e4 });
  const frozen = JSON.stringify(F);
  const a = F_.analyze(F, ship, { u:3, w:0.2, yawRate:0.02, headingDeg:300 });
  assert.equal(JSON.stringify(F), frozen);
  ['net','ends','fall','rec','terminal','contributions'].forEach(k => assert.ok(a[k] !== undefined, k));
  close(a.ends.bow + a.ends.stern, F.totalFy);
});

test('recomendación: el sentido del giro sigue a la velocidad de giro aunque la popa caiga más que la proa', () => {
  const r = F_.recommend({ bowDeg:68, sternDeg:-73, yawDegS:4.3, cause:{} });        // giro a estribor
  assert.equal(r.code, 'turning'); assert.equal(r.side, 'estribor');
  assert.equal(r.suggest.side, 'port'); assert.match(r.text, /^Gira a estribor/);
  const l = F_.recommend({ bowDeg:-5, sternDeg:6, yawDegS:-1.2, cause:{} });          // giro a babor
  assert.equal(l.side, 'babor'); assert.equal(l.suggest.side, 'starboard');
});

const shipT = Object.assign({}, ship, { thrustMax: 4e5 });

test('chorros: el dial 000 empuja el buque a proa y el agua sale hacia 180, uno por propulsor', () => {
  const T = shipT.thrustMax * 0.5;
  const F = build({ FxP:T*0.5, FxS:T*0.7, xP:-14, yP:-4, xS:-14, yS:4 });
  const j = F_.jets(F, shipT, { port:0, starboard:0 });
  close(j.port.pct, 50); close(j.starboard.pct, 70);
  close(j.port.azDeg, 0); close(j.port.jetDeg, 180); close(j.starboard.jetDeg, 180);
  assert.ok(j.port.jx < 0 && j.starboard.jx < 0);                             // el agua va hacia popa
  assert.ok(Math.abs(j.starboard.jx) > Math.abs(j.port.jx));                  // 70 % > 50 %: dos largos distintos
  assert.equal(j.port.x, -14); assert.equal(j.starboard.y, 4);                // en su posición real
});

test('empuje del buque: suma vectorial; 50 % + 70 % a 000 = 120 % del propulsor sin lateral', () => {
  const T = shipT.thrustMax * 0.5;
  const th = F_.thrustSum(build({ FxP:T*0.5, FxS:T*0.7 }));
  close(th.mag, T*1.2); close(th.fy, 0); close(th.relDeg, 0);
  const lat = F_.thrustSum(build({ FxP:T, FxS:T*0.5, FyP:0, FyS:T*0.5 }));    // un propulsor desviado: dirección intermedia
  assert.ok(lat.relDeg > 0 && lat.relDeg < 45);
});

test('chorros: azimutes distintos devuelven sentidos de agua distintos (az + 180)', () => {
  const T = shipT.thrustMax * 0.5, d = Math.PI/180;
  const F = build({ FxP:T*Math.cos(90*d), FyP:T*Math.sin(90*d), FxS:T*Math.cos(270*d), FyS:T*Math.sin(270*d) });
  const j = F_.jets(F, shipT, {});
  close(j.port.azDeg, 90); close(j.port.jetDeg, 270); close(j.starboard.azDeg, 270); close(j.starboard.jetDeg, 90);
});

test('cadena de correcciones: empuje + viento + agua termina en la fuerza neta de calcularFuerzas()', () => {
  const F = build({ FxP:2e5, FxS:1.4e5, FyP:1e4, windFx:-4e3, windFy:7e3, Fu:-2.5e5, Fw:-9e3 });
  const c = F_.chain(F);
  assert.equal(c.steps.map(s => s.key).join(), 'thrust,wind,water');
  assert.ok(c.err < 1e-6);
  close(c.end.x, F.totalFx); close(c.end.y, F.totalFy);
});

test('velocidad transversal: V = v ± r·L/2, en nudos y m/s', () => {
  const g = F_.caida(3, 0.4, 0.02, 32);                        // r·L/2 = 0,32 m/s
  close(g.bow.ms, 0.72); close(g.stern.ms, 0.08); close(g.bow.knots, 0.72/0.5144);
  const rot = F_.caida(0.5, 0, 0.05, 32);                      // giro puro: opuestas e iguales
  close(rot.bow.ms, -rot.stern.ms);
  const trans = F_.caida(0.5, 0.3, 0, 32);                     // traslación pura: misma banda, igual magnitud
  close(trans.bow.ms, trans.stern.ms);
});

test('con corriente lateral analyze usa la velocidad sobre el fondo, no la del agua', () => {
  const F = build({ FxP:1e5, FxS:1e5 });
  const agua = F_.analyze(F, ship, { u:3, w:0, yawRate:0, headingDeg:0 });
  const fondo = F_.analyze(F, ship, { u:3, w:0, yawRate:0, headingDeg:0, uGround:3, wGround:0.5 });
  assert.equal(agua.fall.bow.v, 0); close(fondo.fall.bow.ms, 0.5); close(fondo.fall.stern.ms, 0.5);
});

test('recomendación: con velocidades cita nudos y dice "quieta" al extremo casi parado', () => {
  const r = F_.recommend({ bowDeg:7, sternDeg:0, bowKn:0.4, sternKn:0.01, yawDegS:1.2, cause:{} });
  assert.match(r.text, /^Gira a estribor/); assert.match(r.text, /proa a estribor 0\.4 kn/); assert.match(r.text, /popa quieta/);
});
