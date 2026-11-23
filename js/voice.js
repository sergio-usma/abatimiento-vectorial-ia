/* ASD Bridge Simulator: voz con la API Realtime de OpenAI (WebRTC directo desde el navegador).
 *
 * Una sola vuelta, sin cuellos de botella:
 *   1. El práctico habla. El modelo OYE el audio y responde SOLO con una llamada a herramienta (tool_choice 'required', salida de texto:
 *      nunca habla ni escribe prosa). No hay paso previo por una transcripción.
 *   2. La llamada se valida contra data/bridge-commands.json (grammar.fromTool): si no existe en la base, NO se ejecuta.
 *   3. Se ejecuta al instante con VoiceTools/SimAPI y Marina repite con una frase fija y breve, generada localmente (voz del navegador:
 *      sin segunda vuelta al modelo). Opcional: voz natural de OpenAI.
 *   4. La transcripción (en paralelo, solo informa) se compara con la base: si lo oído era otra orden, se avisa en pantalla.
 *   5. Marina NUNCA habla por iniciativa propia: alarmas y "rumbo alcanzado" son solo tono y pantalla. Informes y sugerencias, solo si los pides.
 *
 * La práctica escrita y las frases de la guía usan la gramática local (js/grammar.js): instantáneas y sin conexión.
 *
 * Claves: NUNCA se guardan en el repositorio.
 *   - Pruebas: clave en el campo "Clave de OpenAI" (sessionStorage) o js/config.local.js (ignorado por git).
 *   - Producción: ASD_CONFIG.tokenEndpoint apunta al Worker de worker/realtime-token.js.
 */
