'use strict';
/* Planta de prueba: reproduce calcularFuerzas() + pasoFisico() de index.html con las funciones puras de js/forces.js,
   para validar la dinámica (pivote, proa/popa, estabilidad) sin navegador. */
const FO = require('../../js/forces.js');
const D2R = Math.PI / 180, KN = 0.5144;

/* Remolcador por defecto, mismas fórmulas que construirBuque(). */
function makeShip(over){
  const L = 32, B = 11, T = 4.5, Cb = 0.55, RHO_W = 1025, vDesign = 12 * KN;
  const mass = Math.max(L * B * T * Cb * RHO_W, 3e4);
  const thrustMax = (2670 / 70) * 9800 * 2;
  const Iyaw = mass * (L * L + B * B) / 12;
  const kSurge = thrustMax / (vDesign * vDesign), kSway = kSurge * 13;
  const linSurge = kSurge * vDesign * 0.06, linSway = kSway * vDesign * 0.06;
  const maxTorque = thrustMax * 0.45 * L, yawDesign = 8 * D2R;
  const kYawQuad = maxTorque / (yawDesign * yawDesign), kYawLin = kYawQuad * yawDesign * 0.15;
  const ship = { L, B, T, mass, thrustMax, kSurge, kSway, linSurge, linSway, maxTorque, yawDesign, kYawQuad, kYawLin,
    effMassSurge: mass * (1 + 0.06 + 0.10 * Cb), effMassSway: mass * (1 + 0.45 + 0.75 * Cb), effIyaw: Iyaw * (1 + 0.10 + 0.20 * Cb),
    longOffset: -0.33 * L, latOffset: 0.30 * B };
  return Object.assign(ship, over || {});
}

/* Fuerzas del instante (misma estructura que calcularFuerzas). st = { u, v, r, hdg }, cmd = { thrP, thrS, azP, azS } (0-1, grados). */
function forces(ship, st, cmd, env){
  env = env || {};
  const Tm = ship.thrustMax * 0.5, azP = (cmd.azP || 0) * D2R, azS = (cmd.azS || 0) * D2R;
  const FxP = cmd.thrP * Tm * Math.cos(azP), FyP = cmd.thrP * Tm * Math.sin(azP);
  const FxS = cmd.thrS * Tm * Math.cos(azS), FyS = cmd.thrS * Tm * Math.sin(azS);
  const xP = ship.longOffset, yP = -ship.latOffset, xS = ship.longOffset, yS = ship.latOffset;
  const torqueP = xP * FyP - yP * FxP, torqueS = xS * FyS - yS * FxS;
  const Hs = env.Hs || 0;
  const Fu = -(ship.linSurge * st.u + ship.kSurge * (1 + 0.35 * Hs * Hs) * st.u * Math.abs(st.u));
  const hull = FO.hullHydro(ship, st.u, st.v, st.r, Hs);
  const torqueDamp = FO.yawDamp(ship, st.r);
  const F = { u: st.u, w: st.v, r: st.r, FxP, FyP, FxS, FyS, torqueP, torqueS, xP, yP, xS, yS, windFx: 0, windFy: 0, torqueWind: 0,
    Fu, Fw: hull.Fw, torqueHull: hull.N, torqueDamp, hull };
  F.totalFx = FxP + FxS + Fu; F.totalFy = FyP + FyS + hull.Fw;
  F.torqueTotal = torqueP + torqueS + torqueDamp + hull.N;
  return F;
}

/* Un paso de integración (Euler semi-implícito, como pasoFisico). Devuelve las fuerzas usadas. */
function step(ship, st, cmd, dt, env){
  const F = forces(ship, st, cmd, env);
  const d = FO.accel(ship, st, { X: F.totalFx, Y: F.totalFy, N: F.torqueTotal });
  st.u += d.du * dt; st.v += d.dv * dt; st.r += d.dr * dt; st.hdg += st.r * dt;
  F.acc = d;
  return F;
}

/* Simula `secs` y devuelve instantáneas en los tiempos pedidos (s). */
function run(ship, cmd, secs, at, st0){
  const st = Object.assign({ u: 0, v: 0, r: 0, hdg: 0 }, st0 || {}), out = {}, dt = 0.02;
  const marks = (at || []).map(t => Math.round(t / dt));
  for(let i = 0; i <= Math.round(secs / dt); i++){
    const F = step(ship, st, cmd, dt);
    if(marks.includes(i)){
      const c = FO.caida(st.u, st.v, st.r, ship.L), pv = FO.pivot(st.v, st.r, ship.L);
      out[(i * dt).toFixed(0)] = { st: Object.assign({}, st), bow: c.bow, stern: c.stern, pivot: pv, F };
    }
  }
  return { st, out };
}

module.exports = { makeShip, forces, step, run, KN, D2R };
