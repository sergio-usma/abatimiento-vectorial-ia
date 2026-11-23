/* ASD Bridge Simulator: panel de feedback del puente (#bridgeFeed).
 *
 * Reúne lo que antes ocupaba la brújula: guía de derrota, orden activa con su progreso, la voz de Marina
 * (ecualizador y subtítulos) y la confirmación con cuenta atrás. Solo se ve cuando hay algo que mostrar.
 * Flota entre la consola ASD y la barra de herramientas; su posición se calcula en layoutCorner() (index.html).
 */
(function(){
  'use strict';
  const byId = id => document.getElementById(id);
  const feed = byId('bridgeFeed');
  if(!feed) return;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const RING_C = 2 * Math.PI * 15;                 // circunferencia del anillo de 15 px de radio
  const VOICE_LABEL = { off:'Desconectada', connecting:'Conectando', ready:'Lista', listening:'Escuchando', thinking:'Procesando', speaking:'Hablando', error:'Error' };
  const secs = { guide:byId('feedGuide'), order:byId('feedOrder'), voice:byId('feedVoice'), confirm:byId('confirmBar') };
  let voiceState = 'off';

  document.addEventListener('asd:voice', e => { voiceState = e.detail.state; paintAvatar(); refresh(); });

  function show(el, on){ if(el && el.hidden === on) el.hidden = !on; }

  function paintAvatar(){
    const a = byId('feedAvatar'); if(!a) return;
    a.dataset.state = voiceState;
    byId('feedVoiceState').textContent = VOICE_LABEL[voiceState] || '';
  }

  function paintOrder(){
    const ring = byId('orderRing'), box = byId('orderProgress'), pct = byId('orderPct');
    const o = getOrdenes().state;
    const hdg = norm360(estado.heading * R2D);
    let p = null, done = false;
    if(o.mode === 'heading' && o.hdgTarget != null){
      const err = Math.abs(angDiff(o.hdgTarget, hdg));
      const start = Math.max(5, o.startErr || err || 5);
      done = !!o.reported;
      p = done ? 1 : clamp(1 - err/start, 0, 1);
    }
    box.dataset.state = p === null ? 'rate' : (done ? 'done' : 'run');
    ring.style.strokeDashoffset = String((1 - (p === null ? 0 : p)) * RING_C);
    pct.textContent = p === null ? '' : (done ? '' : String(Math.round(p*100)));
    byId('orderState').textContent = p === null ? 'Girando' : (done ? 'Rumbo alcanzado' : 'Gobernando');
  }

  function paintCountdown(pend){
    const ring = byId('confirmRing'); if(!ring) return;
    const left = clamp(((pend.expires || 0) - Date.now()) / (pend.ttl || 15000), 0, 1);
    ring.style.strokeDashoffset = String((1 - left) * RING_C);
  }

  function refresh(){
    const hasRoute = estado.ruta && estado.ruta.length > 0;
    const orderOn = ordenesActivas();
    const cap = byId('voiceCaption');
    const hasCap = !!cap && !cap.hidden && cap.children.length > 0;
    const talking = voiceState === 'listening' || voiceState === 'thinking' || voiceState === 'speaking';
    if(window.ASDVoice && ASDVoice.refreshConfirm) ASDVoice.refreshConfirm();      // oculta una confirmación caducada
    const pend = window.ASDVoice && ASDVoice.pending ? ASDVoice.pending() : null;

    show(secs.guide, !!hasRoute);
    show(secs.order, orderOn); if(orderOn) paintOrder();
    show(secs.voice, talking || hasCap);
    show(secs.confirm, !!pend); if(pend) paintCountdown(pend);

    const any = !!hasRoute || orderOn || talking || hasCap || !!pend;
    if(feed.hidden === any){
      feed.hidden = !any;
      if(any){ feed.classList.remove('enter'); void feed.offsetWidth; feed.classList.add('enter'); }
      if(typeof layoutCorner === 'function') layoutCorner();
    }
  }

  /* Posición: en el hueco entre consola y barra si cabe; si no, flotando encima de la consola, pegado a la barra;
     en pantallas muy estrechas, una tira bajo la brújula. La consola y la barra no se mueven. */
  const TOOLS_COL = 12 + 38 + 12;                  // margen + barra + aire
  function place(m){
    // m: { W, H, dw, dh, raised, stackW }
    const gap = (m.W - m.dw)/2 - TOOLS_COL;        // hueco lateral real entre consola y barra
    const leftEdge = m.raised ? 12 + m.stackW + 12 : 12;
    let mode, w;
    if(gap >= 230){ mode = 'side'; w = Math.min(280, gap); }
    else {
      const avail = m.W - TOOLS_COL - leftEdge - 4;
      if(m.W > 480 && avail >= 160){ mode = 'above'; w = clamp(avail, 160, 236); }
      else { mode = 'top'; w = 0; }
    }
    feed.dataset.mode = mode;
    const compass = byId('gameCompass'), cb = compass ? compass.offsetTop + compass.offsetHeight : 90;
    feed.style.setProperty('--feed-w', w + 'px');
    feed.style.setProperty('--feed-b', (mode === 'side' ? 12 : m.dh + 20) + 'px');
    feed.style.setProperty('--feed-top', (cb + 8) + 'px');
    const stackTop = (m.raised ? m.dh + 24 : 12) + 58 + m.stackW;          // altura que ocupan radar + cursor desde abajo
    const room = mode === 'top' ? (m.H - stackTop - (cb + 8) - 8) : (m.H - (m.dh + 20) - (cb + 8) - 8);
    // En la tira superior (móvil) el espacio es escaso: el panel se limita al hueco libre y se desplaza por dentro.
    feed.style.setProperty('--feed-maxh', Math.max(mode === 'top' ? 64 : 120, Math.round(room)) + 'px');
  }

  window.BridgeFeed = { refresh, place };
  setInterval(refresh, 200);
  refresh();
  if(typeof layoutCorner === 'function') layoutCorner();
})();
