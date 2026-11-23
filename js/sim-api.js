/* ASD Bridge Simulator: fachada SimAPI.
 *
 * Única superficie que usan las herramientas de voz para actuar sobre el simulador.
 * Reutiliza las funciones y controles de index.html (cargado antes que este archivo).
 * Las órdenes de puente (rumbo, timón, máquinas) pasan por el motor de js/orders.js: el usuario no
 * maneja azimutales; el simulador los resuelve con la lógica interna de los controles.
 * Todas las operaciones devuelven { status:'ok'|'error', message, ... } con mensajes cortos en español.
 */
(function(){
  'use strict';

  const ok = (message, extra) => Object.assign({ status:'ok', message }, extra || {});
  const fail = (error, message) => ({ status:'error', error, message: message || error });
  const norm = d => ((d % 360) + 360) % 360;
  const byId = id => document.getElementById(id);
  const pad3 = d => String(Math.round(norm(d))).padStart(3, '0');
  const curHdg = () => norm(estado.heading * 180 / Math.PI);
  const r1 = v => Math.round(v * 10) / 10;

  function setInput(id, v){ const el = byId(id); if(el){ el.value = v; el.dispatchEvent(new Event('input', { bubbles:true })); } }
  function num(id){ return parseFloat(byId(id).value) || 0; }

  function toDMS(dec, isLat){
    const hemi = isLat ? (dec >= 0 ? 'N' : 'S') : (dec >= 0 ? 'E' : 'W');
    const a = Math.abs(dec);
    const dd = Math.floor(a), mmF = (a - dd) * 60, mm = Math.floor(mmF), ss = (mmF - mm) * 60;
    const pad = (n, w) => String(n).padStart(w, '0');
    return pad(dd, isLat ? 2 : 3) + pad(mm, 2) + pad(ss.toFixed(1), 4) + hemi;
  }

  /* Estado que el modelo necesita tras una orden de rumbo o máquinas. */
  function orderState(){
    const o = getOrdenes(), s = o.state;
    return {
      ordered_heading: s.mode === 'heading' && s.hdgTarget != null ? Math.round(s.hdgTarget) : null,
      engine_order: o.telegraphEntry().label,
      current_heading: Math.round(curHdg()),
      simulation_running: !!estado.simActiva
    };
  }
  function hint(res){
    const o = getOrdenes(), s = o.state;
    if(s.telegraph === 'stop' && s.mode === 'heading') res.warning = 'Máquinas paradas: sin empuje el buque no gobierna. Pide una orden de máquinas.';
    if(!estado.simActiva) res.note = 'La simulación está en pausa: la orden queda registrada y actuará al iniciar.';
    return res;
  }

  /* Primera orden desde el mando manual: se hereda la potencia que había como orden de máquinas. */
  function inheritEngine(){
    const o = getOrdenes();
    if(o.isActive()) return;
    const f = Math.max(estado.thrP, estado.thrS);
    const ahead = Math.cos(estado.azP * Math.PI / 180) >= 0;
    o.engine(ASDOrders.fromThrust(f, ahead ? 1 : -1));
  }

  const SimAPI = {
    /* ---------- Órdenes de puente ---------- */
    steerCourse(deg){
      inheritEngine();
      const info = getOrdenes().steerCourse(deg);
      ordenesAplicar();
      return ok(`Rumbo ${pad3(deg)}`, hint(Object.assign(orderState(), info)));
    },
    alterCourse(side, deg){
      inheritEngine();
      const info = getOrdenes().alterCourse(side, deg, curHdg());
      ordenesAplicar();
      return ok(`Cae ${Math.round(deg)} grados a ${side === 'port' ? 'babor' : 'estribor'}: nuevo rumbo ${pad3(info.ordered_heading)}`, hint(Object.assign(orderState(), info)));
    },
    helm(order, angle){
      const yd = (typeof ship !== 'undefined' && ship) ? ship.yawDesign * 180 / Math.PI : 8;
      inheritEngine();
      const info = getOrdenes().helm(order, angle, curHdg(), estado.yawRate * 180 / Math.PI, yd);
      ordenesAplicar();
      const txt = info.helm_angle != null ? `Timón ${info.helm_angle < 0 ? 'a babor' : 'a estribor'} ${Math.abs(info.helm_angle)}` : `Así, rumbo ${pad3(info.ordered_heading)}`;
      return ok(txt, hint(Object.assign(orderState(), info)));
    },
    engine(order){
      const entry = getOrdenes().engine(order);
      if(!entry) return fail('bad_args', 'Orden de máquinas desconocida.');
      ordenesAplicar();
      if(window.ASDAudio) ASDAudio.play('telegraph');
      return ok(entry.label, hint(orderState()));
    },
    allStop(){
      altoGeneral();
      return ok('Alto general: máquinas a stop', ordenesActivas() ? orderState() : { simulation_running: !!estado.simActiva });
    },
    manualControl(){
      if(estado.autopilot) toggleAutopilot();
      ordenesLiberar();
      return ok('Control manual: órdenes canceladas');
    },
    setAutopilot(on){
      if(on){
        if(!estado.ruta || estado.ruta.length === 0) return fail('no_route', 'No hay derrota trazada. Traza al menos un punto.');
        if(!estado.autopilot) toggleAutopilot();     // toggleAutopilot libera las órdenes de puente
        return ok('Piloto automático activado: órdenes de rumbo y máquinas canceladas');
      }
      if(estado.autopilot) toggleAutopilot();
      return ok('Piloto automático desactivado');
    },

    /* ---------- Simulación y ambiente ---------- */
    simControl(action){
      if(action === 'start'){ iniciarSim(); return ok('Simulación iniciada'); }
      if(action === 'pause'){ pausarSim(); return ok('Simulación en pausa'); }
      if(action === 'reset'){ resetSim(); return ok('Simulación reiniciada'); }
      return fail('bad_args');
    },
    setSimSpeed(v){ const el = byId('simSpeed'); if(el) el.value = String(v); },

    setWind({ fromDeg, knots, deltaKnots }){
      let kn = knots;
      if(kn == null && deltaKnots != null) kn = Math.min(60, Math.max(0, num('vFuerza') + deltaKnots));
      if(fromDeg != null) setInput('vDir', Math.round(fromDeg));
      if(kn != null) setInput('vFuerza', r1(kn));
      actualizarCorrienteAuto();
      return { knots: num('vFuerza'), from_deg: num('vDir') };
    },
    setCurrent({ linked, toDeg, knots, deltaKnots }){
      const chk = byId('corrienteAuto');
      if(linked){ chk.checked = true; actualizarCorrienteAuto(); return { knots: num('cFuerza'), toward_deg: num('cDir') }; }
      chk.checked = false; actualizarCorrienteAuto();
      let kn = knots;
      if(kn == null && deltaKnots != null) kn = Math.min(6, Math.max(0, num('cFuerza') + deltaKnots));
      if(toDeg != null) setInput('cDir', Math.round(toDeg));
      if(kn != null) setInput('cFuerza', Math.round(kn * 100) / 100);
      return { knots: num('cFuerza'), toward_deg: num('cDir') };
    },
    setSea({ hs, tide }){
      if(hs != null){ setInput('olaHs', hs); dibujarOlas(); }
      if(tide != null) setInput('marea', tide);
    },

    insideChart(lat, lon){ return puntoDentroCarta(lat, lon); },
    route(action, lat, lon){
      if(action === 'start_drawing'){ if(!estado.rutaMode) toggleRutaMode(); return ok('Traza puntos con clic en la carta'); }
      if(action === 'stop_drawing'){ if(estado.rutaMode) toggleRutaMode(); return ok('Trazado terminado'); }
      if(action === 'add_waypoint'){
        if(!puntoDentroCarta(lat, lon)) return fail('outside_chart', 'Ese punto está fuera de la carta.');
        estado.ruta.push({ lat, lon }); redibujarRuta();
        return ok(`Punto ${estado.ruta.length} añadido a la derrota`);
      }
      if(action === 'clear'){ borrarRuta(); return ok('Derrota borrada'); }
      return fail('bad_args');
    },
    placeVessel(lat, lon){
      if(!puntoDentroCarta(lat, lon)) return fail('outside_chart', 'Esa posición está fuera de la carta.');
      byId('latDMS').value = toDMS(lat, true);
      byId('lonDMS').value = toDMS(lon, false);
      ubicarBuque();
      return ok('Buque ubicado');
    },

    ui({ panel, visible, chart, rose }){
      const done = [];
      if(panel){
        const id = panel === 'left' ? 'panelBuque' : 'panelTelemetria';
        const hidden = byId(id).classList.contains('collapsed');
        const wantVisible = visible !== false;
        if(hidden === wantVisible) togglePanel(id);
        done.push(`Panel ${panel === 'left' ? 'izquierdo' : 'derecho'} ${wantVisible ? 'visible' : 'oculto'}`);
      }
      if(chart){ setChartTab(chart); done.push(chart === 'abat' ? 'Gráfica de abatimiento' : 'Perfil batimétrico'); }
      if(rose){ toggleRosa(rose === 'open'); done.push(rose === 'open' ? 'Rosa abierta' : 'Rosa cerrada'); }
      return done.length ? ok(done.join(', ')) : fail('bad_args', 'Indica panel, gráfica o rosa.');
    },

    getStatus(){
      const n = estado.nav || null, amb = leerAmbiente(), g = estado.guia, o = getOrdenes();
      const ukc = n ? n.ukc : null;
      const alerts = [];
      if(ukc != null){
        if(ukc < 0) alerts.push('encallado');
        else if(ukc < 1.5) alerts.push('UKC crítico');
        else if(ukc < 3) alerts.push('UKC bajo');
      }
      return {
        simulation: estado.simActiva ? 'activa' : 'en pausa',
        mode: estado.autopilot ? 'piloto automático' : (o.isActive() ? 'órdenes de puente' : (estado.manual ? 'manual' : 'deriva libre')),
        heading_deg: Math.round(curHdg()),
        ordered_heading_deg: (o.isActive() && o.state.mode === 'heading' && o.state.hdgTarget != null) ? Math.round(o.state.hdgTarget) : null,
        engine_order: o.isActive() ? o.telegraphEntry().label : null,
        rate_of_turn_deg_s: r1(estado.yawRate * 180 / Math.PI),
        nav: n ? { cog_deg: Math.round(n.cog), stw_kn: r1(n.stw), sog_kn: r1(n.sog), leeway_deg: r1(n.abat), total_drift_deg: r1(n.deriva), depth_m: r1(n.prof), ukc_m: r1(n.ukc) }
               : 'sin datos: la simulación aún no ha corrido',
        environment: { wind_from_deg: amb.vDirFrom, wind_kn: amb.vKn, current_toward_deg: amb.cDirTo, current_kn: amb.cKn, hs_m: amb.olaHs, tide_m: amb.marea },
        route: g ? { waypoint: `${g.wpNum} de ${g.totalWp}`, distance_nm: r1(g.distWP / 1852), bearing_deg: Math.round(g.bearingWP), cts_deg: Math.round(g.CTS), cross_track_m: Math.round(g.xte) }
                 : (estado.ruta && estado.ruta.length ? `${estado.ruta.length} puntos trazados, sin guiado activo` : 'sin derrota'),
        alerts
      };
    }
  };

  /* ---------- Hooks: sonido ---------- */
  function wrap(name, after){
    const orig = window[name];
    if(typeof orig !== 'function') return;
    window[name] = function(){
      const before = after.before ? after.before() : undefined;
      const r = orig.apply(this, arguments);
      after.run(before, arguments);
      return r;
    };
  }
  const A = () => window.ASDAudio;
  wrap('iniciarSim', { run(){ A() && A().play('simStart'); } });
  wrap('pausarSim',  { run(){ A() && A().play('simPause'); } });
  wrap('toggleAutopilot', { before:()=>estado.autopilot, run(b){ if(!A()) return; if(estado.autopilot !== b) A().play(estado.autopilot ? 'autoOn' : 'autoOff'); } });
  wrap('verificarEncallamiento', { run(_, args){ A() && A().onUkc(args[0]); } });
  wrap('cerrarCrash', { run(){ A() && A().onUkc(99); } });

  window.SimAPI = SimAPI;
})();
