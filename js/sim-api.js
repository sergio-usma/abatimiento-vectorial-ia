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

  /* Rumbo leído dígito a dígito (030 = "cero tres cero"); el modelo debe usar `spoken` tal cual. */
  const spoken = d => { const k = ASDOrders.spokenHeading(d); return { es:k.es, en:k.en }; };

  /* Estado que el modelo necesita tras una orden de rumbo o máquinas. */
  function orderState(){
    const o = getOrdenes(), s = o.state;
    const ordered = s.mode === 'heading' && s.hdgTarget != null ? s.hdgTarget : null;
    return {
      ordered_heading: ordered != null ? Math.round(ordered) : null,
      ordered_heading_spoken: ordered != null ? spoken(ordered) : null,
      engine_order: o.telegraphEntry().label,
      current_heading: Math.round(curHdg()),
      current_heading_spoken: spoken(curHdg()),
      simulation_running: !!estado.simActiva
    };
  }
  function hint(res){
    const o = getOrdenes(), s = o.state;
    if(o.telegraphEntry().f === 0 && s.mode === 'heading'){ res.warning = 'Máquinas paradas: sin empuje el buque no gobierna. Pide una orden de máquinas.'; res.warning_code = 'engines_stopped'; }
    if(!estado.simActiva){ res.note = 'La simulación está en pausa: la orden queda registrada y actuará al iniciar.'; res.note_code = 'sim_paused'; }
    return res;
  }

  /* Las órdenes de puente las da el práctico y solo él. Si el piloto automático gobierna o los propulsores están
     inactivos (deriva libre), la orden NO se ejecuta ni cambia el modo por su cuenta: se informa y ya. */
  function gate(){
    if(estado.autopilot) return fail('autopilot_active', 'Piloto automático activo: no ejecuto la orden. Ordene control manual para darla.');
    if(!estado.manual) return fail('free_drift', 'Gobierno en deriva libre: los propulsores están inactivos. Active el modo Manual para dar órdenes.');
    return null;
  }

  /* Primera orden de rumbo o timón desde el mando manual: la potencia se mantiene tal cual, sin inventar una orden de máquinas. */
  function holdPower(){
    const o = getOrdenes();
    if(o.isActive()) return;
    const ahead = Math.cos(estado.azP * Math.PI / 180) >= 0;
    o.seed(Math.max(estado.thrP, estado.thrS), ahead ? 1 : -1);
  }

  const SimAPI = {
    /* ---------- Órdenes de puente ---------- */
    steerCourse(deg){
      const g = gate(); if(g) return g;
      holdPower();
      const info = getOrdenes().steerCourse(deg);
      getOrdenes().state.startErr = Math.abs(ASDOrders.angDiff(deg, curHdg()));   // para el anillo de progreso
      ordenesAplicar();
      return ok(`Rumbo ${spoken(deg).es}`, hint(Object.assign(orderState(), info)));
    },
    alterCourse(side, deg){
      const g = gate(); if(g) return g;
      holdPower();
      const info = getOrdenes().alterCourse(side, deg, curHdg());
      getOrdenes().state.startErr = Math.abs(ASDOrders.angDiff(info.ordered_heading, curHdg()));
      ordenesAplicar();
      return ok(`Cae ${Math.round(deg)} grados a ${side === 'port' ? 'babor' : 'estribor'}: nuevo rumbo ${spoken(info.ordered_heading).es}`, hint(Object.assign(orderState(), info)));
    },
    helm(order, angle){
      const g = gate(); if(g) return g;
      const yd = (typeof ship !== 'undefined' && ship) ? ship.yawDesign * 180 / Math.PI : 8;
      holdPower();
      const info = getOrdenes().helm(order, angle, curHdg(), estado.yawRate * 180 / Math.PI, yd);
      ordenesAplicar();
      if(info.no_change) return ok('Nada que corregir', orderState());
      const txt = info.helm_angle === 0 ? 'Timón a la vía' : info.helm_angle != null ? `Timón ${info.helm_angle < 0 ? 'a babor' : 'a estribor'} ${Math.abs(info.helm_angle)}` : `Rumbo ${spoken(info.ordered_heading).es}`;
      return ok(txt, hint(Object.assign(orderState(), info)));
    },
    engine(order, side){
      const g = gate(); if(g) return g;
      const entry = getOrdenes().engine(order, side);
      if(!entry) return fail('bad_args', 'Orden de máquinas desconocida.');
      ordenesAplicar();
      if(window.ASDAudio) ASDAudio.play('telegraph');
      return ok(entry.label, hint(orderState()));
    },
    /* Velocidad objetivo sobre el agua (kn; negativa = atrás). */
    speed(kn){
      const g = gate(); if(g) return g;
      getOrdenes().speed(kn);
      ordenesAplicar();
      if(window.ASDAudio) ASDAudio.play('telegraph');
      return ok(`Velocidad ${Math.abs(Math.round(kn * 10) / 10)} nudos${kn < 0 ? ' atrás' : ''}`, hint(Object.assign(orderState(), { ordered_speed_kn: Math.round(kn * 10) / 10 })));
    },
    speedDelta(delta){
      const g = gate(); if(g) return g;
      const o = getOrdenes(), n = estado.nav, cur = (o.state.telegraph === 'speed' && o.state.speedKn != null) ? o.state.speedKn : (n ? n.stw : 0);
      const target = Math.max(0, Math.min(20, cur + delta));
      return SimAPI.speed(Math.round(target * 10) / 10);
    },
    power(pct, dir){
      const g = gate(); if(g) return g;
      const info = getOrdenes().power(pct, dir);
      ordenesAplicar();
      if(window.ASDAudio) ASDAudio.play('telegraph');
      return ok(`Potencia ${info.power_pct} por ciento ${dir < 0 ? 'atrás' : 'avante'}`, hint(Object.assign(orderState(), info)));
    },
    engineStep(dir){
      const g = gate(); if(g) return g;
      const entry = getOrdenes().engineStep(dir);
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

    ui({ panel, visible, chart, rose, follow, overview, forces, vectors }){
      const done = [];
      if(typeof overview === 'boolean'){ setOverviewCollapsed(!overview, true); done.push(overview ? 'Vista general' : 'Vista general oculta'); }
      if(typeof forces === 'boolean'){ setForcePanel(forces, true); layoutCorner(); done.push(forces ? 'Diagrama de fuerzas' : 'Diagrama oculto'); }
      if(typeof vectors === 'boolean'){ VL.on = vectors; paintVecBtn(); layoutCorner(); done.push(vectors ? 'Lista de vectores' : 'Lista oculta'); }
      if(typeof follow === 'boolean'){ setFollow(follow); done.push(follow ? 'Carta centrada en el buque' : 'Seguimiento desactivado'); }
      if(panel){
        const id = panel === 'left' ? 'panelBuque' : 'panelTelemetria';
        const hidden = byId(id).classList.contains('collapsed');
        const wantVisible = visible !== false;
        if(hidden === wantVisible) togglePanel(id);
        done.push(`Panel ${panel === 'left' ? 'izquierdo' : 'derecho'} ${wantVisible ? 'visible' : 'oculto'}`);
      }
      if(chart){ setChartTab(chart); done.push(chart === 'abat' ? 'Gráfica de abatimiento' : 'Perfil batimétrico'); }
      if(rose){ toggleRosa(rose === 'open'); done.push(rose === 'open' ? 'Rosa abierta' : 'Rosa cerrada'); }
      return done.length ? ok(done.join(', ')) : fail('bad_args', 'Indica panel, gráfica, rosa o seguimiento.');
    },

    /* Informe de deriva y caída (solo lectura): sale de ASDForces con todas las fuerzas del frame actual. */
    driftReport(){
      const A = estado.fuerzas;
      if(!A) return fail('no_data', 'Aún no hay fuerzas calculadas: inicia la simulación.');
      const n = estado.nav || null, KN = 1000;
      const sd = v => v > 0 ? 'estribor' : (v < 0 ? 'babor' : 'sin caída');
      const end = (fall, f) => ({ transverse_speed_kn: Math.round(Math.abs(fall.knots) * 100) / 100, transverse_speed_ms: Math.round(Math.abs(fall.ms) * 100) / 100, fall_deg: r1(Math.abs(fall.deg)), side: sd(fall.deg), lateral_force_kN: r1(Math.abs(f)/KN), force_side: sd(f) });
      return ok('Informe de deriva', {
        leeway_deg: n ? r1(Math.abs(n.abat)) : null, leeway_side: n ? sd(n.abat) : null, drift_deg: n ? r1(Math.abs(n.deriva)) : null, drift_side: n ? sd(n.deriva) : null,
        sog_kn: n ? r1(n.sog) : null, stw_kn: n ? r1(n.stw) : null,
        bow: end(A.fall.bow, A.ends.bow), stern: end(A.fall.stern, A.ends.stern),
        yaw_rate_deg_s: r1(estado.yawRate * 180 / Math.PI),
        main_cause: { bow: A.ends.cause.bow, stern: A.ends.cause.stern },
        pivot_from_bow: A.pivot && A.pivot.defined ? Math.round(A.pivot.fromBowFrac*100)/100 : null,   // fracción de eslora desde la proa (≈ 0,33 con arrancada)
        net_force_kN: r1(A.net.mag / KN), net_bearing_deg: Math.round(A.net.absDeg), net_bearing_spoken: spoken(A.net.absDeg), acceleration_kn_s: Math.round(A.net.accKnS*100)/100,
        recommendation: A.rec.text, level: A.rec.level, suggestion: A.rec.suggest
      });
    },

    getStatus(){
      const n = estado.nav || null, amb = leerAmbiente(), g = estado.guia, o = getOrdenes();
      const ukc = n ? n.ukc : null;
      const hdg = curHdg();
      const windRel = norm(amb.vDirFrom - hdg);                                  // 0 = viento de proa; <=180 estribor
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
        heading_spoken: spoken(curHdg()),
        ordered_heading_spoken: (o.isActive() && o.state.mode === 'heading' && o.state.hdgTarget != null) ? spoken(o.state.hdgTarget) : null,
        cog_spoken: n ? spoken(n.cog) : null,
        cts_spoken: g ? spoken(g.CTS) : null,
        bearing_to_waypoint_spoken: g ? spoken(g.bearingWP) : null,
        ordered_heading_deg: (o.isActive() && o.state.mode === 'heading' && o.state.hdgTarget != null) ? Math.round(o.state.hdgTarget) : null,
        engine_order: o.isActive() ? o.telegraphEntry().label : null,
        engines_split: (o.isActive() && o.perSide()) ? { port: o.perSide().P.label, starboard: o.perSide().S.label } : null,
        ordered_speed_kn: (o.isActive() && o.state.telegraph === 'speed') ? Math.round(o.state.speedKn * 10) / 10 : null,
        rate_of_turn_deg_s: r1(estado.yawRate * 180 / Math.PI),
        nav: n ? { cog_deg: Math.round(n.cog), stw_kn: r1(n.stw), sog_kn: r1(n.sog), leeway_deg: r1(n.abat), total_drift_deg: r1(n.deriva), depth_m: r1(n.prof), ukc_m: r1(n.ukc) }
               : 'sin datos: la simulación aún no ha corrido',
        environment: { wind_from_deg: amb.vDirFrom, wind_kn: amb.vKn, current_toward_deg: amb.cDirTo, current_kn: amb.cKn, hs_m: amb.olaHs, tide_m: amb.marea,
                       wind_rel_deg: Math.round(windRel), wind_rel_side: windRel === 0 || windRel === 180 ? null : (windRel < 180 ? 'estribor' : 'babor') },
        thrust_pct: { port: Math.round(estado.thrP * 100), stbd: Math.round(estado.thrS * 100) },
        draft_m: ship ? ship.T : null,
        route: g ? { waypoint: `${g.wpNum} de ${g.totalWp}`, distance_nm: r1(g.distWP / 1852), bearing_deg: Math.round(g.bearingWP), cts_deg: Math.round(g.CTS), cross_track_m: Math.round(Math.abs(g.xte)), cross_track_side: Math.abs(g.xte) < 1 ? null : (g.xte > 0 ? 'estribor' : 'babor'),
                           eta_min: n && n.sog > 0.3 ? Math.round(g.distWP / 1852 / n.sog * 60) : null, autopilot: !!estado.autopilot }
                 : (estado.ruta && estado.ruta.length ? `${estado.ruta.length} puntos trazados, sin guiado activo` : 'sin derrota'),
        lateral: estado.fuerzas ? { bow_fall_deg: r1(estado.fuerzas.fall.bow.deg), stern_fall_deg: r1(estado.fuerzas.fall.stern.deg), recommendation: estado.fuerzas.rec.text } : null,
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
