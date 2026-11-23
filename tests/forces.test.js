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
    close((ship.L/2) * (e.bow - e.stern), F.torqueTotal);
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

/* ---------- Dinámica del casco: pivote, proa y popa al virar (js/forces.js + tests/helpers/plant.js) ---------- */
const Plant = require('./helpers/plant.js');
const O_ = require('../js/orders.js');
const tug = Plant.makeShip();

test('virar con estribor 100 % y babor 25 %: la proa cae a babor, la popa sale a estribor y más fuerte, pivote hacia 1/3 de eslora', () => {
  const r = Plant.run(tug, { thrP: 0.25, thrS: 1 }, 60, [1, 5, 15, 40]);
  [1, 5, 15, 40].forEach(t => {
    const o = r.out[String(t)];
    assert.ok(o.bow.v < 0, `t=${t}: proa ${o.bow.knots.toFixed(2)} kn debería ir a babor`);
    assert.ok(o.stern.v > 0, `t=${t}: popa ${o.stern.knots.toFixed(2)} kn debería ir a estribor`);
  });
  [5, 15, 40].forEach(t => {
    const o = r.out[String(t)], ratio = Math.abs(o.stern.knots) / Math.abs(o.bow.knots);
    assert.ok(ratio >= 1.2 && ratio <= 3.2, `t=${t}: popa/proa = ${ratio.toFixed(2)}`);
  });
  const piv = r.out['40'].pivot;
  assert.ok(piv.defined && piv.inside, 'el pivote debe quedar dentro del casco');
  assert.ok(piv.fromBowFrac > 0.25 && piv.fromBowFrac < 0.40, `pivote a ${piv.fromBowFrac.toFixed(2)} L desde la proa`);
});

test('el espejo (babor 100 %, estribor 25 %) es simétrico', () => {
  const a = Plant.run(tug, { thrP: 0.25, thrS: 1 }, 40, [40]).out['40'], b = Plant.run(tug, { thrP: 1, thrS: 0.25 }, 40, [40]).out['40'];
  close(a.bow.knots, -b.bow.knots, 1e-6); close(a.stern.knots, -b.stern.knots, 1e-6); close(a.pivot.fromBowFrac, b.pivot.fromBowFrac, 1e-6);
});

test('par puro casi sin arrancada: proa y popa se mueven igual y en sentido opuesto, pivote en el centro', () => {
  const o = Plant.run(tug, { thrP: 0, thrS: 0.001 }, 2, [2], { r: 0 }).out['2'];
  const o2 = Plant.run(tug, { thrP: 0.3, thrS: 0.3 }, 1, [1], { r: -0.02 }).out['1'];   // giro sin deriva ni arrancada apreciable
  assert.ok(Math.abs(Math.abs(o.bow.knots) - Math.abs(o.stern.knots)) < 0.15 * Math.max(0.01, Math.abs(o.stern.knots)) + 1e-3);
  assert.ok(o2.bow.v * o2.stern.v < 0);
});

test('marcha atrás: el pivote pasa hacia la popa', () => {
  const o = Plant.run(tug, { thrP: 0.25, thrS: 1, azP: 180, azS: 180 }, 40, [40]).out['40'];
  assert.ok(o.pivot.fromBowFrac > 0.65, `pivote a ${o.pivot.fromBowFrac.toFixed(2)} L desde la proa`);
});

test('acción + agua = neta, y la neta de proa + popa es m22·v̇ + m11·u·r', () => {
  const o = Plant.run(tug, { thrP: 0.25, thrS: 1 }, 20, [20]).out['20'], F = o.F;
  const e = F_.lateralEnds(F, tug);
  close(e.action.bow + e.water.bow, e.bow, 1e-9); close(e.action.stern + e.water.stern, e.stern, 1e-9);
  close(e.bow + e.stern, F.totalFy, 1e-9);
  close(F.totalFy, tug.effMassSway * F.acc.dv + tug.effMassSurge * F.u * F.r, 1e-9);
  // el par de los propulsores es una pareja: popa contra el giro (a estribor), proa hacia el giro (a babor)
  assert.ok(e.action.bow < 0 && e.action.stern > 0);
});

