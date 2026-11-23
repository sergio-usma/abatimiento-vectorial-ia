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
    kPsiRefDeg: 35          // el momento máximo se pide a este error de rumbo
  };

  /* ---------- Asignación a los azimutales ----------
     Dado el momento de guiñada pedido Nd (N·m), el empuje por propulsor T0 (N) y el sentido phi (0 o 180°),
     devuelve potencias (0-1 de Tmax por propulsor) y azimutales (grados).
     Primero un sesgo común de azimut (brazo largo, popa): lo que hace un ASD real; lo que sobre, empuje diferencial. */
  function allocate(o){
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
      telegraph: 'stop',        // clave del telégrafo, o 'hold' = mantener la potencia que ya había (ver seed)
      holdF: 0, holdDir: 1,     // potencia (0-1 del máximo) y sentido mantenidos en modo 'hold'
      steady: 0,                // segundos simulados dentro de la ventana de cumplimiento
      reported: true            // ya se informó el rumbo actual
    };

    function activate(){ s.active = true; }
    const entry = () => s.telegraph === 'hold'
      ? { f: s.holdF, dir: s.holdDir, label: 'Hold power' }
      : TELEGRAPH[s.telegraph];

    return {
      state: s,
      isActive: () => s.active,
      release(){ s.active = false; s.hdgTarget = null; s.mode = 'heading'; s.rateDegS = 0; s.helmLabel = ''; s.telegraph = 'stop'; s.holdF = 0; s.holdDir = 1; s.steady = 0; s.reported = true; },

      /* Al pasar de mando manual a una orden de rumbo o timón, la potencia NO cambia: se mantiene tal cual estaba
         hasta que el práctico dé una orden de máquinas. (No inventa ninguna orden de máquinas.) */
      seed(fraction, dir){
        if(s.active) return;
        s.telegraph = 'hold'; s.holdF = clamp(Math.abs(fraction || 0), 0, 1); s.holdDir = dir >= 0 ? 1 : -1;
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
        if(order === 'midships' || order === 'steady'){
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
      engine(order){
        if(!TELEGRAPH[order]) return null;
        activate(); s.telegraph = order;
        return TELEGRAPH[order];
      },
      telegraphEntry: entry,

      describe(){
        if(!s.active) return '';
        const parts = [];
        if(s.mode === 'heading' && s.hdgTarget != null) parts.push(pad3(s.hdgTarget) + '°');
        else if(s.mode === 'rate' && s.helmLabel) parts.push(s.helmLabel);
        parts.push(entry().label);
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
        const t = entry();
        const T0 = t.f * ship.thrustMax * 0.5;
        const phi = t.dir > 0 ? 0 : 180;

        const events = [];
        if(s.mode === 'heading' && s.hdgTarget != null && !s.reported){
          const err = Math.abs(angDiff(s.hdgTarget, inp.hdgDeg));
          if(err < CFG.reachedDeg && Math.abs(r * R2D) < CFG.reachedRate) s.steady += inp.dt; else s.steady = 0;
          if(s.steady >= CFG.reachedSecs){ s.reported = true; events.push({ type:'heading_achieved', heading: s.hdgTarget }); }
        }
        return { Nd, T0, phi, events };
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

  return { TELEGRAPH, CFG, fromThrust, spokenHeading, allocate, headingLaw, rateLaw, gains, create, POINTS, POINT_LIST, pointToDeg, norm360, angDiff, pad3 };
});
