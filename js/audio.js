/* ASD Bridge Simulator: motor de sonido (Web Audio API, todo sintetizado, sin archivos).
 *
 * Buses: master -> { ui, estado, alarmas, ambiente, voz }.
 * El ambiente se atenúa mientras habla la voz (ducking); las alarmas nunca.
 * Nada suena hasta el primer gesto del usuario (política de autoplay).
 */
(function(){
  'use strict';

  const STORE_KEY = 'asd.audio.v1';
  const BUSES = ['ui','estado','alarmas','ambiente','voz'];
  const defaults = { master:0.7, muted:{ ui:false, estado:false, alarmas:false, ambiente:false, voz:false }, all:false };
  let prefs = load();
  let ctx = null, master = null, buses = {}, ambient = null;
  let voiceActive = false, lastUkc = null, crashed = false;
  let nextAlarmAt = 0, lastWp = null, nextXteAt = 0;

  function load(){
    try{
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if(raw) return Object.assign({}, defaults, raw, { muted: Object.assign({}, defaults.muted, raw.muted||{}) });
    }catch(e){}
    return JSON.parse(JSON.stringify(defaults));
  }
  function save(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); }catch(e){} }

  function ensure(){
    if(ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    BUSES.forEach(b=>{ const g = ctx.createGain(); g.connect(master); buses[b] = g; });
    applyGains();
    buildAmbient();
    return ctx;
  }

  function applyGains(){
    if(!ctx) return;
    master.gain.setTargetAtTime(prefs.all ? 0 : prefs.master, ctx.currentTime, 0.03);
    BUSES.forEach(b=>{
      let v = prefs.muted[b] ? 0 : 1;
      if(b==='ambiente' && voiceActive) v *= 0.35; // ducking bajo la voz
      buses[b].gain.setTargetAtTime(v, ctx.currentTime, 0.12);
    });
  }

  function resume(){
    const c = ensure();
    if(c && c.state === 'suspended') c.resume();
  }

  /* ---------- Primitivas ---------- */
  function tone(o){
    if(!ctx || ctx.state!=='running') return;
    const t0 = ctx.currentTime + (o.delay||0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if(o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
    const vol = o.vol==null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack||0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    let out = g;
    if(o.pan && ctx.createStereoPanner){ const p = ctx.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p; }
    out.connect(buses[o.bus || 'ui']);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
  }

  let noiseBuf = null;
  function noiseBuffer(){
    if(noiseBuf) return noiseBuf;
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for(let i=0;i<len;i++){ // ruido rosa aproximado
      const w = Math.random()*2-1;
      b0 = 0.99765*b0 + w*0.0990460; b1 = 0.96300*b1 + w*0.2965164; b2 = 0.57000*b2 + w*1.0526913;
      d[i] = (b0 + b1 + b2 + w*0.1848) * 0.2;
    }
    return noiseBuf;
  }
  function noiseBurst(o){
    if(!ctx || ctx.state!=='running') return;
    const t0 = ctx.currentTime + (o.delay||0);
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer();
    const f = ctx.createBiquadFilter(); f.type = o.filter || 'lowpass'; f.frequency.value = o.freq || 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol||0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g); g.connect(buses[o.bus || 'alarmas']);
    src.start(t0); src.stop(t0 + o.dur + 0.05);
  }

  /* ---------- Catálogo de sonidos ---------- */
  const SOUNDS = {
    click:      ()=> tone({ f:1800, f2:1200, dur:0.035, vol:0.10, type:'sine', bus:'ui' }),
    tab:        ()=> tone({ f:1400, dur:0.045, vol:0.10, type:'triangle', bus:'ui' }),
    toggleOn:   ()=>{ tone({ f:660, dur:0.06, vol:0.12, bus:'ui' }); tone({ f:880, dur:0.08, vol:0.12, delay:0.05, bus:'ui' }); },
    toggleOff:  ()=>{ tone({ f:880, dur:0.06, vol:0.12, bus:'ui' }); tone({ f:520, dur:0.08, vol:0.12, delay:0.05, bus:'ui' }); },
    simStart:   ()=>{ [523.25,659.25,783.99].forEach((f,i)=> tone({ f, dur:0.28, vol:0.14, delay:i*0.07, bus:'estado' })); },
    simPause:   ()=>{ [783.99,659.25,523.25].forEach((f,i)=> tone({ f, dur:0.22, vol:0.12, delay:i*0.07, bus:'estado' })); },
    autoOn:     ()=>{ tone({ f:523.25, dur:0.12, vol:0.14, bus:'estado' }); tone({ f:783.99, dur:0.2, vol:0.14, delay:0.1, bus:'estado' }); },
    autoOff:    ()=>{ tone({ f:783.99, dur:0.12, vol:0.14, bus:'estado' }); tone({ f:392, dur:0.2, vol:0.14, delay:0.1, bus:'estado' }); },
    waypoint:   ()=>{ tone({ f:1320, dur:0.14, vol:0.16, bus:'estado' }); tone({ f:1320, dur:0.18, vol:0.16, delay:0.16, bus:'estado' }); },
    listenOn:   ()=>{ tone({ f:880, f2:1175, dur:0.09, vol:0.12, bus:'voz' }); },
    listenOff:  ()=>{ tone({ f:1175, f2:880, dur:0.09, vol:0.12, bus:'voz' }); },
    ack:        ()=>{ tone({ f:1568, dur:0.07, vol:0.10, bus:'voz' }); },
    alarmSoft:  ()=> tone({ f:740, dur:0.22, vol:0.22, type:'sine', bus:'alarmas' }),
    alarmFast:  ()=> tone({ f:988, dur:0.11, vol:0.26, type:'square', bus:'alarmas' }),
    xteTick:    ()=> tone({ f:2000, dur:0.02, vol:0.07, type:'sine', bus:'estado' }),
    telegraph:  ()=>{ [0,0.19].forEach(d=>{ tone({ f:1046.5, dur:0.55, vol:0.16, delay:d, type:'sine', bus:'estado' }); tone({ f:2093, dur:0.35, vol:0.05, delay:d, type:'sine', bus:'estado' }); }); },
    crash:      ()=>{ noiseBurst({ dur:0.7, freq:260, vol:0.55 }); tone({ f:110, f2:38, dur:0.9, vol:0.4, type:'sawtooth', bus:'alarmas' }); }
  };

  function play(name){
    if(!ctx) return;
    const fn = SOUNDS[name];
    if(fn) fn();
  }

  /* ---------- Ambiente continuo: motores, viento, oleaje ---------- */
  function buildAmbient(){
    const mkEngine = pan=>{
      const out = ctx.createGain(); out.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.7;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 42;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 21;
      const g2 = ctx.createGain(); g2.gain.value = 0.5;
      o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(out);
      let node = out;
      if(ctx.createStereoPanner){ const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p); node = p; }
      node.connect(buses.ambiente);
      o1.start(); o2.start();
      return { out, lp, o1, o2 };
    };
    const mkNoise = (type, freq, q)=>{
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(); src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q||0.6;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(buses.ambiente); src.start();
      return { g, f };
    };
    ambient = {
      port: mkEngine(-0.55),
      stbd: mkEngine(0.55),
      wind: mkNoise('bandpass', 650, 0.5),
      waves: mkNoise('lowpass', 320, 0.4)
    };
  }

  function readNum(id){ const el = document.getElementById(id); return el ? (parseFloat(el.value)||0) : 0; }

  function tickAmbient(){
    if(!ctx || ctx.state!=='running' || !ambient || typeof estado==='undefined') return;
    const t = ctx.currentTime, tc = 0.25;
    const run = estado.simActiva ? 1 : 0;
    const act = (estado.manual || estado.autopilot) ? 1 : 0;
    const setEng = (e, thr)=>{
      const idle = 0.018 * run;                       // ralentí audible
      const v = run * (idle + act * thr * 0.10);
      e.out.gain.setTargetAtTime(v, t, tc);
      e.o1.frequency.setTargetAtTime(40 + act*thr*34, t, tc);
      e.o2.frequency.setTargetAtTime(20 + act*thr*17, t, tc);
      e.lp.frequency.setTargetAtTime(220 + act*thr*520, t, tc);
    };
    setEng(ambient.port, estado.thrP || 0);
    setEng(ambient.stbd, estado.thrS || 0);
    const wind = Math.min(1, readNum('vFuerza')/40);
    ambient.wind.g.gain.setTargetAtTime(run * wind * 0.10, t, 0.6);
    ambient.wind.f.frequency.setTargetAtTime(450 + wind*900, t, 0.6);
    const hs = Math.min(1, readNum('olaHs')/2.5);
    const swell = 0.5 + 0.5*Math.sin(t*0.9);
    ambient.waves.g.gain.setTargetAtTime(run * (0.02 + hs*0.12) * (0.55 + 0.45*swell), t, 0.4);

    // Guiado: waypoint alcanzado y desvío lateral
    if(estado.simActiva){
      const wp = estado.wpIndex;
      if(lastWp!==null && wp>lastWp) play('waypoint');
      lastWp = wp;
      const g = estado.guia;
      if(g && estado.autopilot===false && Math.abs(g.xte) > 20 && t > nextXteAt){
        play('xteTick');
        nextXteAt = t + (Math.abs(g.xte) > 60 ? 0.5 : 1.4);
      }
    } else { lastWp = estado.wpIndex; }

    // Alarma de poca agua según el UKC más reciente
    if(estado.simActiva && lastUkc!==null && !crashed && t > nextAlarmAt){
      if(lastUkc < 0){ /* el encallamiento lo dispara onUkc */ }
      else if(lastUkc < 1.5){ play('alarmFast'); nextAlarmAt = t + 0.6; }
      else if(lastUkc < 3){ play('alarmSoft'); nextAlarmAt = t + 2.2; }
    }
  }

  /* Llamado desde verificarEncallamiento (envuelta en sim-api / index) */
  function onUkc(ukc){
    lastUkc = ukc;
    if(ukc < 0 && !crashed){ crashed = true; play('crash'); }
    if(ukc >= 1.5) crashed = false;
  }

  /* ---------- Control público ---------- */
  function setMaster(v){ prefs.master = Math.max(0, Math.min(1, v)); save(); applyGains(); }
  function setMuted(bus, m){ if(bus==='all'){ prefs.all = !!m; } else { prefs.muted[bus] = !!m; } save(); applyGains(); }
  function setVoiceActive(on){ voiceActive = !!on; applyGains(); }
  function getPrefs(){ return JSON.parse(JSON.stringify(prefs)); }

  /* Sonidos de interfaz por delegación: un solo oyente para todos los botones */
  function wireUi(){
    document.addEventListener('pointerdown', resume, { once:false, passive:true });
    document.addEventListener('keydown', resume, { passive:true });
    document.addEventListener('click', e=>{
      const t = e.target.closest && e.target.closest('.tab, .icon-btn, .btn, summary, .check');
      if(!t || t.closest('#simDock .thr-track, #simDock .azimuth-control')) return;
      resume();
      if(t.matches('.tab')) play('tab'); else play('click');
    }, true);
    setInterval(tickAmbient, 100);
    wireSoundPanel();
  }

  function wireSoundPanel(){
    const btn = document.getElementById('btnSound'), panel = document.getElementById('soundPanel');
    if(!btn || !panel) return;
    const vol = document.getElementById('volMaster'), muteAll = document.getElementById('muteAll');
    vol.value = Math.round(prefs.master * 100);
    panel.querySelectorAll('input[data-bus]').forEach(c=>{
      c.checked = !prefs.muted[c.dataset.bus];
      c.addEventListener('change', ()=> setMuted(c.dataset.bus, !c.checked));
    });
    const paint = ()=>{
      muteAll.setAttribute('aria-pressed', String(prefs.all));
      muteAll.classList.toggle('active', prefs.all);
      btn.querySelector('use').setAttribute('href', prefs.all ? '#i-volume-off' : '#i-volume');
    };
    paint();
    vol.addEventListener('input', ()=>{ resume(); setMaster(vol.value/100); });
    vol.addEventListener('change', ()=> play('click'));
    muteAll.addEventListener('click', ()=>{ setMuted('all', !prefs.all); paint(); });
    const close = ()=>{ panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', ()=>{ const open = panel.hidden; panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', e=>{ if(!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) close(); });
    document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && !panel.hidden){ close(); btn.focus(); } });
  }

  window.ASDAudio = { resume, play, onUkc, setMaster, setMuted, setVoiceActive, getPrefs, BUSES };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', wireUi); else wireUi();
})();