test('Munk: con arrancada y deriva a estribor la proa tiende a irse a babor (inestabilizante)', () => {
  const d = F_.accel(tug, { u: 4, v: 0.5, r: 0 }, { X: 0, Y: 0, N: 0 });
  assert.ok(d.dr < 0);
  const m = F_.accel(tug, { u: 4, v: 0, r: 0.05 }, { X: 0, Y: 0, N: 0 });          // el acoplo u·r da aceleración lateral
  assert.ok(m.dv < 0);
});

test('calibración: giro máximo a velocidad cero = diseño, velocidad terminal = diseño, recta estable', () => {
  let st = { u: 0, v: 0, r: 0 };
  for(let i = 0; i < 20000; i++){
    const h = F_.hullHydro(tug, st.u, st.v, st.r, 0), N = tug.maxTorque + h.N + F_.yawDamp(tug, st.r);
    const d = F_.accel(tug, st, { X: 0, Y: h.Fw, N }); st.u += d.du*0.01; st.v += d.dv*0.01; st.r += d.dr*0.01;
  }
  const rDeg = st.r * 180 / Math.PI, design = tug.yawDesign * 180 / Math.PI;
  assert.ok(Math.abs(rDeg - design) / design < 0.10, `giro máx ${rDeg.toFixed(2)}°/s, diseño ${design}`);
  const v = Plant.run(tug, { thrP: 1, thrS: 1 }, 200, [200]).out['200'].st.u / Plant.KN;
  assert.ok(Math.abs(v - 12) / 12 < 0.08, `velocidad terminal ${v.toFixed(2)} kn`);
  const s = Plant.run(tug, { thrP: 0.5, thrS: 0.5 }, 150, [150], { u: 4 * Plant.KN, r: 0.02 }).out['150'];
  assert.ok(Math.abs(s.st.r) * 180 / Math.PI < 0.05, `la guiñada debe amortiguarse en recta, r=${(s.st.r*180/Math.PI).toFixed(3)}°/s`);
});

test('el lazo de rumbo de órdenes sigue convergiendo con la dinámica nueva', () => {
  [['slow_ahead', 0, 90], ['dead_slow_ahead', 3, 355], ['half_ahead', 0, 180]].forEach(([tel, h0, target]) => {
    const c = O_.create(); c.engine(tel); c.steerCourse(target);
    const st = { u: 0.1, v: 0, r: 0, hdg: h0 * Math.PI / 180 }, dt = 0.05; let reach = null, over = 0;
    for(let t = 0; t < 600; t += dt){
      const u = c.step({ ship: tug, hdgDeg: O_.norm360(st.hdg * 180 / Math.PI), yawRateRad: st.r, dt, surgeKn: st.u / Plant.KN });
      const a = O_.allocate({ ship: tug, Nd: u.Nd, T0: u.T0, phi: u.phi, sides: u.sides });
      const F = Plant.forces(tug, st, { thrP: a.thrP, thrS: a.thrS, azP: a.azP, azS: a.azS });
      const d = F_.accel(tug, st, { X: F.totalFx, Y: F.totalFy, N: F.torqueTotal });
      st.u += d.du*dt; st.v += d.dv*dt; st.r += d.dr*dt; st.hdg += st.r*dt;
      const err = O_.angDiff(target, st.hdg * 180 / Math.PI);
      if(reach === null && Math.abs(err) < 2) reach = t;
      if(reach !== null) over = Math.max(over, -Math.sign(O_.angDiff(target, h0)) * err);
    }
    assert.ok(reach !== null && reach < 200, `${tel} ${h0}->${target}: no llega`);
    assert.ok(Math.abs(O_.angDiff(target, st.hdg * 180 / Math.PI)) < 2, `${tel}: error final`);
    assert.ok(over < 10, `${tel}: sobreimpulso ${over.toFixed(1)}°`);
  });
});

test('pivot: sin giro no está definido; fuera del casco se avisa', () => {
  assert.equal(F_.pivot(0.3, 0, 32).defined, false);
  const p = F_.pivot(0.5, -0.0111, 32);        // r ≈ -0,64°/s, w = 0,5 m/s -> pivote a 45 m por delante del centro
  assert.equal(p.defined, true); assert.equal(p.inside, false);
});
