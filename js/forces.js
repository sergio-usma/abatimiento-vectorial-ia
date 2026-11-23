/* ASD Bridge Simulator: análisis de fuerzas en tiempo real (puro, sin DOM).
 *
 * Toma las fuerzas que `calcularFuerzas()` ya calcula cada frame (propulsores, viento, resistencia hidrodinámica que incluye
 * la corriente y el oleaje, amortiguamiento de giro) y deriva: la fuerza neta, la fuerza lateral equivalente en proa y popa,
 * la caída de cada extremo y una recomendación. NO cambia la física ni los controles: solo lee y representa.
 *
 * Ejes del buque: x hacia proa, y hacia estribor, giro positivo = proa a estribor. Fuerzas en N, velocidades en m/s.
 */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.ASDForces = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  const R2D = 180 / Math.PI, KN = 0.5144;
  const norm360 = d => ((d % 360) + 360) % 360;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const side = v => v > 0 ? 'estribor' : 'babor';
  const opposite = v => v > 0 ? 'babor' : 'estribor';

  const CFG = {
    uFloor: 0.3,          // m/s: suelo de la velocidad de avance al calcular grados de caída (evita dispararse sin arrancada)
    vDead: 0.03,          // m/s: por debajo, el extremo se considera quieto
    forceDead: 500,       // N: por debajo, la fuerza lateral equivalente se considera nula
    degOk: 1.5,           // grados: caída no significativa
    degWarn: 6, degAlert: 12,
    rateOk: 0.3           // °/s: giro no significativo
  };

  /* Contribuciones al balance de fuerzas, tal como las suma calcularFuerzas(): propulsores, viento, agua y amortiguamiento. */
  function contributions(F){
    return [
      { key:'port',      Fx:F.FxP,   Fy:F.FyP,   M:F.torqueP },
      { key:'starboard', Fx:F.FxS,   Fy:F.FyS,   M:F.torqueS },
      { key:'wind',      Fx:F.windFx, Fy:F.windFy, M:F.torqueWind },
      { key:'water',     Fx:F.Fu,    Fy:F.Fw,    M:0 },                 // resistencia hidrodinámica (corriente y oleaje incluidos)
      { key:'damp',      Fx:0,       Fy:0,       M:F.torqueDamp }       // amortiguamiento de giro
    ];
  }

  /* Equivalencia estática: una fuerza lateral Fy y un momento M respecto al centro equivalen a dos fuerzas
     laterales, en proa y en popa (a ±L/4 del centro): bow + stern = Fy ; (L/4)(bow - stern) = M. */
  function endsFrom(Fy, M, L){
    return { bow: Fy/2 + 2*M/L, stern: Fy/2 - 2*M/L };
  }

  /* Fuerza neta total y aceleración (con las mismas masas efectivas que usa la integración). */
  function net(F, ship, headingDeg){
    const fx = F.totalFx, fy = F.totalFy, mag = Math.hypot(fx, fy);
    const rel = mag > 1 ? Math.atan2(fy, fx) * R2D : 0;
    const aX = fx / ship.effMassSurge, aY = fy / ship.effMassSway;
    return { fx, fy, mag, relDeg: rel, absDeg: norm360(headingDeg + rel), aX, aY, accKnS: Math.hypot(aX, aY) / KN, moment: F.torqueTotal };
  }

  /* Fuerza lateral equivalente en proa y popa con TODAS las fuerzas, y cuánto aporta cada una. */
  function lateralEnds(F, ship){
    const L = ship.L, total = endsFrom(F.totalFy, F.torqueTotal, L), by = {};
    contributions(F).forEach(c => { by[c.key] = endsFrom(c.Fy, c.M, L); });
    // causa dominante por extremo: viento, agua o propulsores (la suma de babor y estribor)
    const thrust = k => (by.port[k] + by.starboard[k]);
    const cause = k => {
      const cands = { viento: Math.abs(by.wind[k]), agua: Math.abs(by.water[k] + by.damp[k]), propulsores: Math.abs(thrust(k)) };
      return Object.keys(cands).reduce((a, b) => cands[a] >= cands[b] ? a : b);
    };
    return { bow: total.bow, stern: total.stern, by, cause: { bow: cause('bow'), stern: cause('stern') } };
  }

  /* Vectores de velocidad transversal de proa y popa (Bow/Stern Transverse Speed Vectors, como en ECDIS y consolas
     de atraque): velocidad lateral de cada extremo, V = v ± r·L/2, en nudos y m/s. Se espera SOBRE EL FONDO (u, w del
     casco más la corriente); el ángulo respecto a la proa queda como dato secundario. Positivo = estribor. */
  function caida(u, w, r, L){
    const mk = v => {
      const vv = Math.abs(v) < CFG.vDead ? 0 : v;
      return { v: vv, ms: vv, deg: vv === 0 ? 0 : Math.atan2(vv, Math.max(Math.abs(u), CFG.uFloor)) * R2D, knots: vv / KN };
    };
    return { bow: mk(w + r*L/2), stern: mk(w - r*L/2) };
  }

  /* Chorros de agua de los dos propulsores. El dial indica hacia dónde se empuja el BUQUE (F = T·[cos az, sin az]);
     el agua sale en sentido contrario (az + 180). Largo ∝ % de máquinas. Posición real: popa, a cada banda. */
  function jets(F, ship, az){
    const Tmax = ship.thrustMax * 0.5;
    const mk = (key, fx, fy, x, y, dial) => {
      const mag = Math.hypot(fx, fy);
      const azDeg = mag > 1 ? norm360(Math.atan2(fy, fx) * R2D) : norm360(dial || 0);
      return { key, pct: Tmax > 0 ? clamp(mag / Tmax * 100, 0, 100) : 0, mag, azDeg, jetDeg: norm360(azDeg + 180),
               fx, fy, jx: -fx, jy: -fy, x, y };
    };
    az = az || {};
    return { port: mk('port', F.FxP, F.FyP, F.xP, F.yP, az.port), starboard: mk('starboard', F.FxS, F.FyS, F.xS, F.yS, az.starboard) };
  }

  /* Empuje del buque: suma vectorial de lo que hacen los dos propulsores (dirección e intensidad según cada uno). */
  function thrustSum(F){
    const fx = F.FxP + F.FxS, fy = F.FyP + F.FyS, mag = Math.hypot(fx, fy);
    return { fx, fy, mag, relDeg: mag > 1 ? Math.atan2(fy, fx) * R2D : 0 };
  }

  /* Polígono de correcciones: empuje + viento + agua (corriente y oleaje), encadenado. El último punto es la fuerza neta. */
  function chain(F){
    const steps = [ ['thrust', F.FxP + F.FxS, F.FyP + F.FyS], ['wind', F.windFx, F.windFy], ['water', F.Fu, F.Fw] ];
    let x = 0, y = 0;
    const pts = steps.map(([key, fx, fy]) => { x += fx; y += fy; return { key, fx, fy, x, y }; });
    return { steps: pts, end: { x, y }, err: Math.hypot(x - F.totalFx, y - F.totalFy) };
  }

  /* Velocidad límite de los propulsores solos (sin viento ni corriente), con la ley de arrastre del simulador. */
  function terminalSpeed(F, ship){
    const fx = F.FxP + F.FxS, fy = F.FyP + F.FyS, mag = Math.hypot(fx, fy);
    if(mag < 1) return { knots: 0, dirDeg: 0 };
    const d = Math.atan2(fy, fx), c2 = Math.cos(d)**2, s2 = 1 - c2;
    const k = ship.kSurge*c2 + ship.kSway*s2, lin = ship.linSurge*c2 + ship.linSway*s2;
    const v = (-lin + Math.sqrt(lin*lin + 4*k*mag)) / (2*k);
    return { knots: v / KN, dirDeg: d * R2D };
  }

  /* Recomendación: texto corto en lenguaje de puente. Solo sugiere; nunca actúa sobre controles ni órdenes. */
  function recommend(inp){
    // inp: { bowDeg, sternDeg, yawDegS, cause:{bow,stern}, headingErrDeg? }
    const b = inp.bowDeg, s = inp.sternDeg, r = inp.yawDegS || 0;
    const maxAbs = Math.max(Math.abs(b), Math.abs(s));
    const level = maxAbs >= CFG.degAlert ? 'alert' : maxAbs >= CFG.degWarn ? 'warn' : 'info';
    const errTxt = inp.headingErrDeg != null && Math.abs(inp.headingErrDeg) >= 2 ? ` Rumbo ordenado a ${Math.abs(Math.round(inp.headingErrDeg))}°.` : '';
    if(maxAbs < CFG.degOk && Math.abs(r) < CFG.rateOk) return { level:'ok', code:'steady', text:'Sin caída significativa.', suggest:null };

    const sameSide = (b > 0 && s > 0) || (b < 0 && s < 0);
    if(sameSide){
      const mean = (b + s) / 2, deg = Math.round(Math.abs(mean));
      const cause = inp.cause && inp.cause.bow === inp.cause.stern ? inp.cause.bow : (inp.cause ? inp.cause.bow : 'entorno');
      return { level, code:'leeway', side: side(mean), cause,
        text: `Abatimiento ${deg}° a ${side(mean)} (${cause}). Cae ${deg}° a ${opposite(mean)}.${errTxt}`,
        suggest: { type:'alter', side: opposite(mean) === 'babor' ? 'port' : 'starboard', degrees: Math.max(1, deg) } };
    }
    // un extremo casi quieto (< 0,05 kn) se dice "quieta"; si no, banda y nudos
    const part = (name, deg, kn) => (kn != null && Math.abs(kn) < 0.05) ? `${name} quieta`
      : `${name} a ${side(deg)}${kn != null ? ' ' + Math.abs(kn).toFixed(1) + ' kn' : ''}`;
    // lados opuestos o un extremo quieto: el buque está girando
    // el sentido del giro lo da la velocidad de giro; si es despreciable, el extremo que más cae
    const turnSide = Math.abs(r) >= CFG.rateOk ? r : (Math.abs(b) >= Math.abs(s) ? b : s);
    const rate = Math.abs(r);
    const helm = rate >= 4 ? 20 : rate >= 2 ? 10 : 5;
    return { level, code:'turning', side: side(turnSide),
      text: `Gira a ${side(turnSide)} ${rate.toFixed(1)}°/s: ${part('proa', b, inp.bowKn)}, ${part('popa', s, inp.sternKn)}. Timón a ${opposite(turnSide)} ${helm}.${errTxt}`,
      suggest: { type:'helm', side: opposite(turnSide) === 'babor' ? 'port' : 'starboard', degrees: helm } };
  }

  /* Todo junto, para dibujar y para la voz. */
  function analyze(F, ship, st){
    // st: { u, w, yawRate (rad/s), headingDeg, headingErrDeg?, uGround?, wGround?, azP?, azS? }
    // uGround/wGround: velocidad sobre el fondo en ejes del buque; sin ellos se usa la del agua.
    const n = net(F, ship, st.headingDeg);
    const ends = lateralEnds(F, ship);
    const fall = caida(st.uGround != null ? st.uGround : st.u, st.wGround != null ? st.wGround : st.w, st.yawRate, ship.L);
    const rec = recommend({ bowDeg: fall.bow.deg, sternDeg: fall.stern.deg, bowKn: fall.bow.knots, sternKn: fall.stern.knots,
                            yawDegS: st.yawRate * R2D, cause: ends.cause, headingErrDeg: st.headingErrDeg });
    return { net: n, ends, fall, rec, terminal: terminalSpeed(F, ship), contributions: contributions(F),
             jets: jets(F, ship, { port: st.azP, starboard: st.azS }), thrust: thrustSum(F), chain: chain(F) };
  }

  return { CFG, contributions, endsFrom, net, lateralEnds, caida, jets, thrustSum, chain, terminalSpeed, recommend, analyze, KN };
});