(function(){
  'use strict';

  const cfg = Object.assign({ model:'gpt-realtime-1.5', voice:'marin', transcriptionModel:'gpt-4o-mini-transcribe', reasoning:null, tokenEndpoint:null, openaiKey:null }, window.ASD_CONFIG || {});
  const VP = window.ASDVoicePrompt;
  const byId = id => document.getElementById(id);
  const KEY_STORE = 'asd.openaiKey';
  const MIN_HOLD_MS = 250;
  const DB_URL = 'data/bridge-commands.json';

  /* ---------- Estado ---------- */
  let pc = null, dc = null, micStream = null, micTrack = null, audioEl = null;
  let state = 'off';            // off | connecting | ready | listening | thinking | speaking | error
  let handsFree = false;
  let holding = false, holdStart = 0, heardStart = 0;
  let tools = null, grammar = null, grammarReady = null, sessionTools = null, instructions = '', dbRef = null;
  let assistantBusy = false;
  let busyTimer = null;
  let lastLang = 'es', lastSaid = null;
  let lastCall = null;          // última orden ejecutada por el modelo (para compararla con la transcripción)
  const handledCalls = new Set();
  const queue = new Map();      // key -> {text, lang}
  const lastAt = new Map();     // key -> ts (antirrebote)
  const callItems = new Set();  // ids de function_call / function_call_output del turno: se borran al terminar la respuesta (turnos sin estado)
  const audioItems = new Map(); // id del audio del práctico -> temporizador de borrado (se borra al llegar su transcripción)
  const voiceLog = [];          // registro en memoria de los últimos turnos: lo oído, la llamada y las latencias
  let evalWait = null;          // evaluador de frases: intercepta la llamada del modelo en lugar de ejecutarla
  let speechEndAt = 0;
  let pendingUnclear = null;    // { lang, missing, timer }: espera la transcripción un instante antes de preguntar, por si el analizador local la resuelve

  const LABEL = { off:'Voz desconectada', connecting:'Conectando…', ready:'Lista', listening:'Escuchando', thinking:'Procesando', speaking:'Hablando', error:'Error de voz' };

  function setState(s){
    state = s;
    const btn = byId('btnMic');
    if(btn){ btn.dataset.state = s; btn.setAttribute('aria-pressed', String(s !== 'off' && s !== 'error')); btn.title = LABEL[s] + (s==='off' ? ': mantén para hablar (V)' : ''); }
    const sr = byId('voiceState'); if(sr) sr.textContent = LABEL[s];
    if(window.ASDAudio) ASDAudio.setVoiceActive(s === 'speaking' || s === 'listening' || s === 'thinking');
    document.dispatchEvent(new CustomEvent('asd:voice', { detail:{ state:s } }));   // lo escucha el panel de puente
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
    if(final) capTimer = setTimeout(()=>{ el.hidden = true; el.textContent = ''; }, 7000);
  }
  function refreshConfirmBar(){
    const bar = byId('confirmBar'); if(!bar || !tools) return;
    const p = tools.getPending();
    bar.hidden = !p;
    if(p) byId('confirmText').textContent = p.summary + '. ¿Confirmas?';
  }

  /* ---------- Base de órdenes: gramática, guía, herramientas e instrucciones del modelo ---------- */
  function loadGrammar(){
    if(grammarReady) return grammarReady;
    grammarReady = fetch(DB_URL, { cache:'no-cache' }).then(r => { if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(db => { grammar = ASDGrammar.create(db); buildGuide(db); buildSessionConfig(db); return grammar; })
      .catch(e => { console.warn('No se pudo cargar ' + DB_URL, e); grammarReady = null; if(typeof aviso === 'function') aviso('No se pudo cargar la base de órdenes de voz.'); return null; });
    return grammarReady;
  }

  function buildGuide(db){
    const names = db.catLabels || {};
    ['es', 'en'].forEach(lang => {
      const box = byId(lang === 'es' ? 'guideEs' : 'guideEn'); if(!box) return;
      const cats = [], by = {};
      db.commands.forEach(c => {
        if(c.guide === false || !(c.examples[lang] || []).length) return;
        if(!by[c.cat]){ by[c.cat] = []; cats.push(c.cat); }
        by[c.cat].push(c.examples[lang][0]);
      });
      box.textContent = '';
      cats.forEach(cat => {
        const h = document.createElement('h4'); h.textContent = lang === 'en' ? ((names[cat] || {}).en || cat) : cat; box.appendChild(h);
        by[cat].forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'phrase'; b.textContent = t; box.appendChild(b); });
      });
    });
  }

  /* Herramientas e instrucciones de la sesión (js/voice-prompt.js): se reconstruyen al cambiar de manos libres (wake solo aplica ahí). */
  function buildSessionConfig(db){
    dbRef = db; refreshSession();
  }
  function refreshSession(){
    if(!dbRef || !VP) return;
    sessionTools = VP.buildTools(VoiceTools.definitions, { handsFree });
    instructions = VP.buildInstructions(dbRef, grammar.parse, { handsFree });
  }

  /* ---------- Clave efímera ---------- */
  function savedKey(){ try{ return sessionStorage.getItem(KEY_STORE) || ''; }catch(e){ return ''; } }
  function currentUserKey(){ const el = byId('openaiKey'); return ((el && el.value) || savedKey() || cfg.openaiKey || '').trim(); }
  /* Clave por defecto (js/default-key.js, ofuscada con js/keybox.js: NO es seguridad, ver su cabecera). Solo se usa si el práctico no
     puso ninguna en la interfaz y no hay Worker de claves. Se descifra una vez y queda en memoria. */
  const hasDefaultKey = () => !!(window.ASD_DEFAULT_KEY && window.ASDKeybox);
  let defaultKeyP = null;
  function defaultKey(){
    if(!hasDefaultKey()) return Promise.resolve('');
    if(!defaultKeyP) defaultKeyP = ASDKeybox.decrypt(window.ASD_DEFAULT_KEY).catch(e => { console.warn('La clave por defecto no se pudo descifrar', e); return ''; });
    return defaultKeyP;
  }
  /* Clave que usará la app: la de la interfaz, y si no hay, la de config o la por defecto. */
  async function effectiveKey(){ return currentUserKey() || (cfg.tokenEndpoint ? '' : await defaultKey()); }

  async function getEphemeralKey(){
    const userKey = currentUserKey();
    if(userKey || (!cfg.tokenEndpoint && hasDefaultKey())){
      const apiKey = userKey || await defaultKey();
      if(!apiKey) throw new Error('Falta la clave de OpenAI (panel "Voz e IA").');
      const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method:'POST',
        headers:{ 'Authorization':'Bearer ' + apiKey, 'Content-Type':'application/json' },
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
      loadGrammar();
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
    pc = dc = micStream = micTrack = null; holding = false; assistantBusy = false;
    queue.clear(); handledCalls.clear(); if(pendingUnclear){ clearTimeout(pendingUnclear.timer); pendingUnclear = null; } callItems.clear(); audioItems.forEach(clearTimeout); audioItems.clear();
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

  /* Manos libres: silencio corto (la orden sale pronto). El servidor crea la respuesta, que SIEMPRE es una llamada a herramienta. */
  const VAD = () => ({ type:'server_vad', threshold:0.5, prefix_padding_ms:200, silence_duration_ms:380, create_response:true, interrupt_response:true });

  function onOpen(){
    loadGrammar().then(g => {
      refreshSession();                                   // instrucciones y herramientas según el modo (con o sin manos libres)
      send({ type:'session.update', session:{
        type:'realtime', model:cfg.model,
        output_modalities:['text'],                       // el modelo no habla: solo llama herramientas
        instructions, tools: sessionTools || [], tool_choice:'required', max_output_tokens: 120,
        truncation:{ type:'retention_ratio', retention_ratio:0.5 },        // respaldo: el borrado por turno ya mantiene el contexto mínimo
        ...(cfg.reasoning ? { reasoning: cfg.reasoning } : {}),            // gpt-realtime-2: { effort:'minimal' }
        audio:{
          input:{
            // La transcripción corre en paralelo y solo sirve para mostrar "Oí: …" y detectar discrepancias; no retrasa la orden.
            transcription:{ model: cfg.transcriptionModel, prompt: g ? g.transcriptionPrompt() : '' },
            noise_reduction:{ type:'near_field' },
            turn_detection: handsFree ? VAD() : null
          },
          output:{ voice: cfg.voice }
        }
      }});
      setState('ready');
      if(holding) pttStart();
    });
  }

  /* ---------- Marina habla: frase fija y breve ---------- */
  const natural = () => { const el = byId('voiceNatural'); return !!(el && el.checked); };
  function say(text, lang){
    text = (text || '').trim(); if(!text) return;
    lastLang = 'es';                                  // Marina habla siempre en español
    lastSaid = { text, lang: lastLang };
    caption('bot', 'Marina: ' + text, true);
    // Por defecto la voz del navegador: instantánea, sin segunda vuelta al modelo y sin posibilidad de que improvise.
    if(!(natural() && isLive())){ speakFallback(text, lastLang); return; }
    if(state === 'speaking' || assistantBusy) cancelOutput();
    assistantBusy = true;
    send({ type:'response.create', response:{
      conversation:'none', output_modalities:['audio'], tool_choice:'none', max_output_tokens: Math.min(400, Math.ceil(text.length / 2.5) + 40),
      instructions: `Pronuncia únicamente estas palabras, en ${lastLang === 'en' ? 'inglés' : 'español'}, y nada más: «${text}»`
    }});
  }

  /* Una orden, ya reconocida (por el modelo o por la gramática local): se ejecuta y Marina repite. */
  function runParsed(p, extra){
    if(!tools) tools = VoiceTools.create(SimAPI);
    p = Object.assign({}, p, { lang:'es' });          // respuesta siempre en español, aunque la orden fuera en inglés
    let res;
    if(p.kind === 'confirm'){ res = tools.getPending() ? tools.confirmPending() : { status:'error', error:'no_pending' }; }
    else if(p.kind === 'cancel'){
      if(!tools.getPending()) return null;                 // un "no" suelto no es una orden
      tools.cancelPending(); res = { status:'ok' };
    }
    else if(p.kind === 'repeat'){ if(lastSaid) say(lastSaid.text, lastSaid.lang); return null; }
    else if(p.kind === 'query') res = execQuery(p.id);
    else res = tools.execute(p.tool, p.args, { origin:'user' });     // se ejecuta ANTES de hablar: la voz no retrasa la maniobra
    refreshConfirmBar();
    if(window.ASDAudio) ASDAudio.play(res && res.status === 'error' ? 'alarmSoft' : 'ack');
    const out = grammar.speak(p, res);
    say(out.text, out.lang);
    const ms = heardStart ? Math.round(performance.now() - heardStart) : null;
    if(ms != null) document.dispatchEvent(new CustomEvent('asd:order', { detail:{ id:p.id, latencyMs:ms, text:out.text } }));
    return res;
  }

  /* Informes: estado + informe de deriva combinados (lectura local, síncrona). Si el informe necesita fuerzas y aún no hay, se dice "Aún no hay datos". */
  const NEEDS_DRIFT = { q_drift:1, q_leeway:1, q_recommend:1 };
  function execQuery(id){
    const st = tools.execute('get_status', {}, { origin:'user' });
    const dr = tools.execute('drift_report', {}, { origin:'user' });
    if(NEEDS_DRIFT[id] && dr.status !== 'ok') return dr;
    return Object.assign({}, dr.status === 'ok' ? dr : {}, st, { status:'ok' });
  }

  /* Falta un dato o el audio no se entendió: antes de preguntar se espera ~0.9 s la transcripción; si el analizador local la resuelve
     ("rescate"), se ejecuta. Si no, Marina pregunta lo concreto ("¿Qué rumbo?") y solo dice "Repita" si el audio fue ininteligible. */
  function askOrRescue(missing, lang){
    lastLang = lang;
    if(pendingUnclear) clearTimeout(pendingUnclear.timer);
    const pu = { missing, lang, timer: null };
    pu.ask = () => {
      if(pendingUnclear === pu) pendingUnclear = null;
      const key = pu.missing && pu.missing !== 'other' ? 'ask_' + pu.missing : null;
      const out = key && grammar.db.messages[key] ? grammar.speak({ status:'incomplete', missing:pu.missing, lang:pu.lang }) : grammar.speak({ status:'no_match', lang:pu.lang });
      say(out.text, pu.lang);
    };
    pu.timer = setTimeout(pu.ask, 900);
    pendingUnclear = pu;
  }

  /* Llamada a herramienta del modelo (lo que OYÓ). Solo se ejecuta lo que existe en la base. */
  function onToolCall(name, rawArgs, callId){
    if(callId){ if(handledCalls.has(callId)) return; handledCalls.add(callId); }
    let args = {}; try{ args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {}); }catch(e){}
    const callAt = performance.now();
    if(evalWait){ const w = evalWait; evalWait = null; w({ name, args, ms: Math.round(callAt - w.t0) }); return; }   // evaluador: no ejecuta nada
    const lang = 'es', wake = !!args.wake;          // las órdenes pueden darse en inglés, pero Marina responde SIEMPRE en español
    const g = grammar; if(!g) return;
    if(callId) send({ type:'conversation.item.create', item:{ type:'function_call_output', call_id:callId, output:'{"ok":true}' } });   // cierra la llamada, sin respuesta
    assistantBusy = false; if(state === 'thinking') setState('ready');
    lastCall = null;
    const entry = { t: Date.now(), tool: name, args, lang, modelMs: speechEndAt ? Math.round(callAt - speechEndAt) : null, heard: null };
    voiceLog.push(entry); if(voiceLog.length > 200) voiceLog.shift();
    if(name === 'ignore') return;
    if(handsFree && !wake) return;                                    // manos libres: solo con "Marina"
    if(name === 'unclear'){ askOrRescue(args.missing, lang); return; }
    let p;
    if(name === 'confirm' || name === 'cancel' || name === 'repeat'){ p = { status:'ok', id:name, kind:name, lang, args:{}, caps:{} }; }
    else if(name === 'report'){
      const rep = VP.REPORTS[args.topic];
      if(!rep){ say(g.speak({ status:'no_match', lang }).text, lang); return; }
      p = { status:'ok', id:rep.id, kind:'query', lang, args:{}, caps:{} };
    } else {
      const clean = Object.assign({}, args); delete clean.lang; delete clean.wake;
      p = g.fromTool(name, clean, lang);
      if(!p){
        // Fuera de la base pero es una herramienta real del puente: se ejecuta igual (los manejadores validan rangos y las
        // críticas piden confirmación) y Marina repite con la frase genérica, con el valor ya aplicado. Nada de "Repita".
        const known = VoiceTools.definitions.some(d => d.name === name && d.name !== 'confirm_action' && d.name !== 'get_status' && d.name !== 'drift_report');
        if(!known){ askOrRescue('other', lang); return; }
        p = { status:'ok', id:'loose:' + name, cat:'Libre', kind:'order', tool:name, args:clean, lang, loose:true, caps:{} };
      }
    }
    lastCall = (p.kind === 'query' || p.kind === 'confirm' || p.kind === 'cancel' || p.kind === 'repeat') ? { sig:p.id } : { sig:p.id, tool:p.tool, args:p.args };
    runParsed(p);
  }

  /* Transcripción (llega en paralelo): solo informa y vigila. Si lo oído era OTRA orden de la base, se avisa en pantalla. */
  function onTranscript(text){
    text = (text || '').trim(); if(text.length < 2 || !grammar) return;
    caption('user', 'Oí: «' + text + '»', true);
    const last = voiceLog[voiceLog.length - 1]; if(last && !last.heard) last.heard = text;
    const p = grammar.parse(text);
    if(pendingUnclear){
      const pu = pendingUnclear;
      if(p.status === 'ok'){
        clearTimeout(pu.timer); pendingUnclear = null;
        if(last) last.rescued = true;
        lastCall = (p.kind === 'query' || p.kind === 'confirm' || p.kind === 'cancel' || p.kind === 'repeat') ? { sig:p.id } : { sig:p.id, tool:p.tool, args:p.args };
        lastLang = 'es';
        runParsed(p);
        return;
      }
      if(p.status === 'incomplete'){ clearTimeout(pu.timer); pu.missing = p.missing; pu.lang = 'es'; pu.ask(); }
      return;
    }
    if(p.status !== 'ok' || !lastCall) return;
    const same = lastCall.sig === p.id || (lastCall.tool === p.tool && JSON.stringify(lastCall.args) === JSON.stringify(p.args));
    // Confusión típica del modelo: "estribor 10" (timón) tomado por un cambio de rumbo, o al revés. La gramática exacta es la autoridad:
    // la orden más reciente sustituye a la anterior (el timón reemplaza el rumbo; "cae" parte del rumbo actual si había un timón puesto).
    const PAIR = { helm_order:'alter_course', alter_course:'helm_order' };
    if(!same && !p.loose && lastCall.tool && PAIR[lastCall.tool] === p.tool){
      lastCall = { sig:p.id, tool:p.tool, args:p.args };
      caption('err', 'Corrijo: «' + text + '»', true);
      runParsed(p);
      return;
    }
    if(!same){
      if(window.ASDAudio) ASDAudio.play('alarmSoft');
      caption('err', `Revise: oí «${text}» pero ejecuté otra orden`, true);
    }
  }

  /* Práctica escrita y guía: la gramática local, sin conexión y sin modelo. */
  async function sendText(text){
    text = (text || '').trim(); if(!text) return;
    heardStart = performance.now();
    const g = await loadGrammar();
    if(!g){ say('Voz no disponible.', 'es'); return; }
    const p = g.parse(text);
    caption('user', 'Oí: «' + text + '»', true);
    if(p.status !== 'ok'){ if(window.ASDAudio) ASDAudio.play('alarmSoft'); say(g.speak(Object.assign({}, p, { lang:'es' })).text, 'es'); return; }
    lastCall = null;
    runParsed(p);
  }

  /* ---------- Turnos sin estado: cada orden parte del mismo prefijo (instrucciones + herramientas) ---------- */
  function trackItem(item){
    if(!item || !item.id) return;
    if(item.type === 'function_call' || item.type === 'function_call_output'){ callItems.add(item.id); return; }
    if(item.type === 'message' && item.role === 'user' && !audioItems.has(item.id))
      audioItems.set(item.id, setTimeout(() => dropItem(item.id), 6000));       // si la transcripción nunca llega, se borra igualmente
  }
  function dropItem(id){
    if(!id) return;
    if(audioItems.has(id)){ clearTimeout(audioItems.get(id)); audioItems.delete(id); }
    send({ type:'conversation.item.delete', item_id:id });
  }
  function flushCallItems(){ callItems.forEach(id => send({ type:'conversation.item.delete', item_id:id })); callItems.clear(); }

  /* ---------- Eventos del servidor ---------- */
  function onEvent(ev){
    switch(ev.type){
      case 'input_audio_buffer.speech_started':
        if(handsFree){ if(state === 'speaking') cancelOutput(); setState('listening'); }
        break;
      case 'input_audio_buffer.speech_stopped':
        if(handsFree){ heardStart = performance.now(); setState('thinking'); }
        speechEndAt = performance.now();
        break;
      case 'conversation.item.added': case 'conversation.item.created': trackItem(ev.item); break;
      case 'response.function_call_arguments.done':      // primer momento en que la orden está completa
        onToolCall(ev.name, ev.arguments, ev.call_id);
        break;
      case 'response.output_item.done':                  // respaldo
        if(ev.item && ev.item.type === 'function_call') onToolCall(ev.item.name, ev.item.arguments, ev.item.call_id);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        onTranscript(ev.transcript);
        dropItem(ev.item_id);
        break;
      case 'response.created':
        if(!assistantBusy && state !== 'listening') setState('thinking');
        break;
      case 'output_audio_buffer.started':
        setState('speaking'); break;
      case 'output_audio_buffer.stopped':
        assistantBusy = false; clearTimeout(busyTimer); if(state === 'speaking' || state === 'thinking') setState('ready'); break;
      case 'response.done':
        flushCallItems();
        clearTimeout(busyTimer);
        busyTimer = setTimeout(() => { if(!natural() || !assistantBusy){ assistantBusy = false; if(state === 'speaking' || state === 'thinking') setState('ready'); } }, 400);
        break;
      case 'error':
        console.warn('Realtime error', ev.error);
        if(ev.error && /invalid_api_key|authentication|expired/i.test(JSON.stringify(ev.error))) fatal('La clave de voz no es válida o caducó.');
        else if(typeof aviso === 'function' && ev.error && ev.error.message) aviso(ev.error.message);
        assistantBusy = false;
        if(state === 'thinking') setState('ready');
        break;
    }
  }

  /* ---------- Pulsar para hablar ---------- */
  function cancelOutput(){
    send({ type:'response.cancel' });
    send({ type:'output_audio_buffer.clear' });
    assistantBusy = false;
    if('speechSynthesis' in window) speechSynthesis.cancel();
  }
  function pttStart(){
    holding = true; holdStart = performance.now();
    if(window.ASDAudio) ASDAudio.resume();
    if(!pc){ connect(); return; }                 // al abrirse, onOpen reanuda si sigue pulsado
    if(state === 'connecting' || handsFree) return;
    if(state === 'speaking' || state === 'thinking') cancelOutput();   // se puede interrumpir a Marina
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
    heardStart = performance.now();
    send({ type:'input_audio_buffer.commit' });
    send({ type:'response.create' });              // la respuesta es siempre una llamada a herramienta (sesión: tool_choice required, salida de texto)
    setState('thinking');
  }

  function setHandsFree(on){
    handsFree = !!on;
    if(micTrack) micTrack.enabled = handsFree;
    if(dc && dc.readyState === 'open'){
      refreshSession();
      send({ type:'session.update', session:{ type:'realtime', instructions, tools: sessionTools, audio:{ input:{ turn_detection: handsFree ? VAD() : null } } } });
    }
    if(handsFree && !pc) connect();
  }

  /* ---------- Salida de voz local ---------- */
  function pickFemaleVoice(lang){
    const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
    const own = vs.filter(v => new RegExp('^' + (lang === 'en' ? 'en' : 'es'), 'i').test(v.lang));
    const rank = v => (/natural|neural|online/i.test(v.name) ? 2 : 0) + (/(female|mujer|sabina|helena|paulina|monica|elena|laura|maria|dalia|salome|zira|samantha|aria|jenny|google)/i.test(v.name) ? 1 : 0);
    return own.slice().sort((a, b) => rank(b) - rank(a))[0] || null;
  }
  function speakFallback(text, lang){
    if(!('speechSynthesis' in window)) return;
    if(window.ASDAudio && ASDAudio.getPrefs().muted.voz) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickFemaleVoice(lang); if(v){ u.voice = v; u.lang = v.lang; } else u.lang = lang === 'en' ? 'en-US' : 'es-CO';
    u.rate = 1.1; u.pitch = 1.05;
    speechSynthesis.speak(u);
  }
  if('speechSynthesis' in window) speechSynthesis.getVoices();      // calienta la lista de voces

  function isLive(){ return !!dc && dc.readyState === 'open' && state !== 'off' && state !== 'error' && state !== 'connecting'; }

  /* announce: habla una frase fija sin interrumpir al práctico (si habla o espera respuesta, se encola). Ya no hay avisos espontáneos:
     solo lo usa hablar() para lo que el práctico pidió con un botón. */
  function announce(text, opt){
    opt = opt || {};
    const lang = 'es';
    const phrase = (text && typeof text === 'object') ? (text.es || text.en) : text;
    if(!phrase) return;
    const key = opt.key || String(phrase).slice(0, 24);
    const now = Date.now();
    if(opt.cooldownMs && lastAt.has(key) && now - lastAt.get(key) < opt.cooldownMs) return;
    lastAt.set(key, now);
    const busyUser = state === 'listening' || state === 'thinking';
    if(busyUser && opt.prio !== 'critical'){ queue.set(key, { text: phrase, lang }); return; }
    say(phrase, lang);
  }
  function flushQueue(){
    if(!queue.size) return;
    const [key, v] = queue.entries().next().value;
    queue.delete(key);
    say(v.text, v.lang);
  }

  /* hablar(): solo lo que el práctico pide con un botón (lectura del asesor IA). Las alarmas ya no hablan. */
  window.hablar = function(texto, opt){
    if(!texto) return;
    announce(texto, Object.assign({ key:'hablar:' + texto.slice(0, 18), lang:'es' }, opt || {}));
  };

  /* ---------- Cableado de la interfaz ---------- */
  function wireUi(){
    tools = VoiceTools.create(SimAPI);
    loadGrammar();
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

    if(mic){   // precalentado: abre la llamada al acercarse al botón (solo si el micrófono ya está permitido: sin avisos por sorpresa)
      const warm = () => {
        if(pc || state !== 'off' || (!currentUserKey() && !cfg.tokenEndpoint && !hasDefaultKey()) || !navigator.permissions || !navigator.permissions.query) return;
        navigator.permissions.query({ name:'microphone' }).then(r => { if(r.state === 'granted' && !pc && state === 'off') connect(); }).catch(() => {});
      };
      mic.addEventListener('pointerenter', warm); mic.addEventListener('focus', warm);
    }
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
      say(r.status === 'ok' ? (lastLang === 'en' ? 'Done.' : 'Hecho.') : (lastLang === 'en' ? 'Unable.' : 'No se pudo.'), lastLang);
    });
    if(no) no.addEventListener('click', () => { if(!tools) return; tools.cancelPending(); refreshConfirmBar(); say(lastLang === 'en' ? 'Cancelled.' : 'Cancelado.', lastLang); });
    // la guía se genera desde la base: un solo manejador sobre el contenedor
    ['guideEs', 'guideEn'].forEach(id => { const box = byId(id); if(box) box.addEventListener('click', e => { const b = e.target.closest('.phrase'); if(b){ if(window.ASDAudio) ASDAudio.resume(); sendText(b.textContent); } }); });
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

  /* ---------- Evaluador de frases (desarrollo): ASDVoice.evalPhrases() en la consola ----------
     Envía cada frase como TEXTO a la sesión abierta y compara la herramienta que llama el modelo con la que resuelve la gramática local.
     No ejecuta nada en el simulador. Mide obediencia al prompt y latencia del modelo (no el reconocimiento de audio). */
  const EVAL_NEGATIVES = [
    { text:'¿Qué hora es?', expect:['ignore'] }, { text:'Esto está difícil hoy', expect:['ignore'] }, { text:'Hola, ¿me escuchas?', expect:['ignore'] },
    { text:'¿Tú qué opinas del viento?', expect:['ignore', 'unclear'] }, { text:'Rumbo treinta', expect:['unclear'] }, { text:'Cae a babor', expect:['unclear', 'ignore'] }
  ];
  function evalExpectation(p){
    if(p.status === 'ok') return null;
    return p.status === 'no_match' ? ['ignore', 'unclear'] : ['unclear'];
  }
  async function evalPhrases(list){
    const g = await loadGrammar(); if(!g) throw new Error('Base de órdenes no cargada');
    if(!isLive()){
      connect();
      await new Promise((ok, no) => { const t0 = Date.now(), iv = setInterval(() => { if(isLive()){ clearInterval(iv); ok(); } else if(Date.now() - t0 > 15000){ clearInterval(iv); no(new Error('Sin conexión de voz')); } }, 100); });
    }
    const base = [];
    dbRef.commands.forEach(c => ['es', 'en'].forEach(l => (c.examples[l] || []).forEach(t => base.push({ text:t }))));
    const items = (list && list.length ? list : base.concat(EVAL_NEGATIVES)).map(x => typeof x === 'string' ? { text:x } : x);
    const rows = [];
    for(const it of items){
      const p = g.parse(it.text), expect = it.expect || evalExpectation(p);
      const got = await new Promise(resolve => {
        const to = setTimeout(() => { evalWait = null; resolve({ name:'(sin respuesta)', args:{}, ms:null }); }, 10000);
        const w = r => { clearTimeout(to); resolve(r); }; w.t0 = performance.now(); evalWait = w;
        send({ type:'conversation.item.create', item:{ type:'message', role:'user', content:[{ type:'input_text', text:it.text }] } });
        send({ type:'response.create' });
      });
      let ok;
      if(expect) ok = expect.indexOf(got.name) >= 0;
      else if(got.name === 'report') ok = !!(VP.REPORTS[got.args.topic] && VP.REPORTS[got.args.topic].id === p.id);
      else if(p.kind === 'confirm' || p.kind === 'cancel' || p.kind === 'repeat') ok = got.name === p.kind;
      else { const clean = Object.assign({}, got.args); delete clean.lang; delete clean.wake; const q = g.fromTool(got.name, clean); ok = !!(q && q.id === p.id); }
      rows.push({ frase: it.text, esperada: expect ? expect.join('|') : p.id, llamada: got.name + (got.args && got.args.topic ? ':' + got.args.topic : ''), ok, ms: got.ms });
      await new Promise(r => setTimeout(r, 150));         // deja que response.done borre los ítems del turno
    }
    const ms = rows.map(r => r.ms).filter(v => v != null).sort((a, b) => a - b);
    const summary = { total: rows.length, aciertos: rows.filter(r => r.ok).length, mediana_ms: ms.length ? ms[ms.length >> 1] : null, p95_ms: ms.length ? ms[Math.floor(ms.length * 0.95)] : null, modelo: cfg.model };
    console.table(rows.filter(r => !r.ok)); console.log('Evaluación de voz', summary);
    return { rows, summary };
  }

  window.ASDVoice = { connect, disconnect, isLive, announce, sendText, setHandsFree, pending: () => tools ? tools.getPending() : null, refreshConfirm: refreshConfirmBar,
                      evalPhrases, log: voiceLog, apiKey: effectiveKey,
                      _toolCall: onToolCall, _event: onEvent, get state(){ return state; }, get tools(){ return sessionTools; }, get instructions(){ return instructions; } };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUi); else wireUi();
})();
