/* ASD Bridge Simulator: órdenes de puente (rumbo, timón, telégrafo de máquinas).
 *
 * El práctico da la orden; este módulo la convierte en demanda de momento de guiñada (Nd) y de empuje (T0)
 * y la asigna a los dos propulsores azimutales con la lógica interna de los controles (`allocate`).
 * El usuario no maneja azimutales: dice "rumbo 090" o "slow ahead".
 *
 * Módulo puro (sin DOM): se usa en el navegador (`window.ASDOrders`) y en Node (`node --test tests/`).
 * Convenciones del simulador: momento positivo = proa a estribor (rumbo crece); azimut 0 = empuje a proa,
 * 90 = estribor, 180 = popa, 270 = babor. Ejes propios x = proa, y = estribor.
 */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.ASDOrders = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  const D2R = Math.PI/180, R2D = 180/Math.PI;
  const norm360 = d => ((d % 360) + 360) % 360;
  const angDiff = (a, b) => { let d = norm360(a - b); if(d > 180) d -= 360; return d; };   // a - b en (-180, 180]
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad3 = n => String(Math.round(norm360(n))).padStart(3, '0');

  /* Telégrafo de máquinas: fracción del empuje máximo por propulsor y sentido (+1 avante, -1 atrás).
     Ajustable: es la única tabla que define qué significa cada orden. */
  const TELEGRAPH = {
    full_ahead:       { f: 1.00, dir:  1, label:'Full ahead' },
    half_ahead:       { f: 0.55, dir:  1, label:'Half ahead' },
    slow_ahead:       { f: 0.30, dir:  1, label:'Slow ahead' },
    dead_slow_ahead:  { f: 0.15, dir:  1, label:'Dead slow ahead' },
    stop:             { f: 0.00, dir:  1, label:'Stop engines' },
    dead_slow_astern: { f: 0.15, dir: -1, label:'Dead slow astern' },
    slow_astern:      { f: 0.30, dir: -1, label:'Slow astern' },
    half_astern:      { f: 0.55, dir: -1, label:'Half astern' },
    full_astern:      { f: 1.00, dir: -1, label:'Full astern' }
  };

  /* Ventana de "rumbo alcanzado" (informe de cumplimiento) y límites de gobierno. */
  const CFG = {
    reachedDeg: 2,          // |HDG - ordenado| menor que esto
    reachedRate: 0.15,      // |velocidad de giro| menor que esto (°/s)
    reachedSecs: 4,         // durante estos segundos simulados
    maxBiasDeg: 60,         // máximo sesgo común de azimut para gobernar
    helmMax: 35,            // ángulo de timón máximo (órdenes IMO)
    kPsiRefDeg: 35,         // el momento máximo se pide a este error de rumbo
    speedKp: 0.25,          // lazo de velocidad: fracción de potencia por nudo de error
    speedKi: 0.02,          // ... y por nudo y segundo (integral)
    speedBand: 0.3,         // |error| menor que esto (kn) = velocidad alcanzada
    speedSecs: 5            // durante estos segundos simulados
  };

  /* Posiciones del telégrafo ordenadas de atrás a avante (para "aumenta/reduce velocidad" un punto). */
  const LADDER = ['full_astern','half_astern','slow_astern','dead_slow_astern','stop','dead_slow_ahead','slow_ahead','half_ahead','full_ahead'];

  /* ---------- Asignación a los azimutales ----------
     Dado el momento de guiñada pedido Nd (N·m), el empuje por propulsor T0 (N) y el sentido phi (0 o 180°),
     devuelve potencias (0-1 de Tmax por propulsor) y azimutales (grados).
     Primero un sesgo común de azimut (brazo largo, popa): lo que hace un ASD real; lo que sobre, empuje diferencial. */
  function allocate(o){
    if(o.sides) return allocateSides(o);
    const ship = o.ship, Tmax = ship.thrustMax * 0.5;
    const T0 = clamp(o.T0, 0, Tmax);
    const phi = o.phi || 0;                              // 0 avante, 180 atrás
    const cphi = Math.cos(phi * D2R) >= 0 ? 1 : -1;
    const x = ship.longOffset;                           // negativo: propulsores a popa del centro de masa
    const Bef = Math.max(ship.latOffset, 1);
    let Nd = o.Nd || 0;

    let delta = 0;                                       // sesgo común (rad)
    const Ttot = 2 * T0;
    if(Ttot > 1 && Math.abs(Nd) > 0){
      const s = Nd / (x * Ttot * cphi);                  // sin(delta)
      delta = Math.asin(clamp(s, -Math.sin(CFG.maxBiasDeg * D2R), Math.sin(CFG.maxBiasDeg * D2R)));
    }
    const Nbias = x * Ttot * cphi * Math.sin(delta);
    const Nrest = Nd - Nbias;                            // lo que el sesgo no pudo dar

    // Diferencial: más empuje a babor gira a estribor al ir avante (invertido al ir atrás).
    let dT = Nrest / (Bef * cphi);
    const headroom = Math.min(T0, Tmax - T0);
    dT = clamp(dT, -2 * headroom, 2 * headroom);
    const TP = clamp(T0 + dT / 2, 0, Tmax), TS = clamp(T0 - dT / 2, 0, Tmax);

    const az = norm360(phi + delta * R2D);
    return { thrP: TP / Tmax, thrS: TS / Tmax, azP: az, azS: az, biasDeg: delta * R2D };
  }

  /* Orden por motor (P y S distintos): cada propulsor con su empuje y su sentido; el momento de rumbo que se pida
     se suma como sesgo común de azimut (sin(az) = cos(phi)·sin(delta) para phi = 0 o 180). */
  function allocateSides(o){
    const ship = o.ship, Tmax = ship.thrustMax * 0.5, x = ship.longOffset;
    const P = o.sides.P, S = o.sides.S;
    const TP = clamp(P.T0, 0, Tmax), TS = clamp(S.T0, 0, Tmax);
    const cP = Math.cos(P.phi * D2R) >= 0 ? 1 : -1, cS = Math.cos(S.phi * D2R) >= 0 ? 1 : -1;
    const net = TP * cP + TS * cS;
    let delta = 0;
    if(Math.abs(net) > 1 && Math.abs(o.Nd || 0) > 0){
      const sn = o.Nd / (x * net);
      delta = Math.asin(clamp(sn, -Math.sin(CFG.maxBiasDeg * D2R), Math.sin(CFG.maxBiasDeg * D2R)));
    }
    return { thrP: TP / Tmax, thrS: TS / Tmax, azP: norm360(P.phi + delta * R2D), azS: norm360(S.phi + delta * R2D), biasDeg: delta * R2D };
  }

  /* ---------- Leyes de control (mismas ganancias que el piloto automático) ---------- */
  function gains(ship){
    return { Kpsi: ship.maxTorque / (CFG.kPsiRefDeg * D2R), Kr: ship.maxTorque / ship.yawDesign };
  }
  // ePsi y r en rad y rad/s
  function headingLaw(ship, ePsi, r){
    const g = gains(ship);
    return clamp(g.Kpsi * ePsi - g.Kr * r, -ship.maxTorque, ship.maxTorque);
  }
  function rateLaw(ship, rTarget, r){
    const g = gains(ship);
    return clamp(g.Kr * (rTarget - r), -ship.maxTorque, ship.maxTorque);
  }

  /* ---------- Estado y máquina de órdenes ---------- */
  function create(){
    const s = {
      active: false,
      mode: 'heading',          // 'heading' (rumbo ordenado) | 'rate' (timón: velocidad de giro constante)
      hdgTarget: null,          // grados
      rateDegS: 0,              // velocidad de giro objetivo (°/s, + estribor) en modo 'rate'
      helmLabel: '',
      telegraph: 'stop',        // clave del telégrafo, 'hold' = potencia fija (ver seed y power), o 'speed' = lazo de velocidad
      holdF: 0, holdDir: 1,     // potencia (0-1 del máximo) y sentido mantenidos en modo 'hold'
      holdLabel: '',            // etiqueta de la potencia fija ("Power 50%"); vacío = "Hold power"
      engP: null, engS: null,   // órdenes por motor (clave del telégrafo); null = la orden común
      speedKn: null, speedI: 0, speedF: 0, speedSteady: 0, speedReported: true,   // velocidad objetivo (kn, con signo) y estado del lazo
      steady: 0,                // segundos simulados dentro de la ventana de cumplimiento
      reported: true            // ya se informó el rumbo actual
    };

    function activate(){ s.active = true; }
    const entry = () => s.telegraph === 'hold'
      ? { f: s.holdF, dir: s.holdDir, label: s.holdLabel || 'Hold power' }
      : s.telegraph === 'speed'
        ? { f: s.speedF, dir: s.speedKn < 0 ? -1 : 1, label: 'Speed ' + Math.abs(Math.round(s.speedKn * 10) / 10) + ' kn' }
        : TELEGRAPH[s.telegraph];
    const clearSpeed = () => { s.speedKn = null; s.speedI = 0; s.speedF = 0; s.speedSteady = 0; s.speedReported = true; };
    const sideEntry = side => { const k = side === 'P' ? s.engP : s.engS; return k ? TELEGRAPH[k] : entry(); };

    return {
      state: s,
      isActive: () => s.active,
      release(){ s.active = false; s.hdgTarget = null; s.mode = 'heading'; s.rateDegS = 0; s.helmLabel = ''; s.telegraph = 'stop'; s.holdF = 0; s.holdDir = 1; s.holdLabel = ''; s.engP = s.engS = null; clearSpeed(); s.steady = 0; s.reported = true; },

      /* Al pasar de mando manual a una orden de rumbo o timón, la potencia NO cambia: se mantiene tal cual estaba
         hasta que el práctico dé una orden de máquinas. (No inventa ninguna orden de máquinas.) */
      seed(fraction, dir){
        if(s.active) return;
        s.telegraph = 'hold'; s.holdLabel = ''; s.holdF = clamp(Math.abs(fraction || 0), 0, 1); s.holdDir = dir >= 0 ? 1 : -1;
      },

      /* "Steer course 090" / "Navega con rumbo 090" / "Steady on 090" */
      steerCourse(deg){
        activate(); s.mode = 'heading'; s.hdgTarget = norm360(deg); s.rateDegS = 0; s.helmLabel = '';
        s.steady = 0; s.reported = false;
        return { ordered_heading: s.hdgTarget };
      },
      /* "Cae 5 a babor": relativo al rumbo ORDENADO (si no hay, al actual) */
      alterCourse(side, deg, currentHdg){
        const base = (s.active && s.mode === 'heading' && s.hdgTarget != null) ? s.hdgTarget : currentHdg;
        const sgn = side === 'port' ? -1 : 1;
        return this.steerCourse(base + sgn * Math.abs(deg));
      },
      /* Órdenes de timón IMO: velocidad de giro proporcional al ángulo. */
      helm(order, angle, currentHdg, yawRateDegS, shipYawDesignDegS){
        // "Ease to 10": reduce el timón actual a ese ángulo, hacia la misma banda. Sin timón puesto, equivale a "Steady".
        if(order === 'ease'){
          if(s.mode === 'rate' && s.rateDegS !== 0) order = s.rateDegS < 0 ? 'port' : 'starboard'; else order = 'steady';
        }
        // "Nothing to port/starboard": que la proa no vaya más a esa banda. Si ya va (o el timón la lleva) hacia ella, se frena el giro;
        // si no, no hay nada que corregir y se conserva lo ordenado.
        if(order === 'nothing_port' || order === 'nothing_starboard'){
          const sgn = order === 'nothing_port' ? -1 : 1;
          const going = (s.mode === 'rate' && s.rateDegS * sgn > 0) || (yawRateDegS || 0) * sgn > 0.05;
          if(!going) return { no_change: true, ordered_heading: s.hdgTarget };
          order = 'steady';
        }
        // "Midships / a la vía": timón al centro. NO fija un rumbo: la pala queda a cero y el giro se amortigua; el rumbo puede
        // seguir derivando (viento, corriente). "Steady / así" sí mantiene el rumbo al que llegó la proa.
        if(order === 'midships'){
          activate(); s.mode = 'rate'; s.hdgTarget = null; s.rateDegS = 0; s.helmLabel = 'Midships'; s.steady = 0; s.reported = true;
          return { helm_angle: 0, target_rate_deg_s: 0 };
        }
        if(order === 'steady'){
          // Se mantiene el rumbo presente, anticipando 4 s de giro residual.
          const lead = (yawRateDegS || 0) * 4;
          return this.steerCourse(norm360(currentHdg + lead));
        }
        const hard = order === 'hard_port' || order === 'hard_starboard';
        const a = hard ? CFG.helmMax : clamp(angle || 0, 1, CFG.helmMax);
        const sgn = (order === 'port' || order === 'hard_port') ? -1 : 1;
        activate(); s.mode = 'rate'; s.hdgTarget = null;
        s.rateDegS = sgn * (a / CFG.helmMax) * shipYawDesignDegS;
        s.helmLabel = (sgn < 0 ? 'Port ' : 'Starboard ') + (hard ? 'hard' : Math.round(a));
        s.steady = 0; s.reported = true;
        return { helm_angle: sgn * a, target_rate_deg_s: Math.round(s.rateDegS * 10) / 10 };
      },
      /* Telégrafo de máquinas */
      /* Telégrafo. side: 'port' | 'starboard' = solo ese motor; 'both' o nada = los dos (borra las órdenes por motor). */
      engine(order, side){
        if(!TELEGRAPH[order]) return null;
        activate(); clearSpeed();
        if(side === 'port' || side === 'starboard'){
          // el otro motor conserva lo que tenía (si no había orden por motor, la común)
          const other = side === 'port' ? 'S' : 'P', keep = sideEntry(other);
          const keepKey = (side === 'port' ? s.engS : s.engP) || ((s.telegraph === 'hold' || s.telegraph === 'speed') ? fromThrust(keep.f, keep.dir) : s.telegraph);
          s.engP = side === 'port' ? order : keepKey; s.engS = side === 'starboard' ? order : keepKey;
          if(s.engP === s.engS){ s.telegraph = s.engP; s.engP = s.engS = null; }
        } else { s.telegraph = order; s.engP = s.engS = null; }
        return TELEGRAPH[order];
      },
      /* Potencia en porcentaje del máximo ("empuje 50 por ciento"), avante o atrás. */
      power(pct, dir){
        activate(); clearSpeed(); s.engP = s.engS = null;
        s.telegraph = 'hold'; s.holdF = clamp(Math.abs(pct) / 100, 0, 1); s.holdDir = dir < 0 ? -1 : 1; s.holdLabel = 'Power ' + Math.round(clamp(Math.abs(pct), 0, 100)) + '%';
        return { power_pct: Math.round(s.holdF * 100), direction: s.holdDir > 0 ? 'ahead' : 'astern' };
      },
      /* Velocidad objetivo sobre el agua (kn, negativa = atrás): lazo PI sobre la velocidad longitudinal. */
      speed(kn){
        const f0 = Math.min(1, Math.abs(entry().f));
        activate(); s.engP = s.engS = null;
        s.telegraph = 'speed'; s.speedKn = kn; s.speedI = 0; s.speedF = f0; s.speedSteady = 0; s.speedReported = false;
        return { ordered_speed_kn: Math.round(kn * 10) / 10 };
      },
      /* "Aumenta / reduce velocidad": un punto del telégrafo más o menos. */
      engineStep(dir){
        const e = entry(), key = fromThrust(e.f, e.dir), i = LADDER.indexOf(key);
        const ahead = key === 'stop' ? true : e.dir > 0;
        const j = clamp(i + (dir === 'up' ? (ahead ? 1 : -1) : (ahead ? -1 : 1)), 0, LADDER.length - 1);
        return this.engine(LADDER[j]);
      },
      telegraphEntry: entry,
      perSide: () => (s.engP || s.engS) ? { P: sideEntry('P'), S: sideEntry('S') } : null,

      describe(){
        if(!s.active) return '';
        const parts = [];
        if(s.mode === 'heading' && s.hdgTarget != null) parts.push(pad3(s.hdgTarget) + '°');
        else if(s.mode === 'rate' && s.helmLabel) parts.push(s.helmLabel);
        if(s.engP || s.engS) parts.push('P ' + sideEntry('P').label + ' / S ' + sideEntry('S').label); else parts.push(entry().label);
        return parts.join(' · ');
      },

      /* Un paso de control. Devuelve la demanda para `allocate` y los eventos (p. ej. rumbo alcanzado). */
      step(inp){
        // inp: { ship, hdgDeg, yawRateRad (rad/s), dt (s simulados) }
        if(!s.active) return null;
        const ship = inp.ship, r = inp.yawRateRad;
        let Nd = 0;
        if(s.mode === 'heading' && s.hdgTarget != null){
          Nd = headingLaw(ship, angDiff(s.hdgTarget, inp.hdgDeg) * D2R, r);
        } else if(s.mode === 'rate'){
          Nd = rateLaw(ship, s.rateDegS * D2R, r);
        }
        const events = [];
        if(s.telegraph === 'speed' && s.speedKn != null){
          const dirS = s.speedKn < 0 ? -1 : 1, v = (inp.surgeKn == null ? 0 : inp.surgeKn) * dirS, tgt = Math.abs(s.speedKn), err = tgt - v;
          const raw = CFG.speedKp * err + s.speedI;
          if(!(raw >= 1 && err > 0) && !(raw <= 0 && err < 0)) s.speedI = clamp(s.speedI + CFG.speedKi * err * inp.dt, 0, 1);   // sin windup
          s.speedF = clamp(CFG.speedKp * err + s.speedI, 0, 1);
          if(!s.speedReported){
            if(Math.abs(err) < CFG.speedBand) s.speedSteady += inp.dt; else s.speedSteady = 0;
            if(s.speedSteady >= CFG.speedSecs){ s.speedReported = true; events.push({ type: 'speed_achieved', knots: s.speedKn }); }
          }
        }
        const t = entry();
        const T0 = t.f * ship.thrustMax * 0.5;
        const phi = t.dir > 0 ? 0 : 180;
        let sides = null;
        if(s.engP || s.engS){
          const pe = sideEntry('P'), se = sideEntry('S');
          sides = { P: { T0: pe.f * ship.thrustMax * 0.5, phi: pe.dir > 0 ? 0 : 180 }, S: { T0: se.f * ship.thrustMax * 0.5, phi: se.dir > 0 ? 0 : 180 } };
        }

        if(s.mode === 'heading' && s.hdgTarget != null && !s.reported){
          const err = Math.abs(angDiff(s.hdgTarget, inp.hdgDeg));
          if(err < CFG.reachedDeg && Math.abs(r * R2D) < CFG.reachedRate) s.steady += inp.dt; else s.steady = 0;
          if(s.steady >= CFG.reachedSecs){ s.reported = true; events.push({ type:'heading_achieved', heading: s.hdgTarget }); }
        }
        return { Nd, T0, phi, sides, events };
      }
    };
  }

  /* Al pasar de mando manual a órdenes, la orden de máquinas más parecida a la potencia que había
     (así "navega con rumbo 000" no deja el buque sin empuje si ya navegaba). */
  function fromThrust(fraction, dir){
    const f = clamp(Math.abs(fraction || 0), 0, 1);
    if(f < 0.06) return 'stop';
    const ahead = dir >= 0;
    let best = null, bestD = 9;
    Object.keys(TELEGRAPH).forEach(k => {
      const t = TELEGRAPH[k];
      if(t.f === 0 || (t.dir > 0) !== ahead) return;
      const d = Math.abs(t.f - f);
      if(d < bestD){ bestD = d; best = k; }
    });
    return best || 'stop';
  }

  /* Rumbo leído dígito a dígito, como en el puente: 030 = "cero tres cero" / "zero three zero". */
  const DIGITS_ES = ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve'];
  const DIGITS_EN = ['zero','one','two','three','four','five','six','seven','eight','nine'];
  function spokenHeading(deg){
    const d = pad3(deg).split('').map(Number);
    return { digits: pad3(deg), es: d.map(i => DIGITS_ES[i]).join(' '), en: d.map(i => DIGITS_EN[i]).join(' ') };
  }

  /* ---------- Rosa de 16 rumbos (es + en) -> grados ---------- */
  const POINTS = {
    N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5,
    S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5
  };
  const POINT_LIST = Object.keys(POINTS);
  function pointToDeg(p){
    if(typeof p !== 'string') return null;
    let k = p.trim().toUpperCase().replace(/O/g, 'W');   // español: Oeste = West
    return Object.prototype.hasOwnProperty.call(POINTS, k) ? POINTS[k] : null;
  }

  return { TELEGRAPH, LADDER, CFG, fromThrust, spokenHeading, allocate, headingLaw, rateLaw, gains, create, POINTS, POINT_LIST, pointToDeg, norm360, angDiff, pad3 };
});
