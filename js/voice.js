/* ASD Bridge Simulator: control por voz con la API Realtime de OpenAI (WebRTC directo desde el navegador).
 *
 * Claves: NUNCA se guardan en el repositorio.
 *   - Pruebas: clave en el campo "Clave de OpenAI" (sessionStorage) o js/config.local.js (ignorado por git).
 *     Con ella se pide una clave efímera a /v1/realtime/client_secrets y se usa solo esa para la llamada.
 *   - Producción: ASD_CONFIG.tokenEndpoint apunta al Worker de worker/realtime-token.js.
 *
 * Voz: PTT (mantener la tecla V o el botón del micrófono) o manos libres (VAD, palabra de activación "Marina").
 */
(function(){
  'use strict';

  const cfg = Object.assign({ model:'gpt-realtime', voice:'marin', transcriptionModel:'gpt-4o-mini-transcribe', tokenEndpoint:null, openaiKey:null }, window.ASD_CONFIG || {});
  const byId = id => document.getElementById(id);
  const KEY_STORE = 'asd.openaiKey';
  const MIN_HOLD_MS = 250;

  const INSTRUCTIONS = `Eres "Marina", timonel y oficial de máquinas de un remolcador con doble propulsor azimutal (ASD) en la bahía de Cartagena. El usuario es el PRÁCTICO: te da órdenes de puente normalizadas (IMO SMCP) en español o en inglés. Tu voz es de mujer, serena, profesional y breve.

IDIOMA: responde siempre en el idioma de la ÚLTIMA orden del práctico (español o inglés).

CIRCUITO CERRADO, COMO EN UN PUENTE
1. Ejecuta la orden con la herramienta y repítela al instante, como un timonel: "Rumbo cero nueve cero." / "Steer course zero nine zero." Máquinas: "Full avante." / "Full ahead, aye." Una frase; nada más.
2. Los rumbos se dicen y se entienden en tres dígitos, dígito a dígito: "cero cero cinco" = 5, "tres cero cero" = 300, "zero zero five" = 5.
3. Mensajes que empiezan con [EVENTO] los envía el sistema, no el práctico. "[EVENTO] heading_achieved 090" significa que el rumbo ordenado se alcanzó: di "Rumbo cero nueve cero, así." / "Steady on zero nine zero." Otros eventos: anúncialos en una frase; las alarmas con tono firme. No llames herramientas por un evento.
4. Si la herramienta devuelve un warning o note, dilo en una frase con la acción correcta ("Máquinas paradas: sin empuje no gobierno. Ordene máquinas." / "Engines stopped: no way to steer. Order engine power."), traducido al idioma de la última orden.
5. Preguntas de estado ("¿cuál es el rumbo?", "report status"): llama get_status y lee solo lo que devuelve. Nunca inventes valores.
6. Orden ambigua: UNA pregunta corta. Si no es una orden o consulta del puente, declina en una frase.
7. Acciones críticas (reiniciar todo, borrar derrota, ubicar el buque): llama PRIMERO a la herramienta (no ejecuta nada, devuelve needs_confirmation) y DESPUÉS pregunta "¿Confirmas?" con el resumen y espera. Solo si el práctico dice "confirmo", "sí, hazlo" o "confirm", llama confirm_action con el token. Cualquier otra respuesta la cancela.

FRASEOLOGÍA A HERRAMIENTA
- Rumbo: "navega con rumbo 090", "rumbo 090", "así, rumbo 090", "steer course 090", "steady on 090" -> steer_course. "Cae/caiga N grados a babor/estribor", "alter course N degrees to port/starboard" -> alter_course (relativo al rumbo ordenado).
- Timón: "diez a babor / port ten", "veinte a estribor", "todo a babor / hard to port", "timón a la vía / midships", "así / steady" -> helm_order.
- Máquinas (engine_order): "full avante / avante toda / full ahead" = full_ahead; "media avante / half ahead" = half_ahead; "poca avante / slow ahead" = slow_ahead; "muy poca avante / dead slow ahead" = dead_slow_ahead; "para máquinas / stop engines" = stop; "muy poca atrás", "poca atrás / slow astern", "media atrás / half astern", "full atrás / full astern". "Alto general / all stop" = all_stop.
- Mando: "control manual / take the con / cancela las órdenes" = manual_control. "Sigue la derrota / follow the route" = set_autopilot.
- Viento: se da siempre por DE DÓNDE viene: "por el Este", "del noreste", "from 045". "Aumenta viento a 40 nudos por el Este" = set_wind con knots 40 y from_point E. "Aumenta 5 nudos" = delta_knots 5; "baja 3" = delta_knots -3.
- Corriente: "por el 003" y "from 003" = DESDE el 003 (from_deg). "Hacia el 180", "setting 180" = toward_deg. "Incrementa corriente en 0.5 por el 003" = delta_knots 0.5 con from_deg 3.
- "a N" = valor absoluto; "en N", "N más", "N menos" = incremento. Puntos cardinales: Norte N, Este E, Sur S, Oeste W (usa "W", nunca "O").
- El simulador resuelve los azimutales y la potencia: NUNCA los menciones ni pidas azimutes.

Modo manos libres: actúa solo si la frase empieza con "Marina"; si no, no respondas.`;

  /* ---------- Estado ---------- */
  let pc = null, dc = null, micStream = null, micTrack = null, audioEl = null;
  let state = 'off';            // off | connecting | ready | listening | thinking | speaking | error
  let handsFree = false;
  let holding = false, holdStart = 0;
  let tools = null;
  const handled = new Set();
  let pendingOutputs = [];
  let assistantText = '';
  let busyTimer = null;
  const queue = new Map();      // key -> {text, opt}
  const lastAt = new Map();     // key -> ts (antirrebote)

  const LABEL = { off:'Voz desconectada', connecting:'Conectando…', ready:'Lista', listening:'Escuchando', thinking:'Procesando', speaking:'Hablando', error:'Error de voz' };

  function setState(s){
    state = s;
    const btn = byId('btnMic');
    if(btn){ btn.dataset.state = s; btn.setAttribute('aria-pressed', String(s !== 'off' && s !== 'error')); btn.title = LABEL[s] + (s==='off' ? ': mantén para hablar (V)' : ''); }
    const sr = byId('voiceState'); if(sr) sr.textContent = LABEL[s];
    if(window.ASDAudio) ASDAudio.setVoiceActive(s === 'speaking' || s === 'listening' || s === 'thinking');
    if(s === 'ready') flushQueue();
  }

  /* ---------- Subtítulos y confirmaciones ---------- */
  let capTimer = null;
  function caption(who, text, final){
    const el = byId('voiceCaption'); if(!el) return;
    el.hidden = false;
    let line = el.querySelector(`[data-who="${who}"]`);
    if(!line){ line = document.createElement('div'); line.dataset.who = who; line.className = 'cap-line cap-' + who; el.appendChild(line); }
    line.textContent = text;
    while(el.children.length > 2) el.removeChild(el.firstChild);
    clearTimeout(capTimer);
    if(final) capTimer = setTimeout(()=>{ el.hidden = true; el.textContent = ''; }, 9000);
  }
  function refreshConfirmBar(){
    const bar = byId('confirmBar'); if(!bar || !tools) return;
    const p = tools.getPending();
    bar.hidden = !p;
    if(p) byId('confirmText').textContent = p.summary + '. ¿Confirmas?';
  }

  /* ---------- Clave efímera ---------- */
  function savedKey(){ try{ return sessionStorage.getItem(KEY_STORE) || ''; }catch(e){ return ''; } }
  function currentUserKey(){ const el = byId('openaiKey'); return ((el && el.value) || savedKey() || cfg.openaiKey || '').trim(); }

  async function getEphemeralKey(){
    const userKey = currentUserKey();
    if(userKey){
      const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method:'POST',
        headers:{ 'Authorization':'Bearer ' + userKey, 'Content-Type':'application/json' },
        body: JSON.stringify({ session:{ type:'realtime', model:cfg.model, audio:{ output:{ voice:cfg.voice } } } })
      });
      const j = await r.json().catch(()=>({}));
      if(!r.ok || !j.value) throw new Error((j.error && j.error.message) || ('OpenAI respondió ' + r.status));
      return j.value;
    }
    if(cfg.tokenEndpoint){
      const r = await fetch(cfg.tokenEndpoint, { method:'POST' });
      const j = await r.json().catch(()=>({}));
      const v = j.value || (j.client_secret && j.client_secret.value);
      if(!r.ok || !v) throw new Error(j.error || ('El servidor de claves respondió ' + r.status));
      return v;
    }
    throw new Error('Falta la clave de OpenAI (panel "Voz e IA").');
  }

  /* ---------- Conexión ---------- */
  async function connect(){
    if(pc || state === 'connecting') return;
    setState('connecting');
    try{
      if(!tools) tools = VoiceTools.create(SimAPI);
      const key = await getEphemeralKey();
      pc = new RTCPeerConnection();
      audioEl = audioEl || new Audio(); audioEl.autoplay = true;
      pc.ontrack = e => { audioEl.srcObject = e.streams[0]; };
      micStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
      micTrack = micStream.getAudioTracks()[0];
      micTrack.enabled = handsFree;
      pc.addTrack(micTrack, micStream);
      dc = pc.createDataChannel('oai-events');
      dc.onopen = onOpen;
      dc.onmessage = e => { try{ onEvent(JSON.parse(e.data)); }catch(err){ console.warn('evento ilegible', err); } };
      dc.onclose = () => { if(state !== 'off') disconnect(); };
      pc.onconnectionstatechange = () => { if(pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) fatal('Se perdió la conexión de voz.'); };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const r = await fetch('https://api.openai.com/v1/realtime/calls', {
        method:'POST', body: offer.sdp,
        headers:{ 'Authorization':'Bearer ' + key, 'Content-Type':'application/sdp' }
      });
      if(!r.ok) throw new Error('No se pudo abrir la llamada (' + r.status + ').');
      await pc.setRemoteDescription({ type:'answer', sdp: await r.text() });
    }catch(e){
      fatal(e && e.name === 'NotAllowedError' ? 'Permiso de micrófono denegado.' : (e && e.message) || 'No se pudo conectar la voz.');
    }
  }

  function disconnect(){
    try{ if(dc) dc.close(); }catch(e){}
    try{ if(pc) pc.close(); }catch(e){}
    if(micStream) micStream.getTracks().forEach(t => t.stop());
    pc = dc = micStream = micTrack = null; holding = false;
    handled.clear(); pendingOutputs = []; queue.clear();
    setState('off');
  }
  function fatal(msg){
    disconnect();
    setState('error');
    if(typeof aviso === 'function') aviso(msg);
    caption('err', msg, true);
    if(/Falta la clave/.test(msg)){ const g = byId('grpVoz'); if(g) g.open = true; const k = byId('openaiKey'); if(k) k.focus(); }
  }

  function send(obj){ if(dc && dc.readyState === 'open') dc.send(JSON.stringify(obj)); }

  function onOpen(){
    send({ type:'session.update', session:{
      type:'realtime', model:cfg.model, output_modalities:['audio'],
      instructions: INSTRUCTIONS, tools: tools.definitions, tool_choice:'auto',
      audio:{
        input:{
          transcription:{ model: cfg.transcriptionModel, language:'es' },
          noise_reduction:{ type:'near_field' },
          turn_detection: handsFree ? { type:'semantic_vad', create_response:true, interrupt_response:true } : null
        },
        output:{ voice: cfg.voice }
      }
    }});
    setState('ready');
    if(holding) pttStart();
  }

  /* ---------- Eventos del servidor ---------- */
  function runCall(item){
    if(!item || item.type !== 'function_call' || handled.has(item.call_id)) return;
    handled.add(item.call_id);
    let args = {};
    try{ args = item.arguments ? JSON.parse(item.arguments) : {}; }catch(e){}
    const result = tools.execute(item.name, args);
    if(window.ASDAudio) ASDAudio.play(result.status === 'error' ? 'alarmSoft' : 'ack');
    pendingOutputs.push({ call_id:item.call_id, output: JSON.stringify(result) });
    refreshConfirmBar();
  }
  function flushOutputs(){
    if(!pendingOutputs.length) return false;
    pendingOutputs.forEach(o => send({ type:'conversation.item.create', item:{ type:'function_call_output', call_id:o.call_id, output:o.output } }));
    pendingOutputs = [];
    send({ type:'response.create' });
    return true;
  }

  function onEvent(ev){
    switch(ev.type){
      case 'input_audio_buffer.speech_started':
        if(handsFree) setState('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        if(handsFree){ if(tools) tools.noteUserTurn(); setState('thinking'); }
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if(ev.transcript && ev.transcript.trim()) caption('user', 'Tú: ' + ev.transcript.trim(), true);
        break;
      case 'response.created':
        assistantText = ''; setState('thinking');
        break;
      case 'response.output_item.done':
        runCall(ev.item);
        break;
      case 'response.output_audio_transcript.delta':
        assistantText += ev.delta || ''; caption('bot', 'Marina: ' + assistantText, false);
        if(state !== 'speaking') setState('speaking');
        break;
      case 'response.output_audio_transcript.done':
        caption('bot', 'Marina: ' + (ev.transcript || assistantText), true);
        break;
      case 'output_audio_buffer.started':
        setState('speaking'); break;
      case 'output_audio_buffer.stopped':
        clearTimeout(busyTimer); if(state === 'speaking') setState('ready'); break;
      case 'response.done': {
        const out = (ev.response && ev.response.output) || [];
        out.forEach(runCall);                  // respaldo si no llegó output_item.done
        if(flushOutputs()) break;              // el modelo hablará tras recibir los resultados
        clearTimeout(busyTimer);
        busyTimer = setTimeout(() => { if(state === 'speaking' || state === 'thinking') setState('ready'); }, 1500);
        break;
      }
      case 'error':
        console.warn('Realtime error', ev.error);
        if(ev.error && /invalid_api_key|authentication|expired/i.test(JSON.stringify(ev.error))) fatal('La clave de voz no es válida o caducó.');
        else if(typeof aviso === 'function' && ev.error && ev.error.message) aviso(ev.error.message);
        if(state === 'thinking') setState('ready');
        break;
    }
  }

  /* ---------- Pulsar para hablar ---------- */
  function cancelOutput(){
    send({ type:'response.cancel' });
    send({ type:'output_audio_buffer.clear' });
  }
  function pttStart(){
    holding = true; holdStart = performance.now();
    if(window.ASDAudio) ASDAudio.resume();
    if(!pc){ connect(); return; }                 // al abrirse, onOpen reanuda si sigue pulsado
    if(state === 'connecting' || handsFree) return;
    if(state === 'speaking' || state === 'thinking') cancelOutput();   // se puede interrumpir
    send({ type:'input_audio_buffer.clear' });
    if(micTrack) micTrack.enabled = true;
    setState('listening');
    if(window.ASDAudio) ASDAudio.play('listenOn');
  }
  function pttEnd(){
    const was = holding; holding = false;
    if(!was || handsFree || state !== 'listening') return;
    if(micTrack) micTrack.enabled = false;
    if(window.ASDAudio) ASDAudio.play('listenOff');
    if(performance.now() - holdStart < MIN_HOLD_MS){ send({ type:'input_audio_buffer.clear' }); setState('ready'); return; }
    if(tools) tools.noteUserTurn();
    send({ type:'input_audio_buffer.commit' });
    send({ type:'response.create' });
    setState('thinking');
  }

  function setHandsFree(on){
    handsFree = !!on;
    if(micTrack) micTrack.enabled = handsFree;
    if(dc && dc.readyState === 'open'){
      send({ type:'session.update', session:{ type:'realtime', audio:{ input:{ turn_detection: handsFree ? { type:'semantic_vad', create_response:true, interrupt_response:true } : null } } } });
    }
    if(handsFree && !pc) connect();
  }

  /* ---------- Texto y avisos del sistema ---------- */
  async function sendText(text){
    text = (text || '').trim(); if(!text) return;
    if(!pc){ await connect(); }
    const wait = () => new Promise(res => { const t0 = Date.now(); (function poll(){ if(state === 'ready' || state === 'error' || Date.now() - t0 > 8000) res(); else setTimeout(poll, 100); })(); });
    await wait();
    if(!dc || dc.readyState !== 'open') return;
    caption('user', 'Tú: ' + text, true);
    if(tools) tools.noteUserTurn();
    send({ type:'conversation.item.create', item:{ type:'message', role:'user', content:[{ type:'input_text', text }] } });
    send({ type:'response.create' });
  }

  function pickFemaleEsVoice(){
    const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
    const es = vs.filter(v => /^es/i.test(v.lang));
    const fem = es.find(v => /(female|mujer|sabina|helena|paulina|monica|elena|laura|maria|dalia|salome|google espa)/i.test(v.name));
    return fem || es[0] || null;
  }
  function speakFallback(text){
    if(!('speechSynthesis' in window)) return;
    if(window.ASDAudio && ASDAudio.getPrefs().muted.voz) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickFemaleEsVoice(); if(v){ u.voice = v; u.lang = v.lang; } else u.lang = 'es-CO';
    u.rate = 1.05; u.pitch = 1.05;
    speechSynthesis.speak(u);
  }

  function isLive(){ return !!dc && dc.readyState === 'open' && state !== 'off' && state !== 'error' && state !== 'connecting'; }

  /* announce: la app informa al modelo de un evento y ella lo dice. Si no hay voz conectada, speechSynthesis. */
  function announce(text, opt){
    opt = opt || {};
    const key = opt.key || text.slice(0, 24);
    const now = Date.now();
    if(opt.cooldownMs && lastAt.has(key) && now - lastAt.get(key) < opt.cooldownMs) return;
    lastAt.set(key, now);
    if(!isLive()){ speakFallback(opt.fallbackText || text); return; }
    if(opt.prio === 'critical'){ cancelOutput(); deliver(text, true); return; }
    if(state === 'ready') deliver(text, false); else queue.set(key, { text, opt });
  }
  function deliver(text, critical){
    send({ type:'conversation.item.create', item:{ type:'message', role:'user', content:[{ type:'input_text', text:'[EVENTO] ' + text }] } });
    send({ type:'response.create', response:{ instructions: critical ? 'Alarma crítica: avisa de inmediato, una sola frase, tono firme.' : 'Informa en una frase corta.' } });
  }
  function flushQueue(){
    if(!queue.size) return;
    const [key, v] = queue.entries().next().value;
    queue.delete(key);
    deliver(v.text, false);
  }

  /* hablar() existente (alertas, asesoría IA) pasa a usar esta salida */
  window.hablar = function(texto, opt){
    if(!texto) return;
    const critical = /cr[ií]tica|encallado/i.test(texto);
    announce(texto, Object.assign({ key:'hablar:' + texto.slice(0, 18), prio: critical ? 'critical' : 'normal' }, opt || {}));
  };

  /* ---------- Vigilante de eventos de navegación ---------- */
  let lastWp = null, lastUkcTier = 0;
  setInterval(() => {
    if(typeof estado === 'undefined' || !estado.simActiva) { if(typeof estado !== 'undefined') lastWp = estado.wpIndex; return; }
    if(lastWp !== null && estado.wpIndex > lastWp) announce(`Waypoint ${estado.wpIndex} alcanzado. Siguiente: ${estado.wpIndex + 1}.`, { key:'wp', cooldownMs:4000 });
    lastWp = estado.wpIndex;
    const g = estado.guia;
    if(g && Math.abs(g.xte) > 60) announce(`Desvío de ${Math.round(Math.abs(g.xte))} metros de la derrota.`, { key:'xte', cooldownMs:25000 });
    const ukc = estado.nav ? estado.nav.ukc : null;
    if(ukc !== null){
      const tier = ukc < 1.5 ? 2 : ukc < 3 ? 1 : 0;
      if(tier === 1 && lastUkcTier === 0) announce(`Margen bajo la quilla reducido: ${ukc.toFixed(1)} metros.`, { key:'ukc1', cooldownMs:30000 });
      lastUkcTier = tier;
    }
  }, 700);

  /* ---------- Cableado de la interfaz ---------- */
  function wireUi(){
    tools = VoiceTools.create(SimAPI);
    const mic = byId('btnMic');
    if(mic){
      mic.addEventListener('pointerdown', e => { e.preventDefault(); pttStart(); });
      ['pointerup','pointerleave','pointercancel'].forEach(t => mic.addEventListener(t, pttEnd));
      mic.addEventListener('keydown', e => { if((e.key === 'Enter' || e.key === ' ') && !e.repeat){ e.preventDefault(); e.stopPropagation(); pttStart(); } });
      mic.addEventListener('keyup', e => { if(e.key === 'Enter' || e.key === ' ') pttEnd(); });
    }
    window.addEventListener('keydown', e => {
      if(e.code !== 'KeyV' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if(e.target.closest && e.target.closest('input, select, textarea, [contenteditable]')) return;
      pttStart();
    });
    window.addEventListener('keyup', e => { if(e.code === 'KeyV') pttEnd(); });
    window.addEventListener('blur', pttEnd);

    const hf = byId('handsFree'); if(hf) hf.addEventListener('change', () => setHandsFree(hf.checked));
    const off = byId('voiceOff'); if(off) off.addEventListener('click', disconnect);

    const key = byId('openaiKey');
    if(key){
      if(!key.value) key.value = savedKey() || cfg.openaiKey || '';
      key.addEventListener('input', () => { try{ sessionStorage.setItem(KEY_STORE, key.value.trim()); }catch(e){} });
    }
    const form = byId('cmdForm');
    if(form) form.addEventListener('submit', e => { e.preventDefault(); const i = byId('cmdText'); sendText(i.value); i.value = ''; });
    const yes = byId('confirmYes'), no = byId('confirmNo');
    if(yes) yes.addEventListener('click', () => {
      if(!tools) return;
      const r = tools.confirmPending(); refreshConfirmBar();
      if(isLive()){ send({ type:'conversation.item.create', item:{ type:'message', role:'user', content:[{ type:'input_text', text:'[EVENTO] El usuario confirmó en pantalla. Resultado: ' + (r.message || r.status) }] } }); send({ type:'response.create' }); }
      else if(typeof aviso === 'function') aviso(r.message || 'Hecho');
    });
    if(no) no.addEventListener('click', () => {
      if(!tools) return; tools.cancelPending(); refreshConfirmBar();
      if(isLive()){ send({ type:'conversation.item.create', item:{ type:'message', role:'user', content:[{ type:'input_text', text:'[EVENTO] El usuario canceló la acción pendiente.' }] } }); send({ type:'response.create' }); }
    });
    document.querySelectorAll('.phrase').forEach(b => b.addEventListener('click', () => { if(window.ASDAudio) ASDAudio.resume(); sendText(b.textContent); }));
    const tEs = byId('tabGuiaEs'), tEn = byId('tabGuiaEn');
    const setGuide = es => {
      byId('guideEs').hidden = !es; byId('guideEn').hidden = es;
      tEs.setAttribute('aria-selected', String(es)); tEn.setAttribute('aria-selected', String(!es));
    };
    if(tEs && tEn){
      tEs.addEventListener('click', () => setGuide(true)); tEn.addEventListener('click', () => setGuide(false));
      byId('guideEs').parentNode.addEventListener('keydown', e => { if(e.key === 'ArrowLeft' || e.key === 'ArrowRight'){ const es = tEs.getAttribute('aria-selected') === 'true'; if(e.target === tEs || e.target === tEn){ setGuide(!es); (es ? tEn : tEs).focus(); } } });
    }
    setState('off');
  }

  window.ASDVoice = { connect, disconnect, isLive, announce, sendText, setHandsFree, get state(){ return state; } };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUi); else wireUi();
})();
