/* ASD Bridge Simulator: herramientas (function calling) para el modelo de voz.
 *
 * El usuario es el práctico y da órdenes de puente normalizadas (IMO SMCP, español e inglés):
 * rumbo, timón, máquinas, ambiente. El simulador resuelve internamente los azimutales.
 *
 * Módulo puro: no toca el DOM. Recibe una fachada `sim` (ver sim-api.js) y devuelve
 *   { definitions, execute(name, args), confirmPending(), cancelPending(), getPending(), noteUserTurn() }.
 * Se prueba con Node (`node --test tests/`).
 */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoiceTools = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  const CONFIRM_TTL_MS = 15000;
  const POINTS = { N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5, S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5 };
  const POINT_ENUM = Object.keys(POINTS);
  const ENGINE_ORDERS = ['full_ahead','half_ahead','slow_ahead','dead_slow_ahead','stop','dead_slow_astern','slow_astern','half_astern','full_astern'];
  const HELM_ORDERS = ['port','starboard','hard_port','hard_starboard','midships','steady'];

  const POINT_PROP = { type:'string', enum:POINT_ENUM, description:'Punto cardinal (N, NE, E, SE, S, SW, W, NW y los intermedios NNE, ENE…). "Oeste" = W, "Este" = E.' };

  const definitions = [
    { type:'function', name:'steer_course',
      description:'Orden de rumbo: gobernar a un rumbo (HDG) en grados verdaderos 0-359. "Navega con rumbo 090", "Así, rumbo 000", "Steer course 090", "Steady on 270". Los rumbos se dicen con tres dígitos ("cero nueve cero" = 90).',
      parameters:{ type:'object', properties:{ degrees:{ type:'number', minimum:0, maximum:359 } }, required:['degrees'] } },
    { type:'function', name:'alter_course',
      description:'Cambio de rumbo relativo, respecto al rumbo ordenado (o al actual si no hay orden). "Cae 5 grados a babor", "Caiga 10 a estribor", "Alter course 5 degrees to port". side: port = babor, starboard = estribor.',
      parameters:{ type:'object', properties:{ side:{ type:'string', enum:['port','starboard'] }, degrees:{ type:'number', minimum:1, maximum:180 } }, required:['side','degrees'] } },
    { type:'function', name:'helm_order',
      description:'Orden de timón estándar IMO: "Diez a babor" / "Port ten" (angle 10), "Veinte a estribor", "Todo a babor" / "Hard to port", "Timón a la vía" / "Midships", "Así" / "Steady" (mantener el rumbo actual). Para "Steady on 090" o "Así, rumbo 090" usa steer_course.',
      parameters:{ type:'object', properties:{ order:{ type:'string', enum:HELM_ORDERS }, angle:{ type:'number', minimum:1, maximum:35, description:'Grados de timón (5, 10, 15, 20, 25, 30). Obligatorio con port/starboard.' } }, required:['order'] } },
    { type:'function', name:'engine_order',
      description:'Telégrafo de máquinas: full_ahead (full avante, avante toda), half_ahead (media avante), slow_ahead (poca avante), dead_slow_ahead (muy poca avante), stop (para máquinas, stop engines), dead_slow_astern, slow_astern (poca atrás), half_astern (media atrás), full_astern (full atrás).',
      parameters:{ type:'object', properties:{ order:{ type:'string', enum:ENGINE_ORDERS } }, required:['order'] } },
    { type:'function', name:'all_stop',
      description:'Alto general: máquinas a stop. Conserva el rumbo ordenado.',
      parameters:{ type:'object', properties:{} } },
    { type:'function', name:'manual_control',
      description:'El práctico toma el control manual: se cancelan las órdenes de rumbo y máquinas y el piloto automático. "Control manual", "Take the con", "Cancela las órdenes".',
      parameters:{ type:'object', properties:{} } },
    { type:'function', name:'set_wind',
      description:'Viento. Siempre se da por DE DÓNDE viene: "por el Este", "del noreste", "from 045" = desde. Fija intensidad con knots ("a 40 nudos") o la cambia con delta_knots ("aumenta 5", "reduce 3"). Dirección con from_deg (0-359) o from_point.',
      parameters:{ type:'object', properties:{ from_deg:{ type:'number', minimum:0, maximum:359 }, from_point:POINT_PROP, knots:{ type:'number', minimum:0, maximum:60 }, delta_knots:{ type:'number', minimum:-60, maximum:60 } } } },
    { type:'function', name:'set_current',
      description:'Corriente. "Por el 003" / "from 003" = DESDE el 003 (from_deg o from_point). "Hacia el 180" / "setting 180" = hacia (toward_deg). knots fija la intensidad; delta_knots la incrementa o reduce ("incrementa corriente en 0.5"). linked_to_wind=true la deriva del viento.',
      parameters:{ type:'object', properties:{ from_deg:{ type:'number', minimum:0, maximum:359 }, from_point:POINT_PROP, toward_deg:{ type:'number', minimum:0, maximum:359 }, toward_point:POINT_PROP, knots:{ type:'number', minimum:0, maximum:6 }, delta_knots:{ type:'number', minimum:-6, maximum:6 }, linked_to_wind:{ type:'boolean' } } } },
    { type:'function', name:'set_sea',
      description:'Estado del mar: altura significativa de ola Hs en metros y marea en metros.',
      parameters:{ type:'object', properties:{ hs_m:{ type:'number', minimum:0, maximum:6 }, tide_m:{ type:'number', minimum:-2, maximum:3 } } } },
    { type:'function', name:'set_autopilot',
      description:'Piloto automático que sigue la derrota trazada ("sigue la derrota", "follow the route"). Necesita una derrota. Reemplaza las órdenes de rumbo y máquinas.',
      parameters:{ type:'object', properties:{ on:{ type:'boolean' } }, required:['on'] } },
    { type:'function', name:'sim_control',
      description:'Controla la simulación: start (iniciar), pause (pausar) o reset (reiniciar todo; exige confirmación).',
      parameters:{ type:'object', properties:{ action:{ type:'string', enum:['start','pause','reset'] } }, required:['action'] } },
    { type:'function', name:'set_sim_speed',
      description:'Velocidad de la simulación: 1, 5, 15 o 40 veces.',
      parameters:{ type:'object', properties:{ speed:{ type:'number', enum:[1,5,15,40] } }, required:['speed'] } },
    { type:'function', name:'route',
      description:'Derrota: start_drawing / stop_drawing (el usuario traza puntos con clic), add_waypoint (lat, lon en grados decimales, oeste negativo) o clear (borrar; exige confirmación).',
      parameters:{ type:'object', properties:{ action:{ type:'string', enum:['start_drawing','stop_drawing','add_waypoint','clear'] }, lat:{ type:'number' }, lon:{ type:'number' } }, required:['action'] } },
    { type:'function', name:'place_vessel',
      description:'Ubica el buque en la carta (lat, lon en grados decimales, oeste negativo). Reinicia el rastro; exige confirmación.',
      parameters:{ type:'object', properties:{ lat:{ type:'number' }, lon:{ type:'number' } }, required:['lat','lon'] } },
    { type:'function', name:'ui',
      description:'Vista: mostrar/ocultar paneles (left = configuración, right = telemetría), pestaña de gráficas (abat o batim), rosa de los vientos (open/close).',
      parameters:{ type:'object', properties:{ panel:{ type:'string', enum:['left','right'] }, visible:{ type:'boolean' }, chart:{ type:'string', enum:['abat','batim'] }, rose:{ type:'string', enum:['open','close'] } } } },
    { type:'function', name:'get_status',
      description:'Lee el estado: rumbo actual y ordenado, orden de máquinas, velocidades, abatimiento, profundidad, UKC, derrota y alarmas. Úsala para cualquier pregunta sobre el estado ("¿cuál es el rumbo?", "report status"); no inventes valores.',
      parameters:{ type:'object', properties:{} } },
    { type:'function', name:'confirm_action',
      description:'Ejecuta la acción crítica pendiente SOLO después de que el usuario diga "confirmo", "sí, hazlo", "confirm" o equivalente. Pasa el token recibido.',
      parameters:{ type:'object', properties:{ token:{ type:'string' } }, required:['token'] } }
  ];

  const CRITICAL = {
    sim_reset:    () => 'Reiniciar toda la simulación',
    route_clear:  () => 'Borrar la derrota trazada',
    place_vessel: a  => `Ubicar el buque en ${(+a.lat).toFixed(4)}, ${(+a.lon).toFixed(4)}`
  };

  const isNum = v => typeof v === 'number' && isFinite(v);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const norm360 = d => ((d % 360) + 360) % 360;
  const pad3 = d => String(Math.round(norm360(d))).padStart(3, '0');

  /* Dirección a grados desde from_deg / from_point (o toward_*). null si no se dio ninguna. */
  function dirOf(a, degKey, pointKey){
    if(isNum(a[degKey])) return norm360(a[degKey]);
    if(typeof a[pointKey] === 'string'){
      const k = a[pointKey].trim().toUpperCase().replace(/O/g, 'W');
      if(k in POINTS) return POINTS[k];
    }
    return null;
  }

  function create(sim, opts){
    opts = opts || {};
    const now = opts.now || (() => Date.now());
    let pending = null, counter = 0, userTurns = 0;

    const ok = (message, extra) => Object.assign({ status:'ok', message }, extra || {});
    const fail = (error, message) => ({ status:'error', error, message: message || error });

    function needConfirm(key, name, args){
      const token = 'c' + (++counter) + '_' + Math.random().toString(36).slice(2, 6);
      pending = { token, key, name, args, turn: userTurns, expires: now() + CONFIRM_TTL_MS, summary: CRITICAL[key](args) };
      return { status:'needs_confirmation', token, summary: pending.summary, message:`Pide confirmación al usuario: "${pending.summary}". Espera su "confirmo".` };
    }
    function runCritical(p){
      if(p.key === 'sim_reset') return sim.simControl('reset');
      if(p.key === 'route_clear') return sim.route('clear');
      if(p.key === 'place_vessel') return sim.placeVessel(p.args.lat, p.args.lon);
      return fail('unknown_critical');
    }

    const handlers = {
      steer_course(a){
        if(!isNum(a.degrees)) return fail('bad_args', 'Indica el rumbo en grados (000-359).');
        return sim.steerCourse(norm360(a.degrees));
      },
      alter_course(a){
        if((a.side !== 'port' && a.side !== 'starboard') || !isNum(a.degrees)) return fail('bad_args', 'Indica banda (babor o estribor) y grados.');
        return sim.alterCourse(a.side, clamp(Math.abs(a.degrees), 1, 180));
      },
      helm_order(a){
        if(!HELM_ORDERS.includes(a.order)) return fail('bad_args');
        if((a.order === 'port' || a.order === 'starboard') && !isNum(a.angle)) return fail('bad_args', 'Indica los grados de timón (por ejemplo, diez a babor).');
        return sim.helm(a.order, isNum(a.angle) ? clamp(a.angle, 1, 35) : null);
      },
      engine_order(a){
        if(!ENGINE_ORDERS.includes(a.order)) return fail('bad_args', 'Orden de máquinas desconocida.');
        return sim.engine(a.order);
      },
      all_stop(){ return sim.allStop(); },
      manual_control(){ return sim.manualControl(); },
      set_wind(a){
        const from = dirOf(a, 'from_deg', 'from_point');
        const hasKn = isNum(a.knots), hasDelta = isNum(a.delta_knots);
        if(from === null && !hasKn && !hasDelta) return fail('bad_args', 'Indica dirección o intensidad del viento.');
        const r = {};
        if(from !== null) r.fromDeg = from;
        if(hasKn) r.knots = clamp(a.knots, 0, 60);
        else if(hasDelta) r.deltaKnots = clamp(a.delta_knots, -60, 60);
        const res = sim.setWind(r) || {};
        const kn = res.knots != null ? res.knots : r.knots;
        return ok(`Viento ${from !== null ? 'desde el ' + pad3(from) + ' ' : ''}${kn != null ? Math.round(kn) + ' nudos' : ''}`.trim(), res);
      },
      set_current(a){
        if(a.linked_to_wind === true){ sim.setCurrent({ linked:true }); return ok('Corriente ligada al viento'); }
        const from = dirOf(a, 'from_deg', 'from_point');
        const toward = dirOf(a, 'toward_deg', 'toward_point');
        const hasKn = isNum(a.knots), hasDelta = isNum(a.delta_knots);
        if(from === null && toward === null && !hasKn && !hasDelta) return fail('bad_args', 'Indica dirección o intensidad de la corriente.');
        const r = { linked:false };
        if(toward !== null) r.toDeg = toward;
        else if(from !== null) r.toDeg = norm360(from + 180);        // "por el 003" = desde 003 = hacia 183
        if(hasKn) r.knots = clamp(a.knots, 0, 6);
        else if(hasDelta) r.deltaKnots = clamp(a.delta_knots, -6, 6);
        const res = sim.setCurrent(r) || {};
        const kn = res.knots != null ? res.knots : r.knots;
        const dirTxt = from !== null ? `desde el ${pad3(from)} ` : (toward !== null ? `hacia el ${pad3(toward)} ` : '');
        return ok(`Corriente ${dirTxt}${kn != null ? kn.toFixed(1) + ' nudos' : ''}`.trim(), res);
      },
      set_sea(a){
        if(!isNum(a.hs_m) && !isNum(a.tide_m)) return fail('bad_args');
        const r = {}; if(isNum(a.hs_m)) r.hs = clamp(a.hs_m, 0, 6); if(isNum(a.tide_m)) r.tide = clamp(a.tide_m, -2, 3);
        sim.setSea(r);
        return ok(`Mar ${r.hs != null ? 'Hs ' + r.hs.toFixed(1) + ' m ' : ''}${r.tide != null ? 'marea ' + r.tide.toFixed(1) + ' m' : ''}`.trim());
      },
      set_autopilot(a){
        if(typeof a.on !== 'boolean') return fail('bad_args');
        return sim.setAutopilot(a.on);
      },
      sim_control(a){
        if(a.action === 'start' || a.action === 'pause') return sim.simControl(a.action);
        if(a.action === 'reset') return needConfirm('sim_reset', 'sim_control', a);
        return fail('bad_args');
      },
      set_sim_speed(a){
        if(![1,5,15,40].includes(a.speed)) return fail('bad_args', 'Velocidades válidas: 1, 5, 15 o 40.');
        sim.setSimSpeed(a.speed); return ok(`Simulación a ${a.speed} equis`);
      },
      route(a){
        if(a.action === 'clear') return needConfirm('route_clear', 'route', a);
        if(a.action === 'add_waypoint'){
          if(!isNum(a.lat) || !isNum(a.lon)) return fail('bad_args', 'Faltan latitud y longitud.');
          return sim.route('add_waypoint', a.lat, a.lon);
        }
        if(a.action === 'start_drawing' || a.action === 'stop_drawing') return sim.route(a.action);
        return fail('bad_args');
      },
      place_vessel(a){
        if(!isNum(a.lat) || !isNum(a.lon)) return fail('bad_args', 'Faltan latitud y longitud.');
        if(sim.insideChart && !sim.insideChart(a.lat, a.lon)) return fail('outside_chart', 'Esa posición está fuera de la carta.');
        return needConfirm('place_vessel', 'place_vessel', a);
      },
      ui(a){ return sim.ui(a); },
      get_status(){ return Object.assign({ status:'ok' }, sim.getStatus()); },
      confirm_action(a){
        if(!pending) return fail('no_pending', 'No hay ninguna acción pendiente de confirmar.');
        if(now() > pending.expires){ pending = null; return fail('expired', 'La confirmación caducó. Repite la orden.'); }
        if(a.token !== pending.token) return fail('bad_token', 'Token de confirmación inválido.');
        if(userTurns === pending.turn) return fail('needs_user_reply', 'Aún no has preguntado al usuario. Pide confirmación y espera su respuesta antes de confirmar.');
        const p = pending; pending = null;
        return runCritical(p);
      }
    };

    function execute(name, args){
      args = args || {};
      const h = handlers[name];
      if(!h) return fail('unknown_tool', 'Herramienta desconocida: ' + name);
      if(name !== 'confirm_action' && pending) pending = null;   // cualquier otra orden descarta la confirmación pendiente
      try{ return h(args); }
      catch(e){ return fail('exception', String(e && e.message || e)); }
    }
    function getPending(){
      if(pending && now() > pending.expires) pending = null;
      return pending ? { token: pending.token, summary: pending.summary } : null;
    }
    function confirmPending(){   // botón "Sí" en pantalla: la pulsación ya es la confirmación del usuario
      const p = getPending(); if(!p) return fail('no_pending', 'Nada pendiente.');
      const q = pending; pending = null;
      return runCritical(q);
    }
    function cancelPending(){ pending = null; }
    function noteUserTurn(){ userTurns++; }

    return { definitions, execute, getPending, confirmPending, cancelPending, noteUserTurn };
  }

  return { create, definitions, CONFIRM_TTL_MS, POINTS };
});
