/* ASD Bridge Simulator: voz con la API Realtime de OpenAI (WebRTC directo desde el navegador).
 *
 * Una sola vuelta, sin cuellos de botella:
 *   1. El práctico habla. El modelo OYE el audio y responde SOLO con una llamada a herramienta (tool_choice 'required', salida de texto:
 *      nunca habla ni escribe prosa). No hay paso previo por una transcripción.
 *   2. La llamada se valida contra data/bridge-commands.json (grammar.fromTool): si no existe en la base, NO se ejecuta.
 *   3. Se ejecuta al instante con VoiceTools/SimAPI y Marina repite con una frase fija y breve, generada localmente (voz del navegador:
 *      sin segunda vuelta al modelo). Opcional: voz natural de OpenAI.
 *   4. La transcripción (en paralelo, solo informa) se compara con la base: si lo oído era otra orden, se avisa en pantalla.
 *   5. Sin pedirlo, solo habla una alarma crítica y "rumbo alcanzado". Informes y recomendaciones, solo si los pides.
 *
 * La práctica escrita y las frases de la guía usan la gramática local (js/grammar.js): instantáneas y sin conexión.
 *
 * Claves: NUNCA se guardan en el repositorio.
 *   - Pruebas: clave en el campo "Clave de OpenAI" (sessionStorage) o js/config.local.js (ignorado por git).
 *   - Producción: ASD_CONFIG.tokenEndpoint apunta al Worker de worker/realtime-token.js.
 */
(function(){
  'use strict';

  const cfg = Object.assign({ model:'gpt-realtime', voice:'marin', transcriptionModel:'gpt-4o-mini-transcribe', tokenEndpoint:null, openaiKey:null }, window.ASD_CONFIG || {});
  const byId = id => document.getElementById(id);
  const KEY_STORE = 'asd.openaiKey';
  const MIN_HOLD_MS = 250;
  const DB_URL = 'data/bridge-commands.json';

  /* Herramientas "de consulta" y de control que el modelo puede llamar además de las órdenes. Todas llevan lang y wake. */
  const QUERY = {
    report_heading:  { tool:'get_status',   id:'q_heading',   desc:'El práctico pregunta el rumbo ("¿cuál es el rumbo?", "what is the heading").' },
    report_status:   { tool:'get_status',   id:'q_status',    desc:'El práctico pide el estado ("informa el estado", "report status").' },
    report_drift:    { tool:'drift_report', id:'q_drift',     desc:'El práctico pide el informe de deriva o caída ("¿cómo cae la proa?", "report drift").' },
    recommendation:  { tool:'drift_report', id:'q_recommend', desc:'El práctico pide una recomendación ("recomendación", "what do you recommend").' }
  };
  const CONTROL = {
    confirm: 'El práctico confirma una acción pendiente ("confirmo", "sí, hazlo", "confirm").',
    cancel:  'El práctico cancela una acción pendiente ("cancela", "negativo", "cancel").',
    repeat:  'El práctico pide repetir lo último ("repite", "say again").',
    unclear: 'Hay una orden pero no la entiendes bien o no está en la lista (incluye un rumbo dicho como número, por ejemplo "treinta"). No ejecuta nada: Marina dirá "Repita".',
    ignore:  'No es una orden de puente: charla, ruido, una frase suelta, o en manos libres una frase que no empieza por "Marina". No hace nada.'
  };

  /* ---------- Estado ---------- */
  let pc = null, dc = null, micStream = null, micTrack = null, audioEl = null;
  let state = 'off';            // off | connecting | ready | listening | thinking | speaking | error
  let handsFree = false;
  let holding = false, holdStart = 0, heardStart = 0;
  let tools = null, grammar = null, grammarReady = null, sessionTools = null, instructions = '';
  let assistantBusy = false;
  let busyTimer = null;
  let lastLang = 'es', lastSaid = null;
  let lastCall = null;          // última orden ejecutada por el modelo (para compararla con la transcripción)
  const handledCalls = new Set();
  const queue = new Map();      // key -> {text, lang}
  const lastAt = new Map();     // key -> ts (antirrebote)

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

  /* Herramientas de la sesión: las de VoiceTools (menos confirm_action, que lleva token) + consultas y control. Todas con lang y wake. */
  function buildSessionConfig(db){
    const extra = { lang:{ type:'string', enum:['es','en'], description:'Idioma en que habló el práctico.' },
                    wake:{ type:'boolean', description:'true solo si la frase empezó por "Marina".' } };
    const wrap = (name, description, params) => ({ type:'function', name, description,
      parameters:{ type:'object', properties:Object.assign({}, (params && params.properties) || {}, extra), required:((params && params.required) || []).concat(['lang', 'wake']) } });
    const list = VoiceTools.definitions.filter(d => d.name !== 'confirm_action' && d.name !== 'get_status' && d.name !== 'drift_report').map(d => wrap(d.name, d.description, d.parameters));
    Object.keys(QUERY).forEach(n => list.push(wrap(n, QUERY[n].desc)));
    Object.keys(CONTROL).forEach(n => list.push(wrap(n, CONTROL[n])));
    sessionTools = list;

    // Instrucciones cortas y de una sola tarea. La tabla sale de la base: ejemplo -> herramienta.
    const rows = db.commands.filter(c => c.tool && c.kind !== 'query').map(c => `"${c.examples.es[0] || ''}" / "${c.examples.en[0] || ''}" -> ${c.tool}${c.args ? ' ' + JSON.stringify(c.args) : ''}`);
    instructions = 'Eres el OÍDO de un timonel, no un asistente. Cada vez que el práctico habla, llama EXACTAMENTE UNA herramienta con lo que dijo, sin inventar, completar ni corregir nada. NUNCA hables ni escribas texto.\n' +
      '- Si no es una orden de la lista, o no estás seguro: unclear. Si es charla o ruido: ignore.\n' +
      '- Rumbos: tres dígitos hablados uno a uno ("cero nueve cero" = 90). Un rumbo dicho como número ("treinta") es unclear.\n' +
      '- Viento y corriente: "por el X" = DESDE X. "hacia X" = toward. "a N" = valor absoluto; "en N" o "N más/menos" = incremento (delta_knots, negativo si baja).\n' +
      '- lang = "en" si habló en inglés, "es" si en español. wake = true solo si la frase empezó por "Marina".\n' +
      '- Manos libres: si wake es false, llama ignore.\n' +
      'Ejemplos (frase -> herramienta):\n' + rows.join('\n');
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
    queue.clear(); handledCalls.clear();
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
      send({ type:'session.update', session:{
        type:'realtime', model:cfg.model,
        output_modalities:['text'],                       // el modelo no habla: solo llama herramientas
        instructions, tools: sessionTools || [], tool_choice:'required', max_output_tokens: 120,
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
    lastLang = lang || lastLang;
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
    let res;
    if(p.kind === 'confirm'){ res = tools.getPending() ? tools.confirmPending() : { status:'error', error:'no_pending' }; }
    else if(p.kind === 'cancel'){
      if(!tools.getPending()) return null;                 // un "no" suelto no es una orden
      tools.cancelPending(); res = { status:'ok' };
    }
    else if(p.kind === 'repeat'){ if(lastSaid) say(lastSaid.text, lastSaid.lang); return null; }
    else res = tools.execute(p.tool, p.args, { origin:'user' });     // se ejecuta ANTES de hablar: la voz no retrasa la maniobra
    refreshConfirmBar();
    if(window.ASDAudio) ASDAudio.play(res && res.status === 'error' ? 'alarmSoft' : 'ack');
    const out = grammar.speak(p, res);
    say(out.text, out.lang);
    const ms = heardStart ? Math.round(performance.now() - heardStart) : null;
    if(ms != null) document.dispatchEvent(new CustomEvent('asd:order', { detail:{ id:p.id, latencyMs:ms, text:out.text } }));
    return res;
  }

  /* Llamada a herramienta del modelo (lo que OYÓ). Solo se ejecuta lo que existe en la base. */
  function onToolCall(name, rawArgs, callId){
    if(callId){ if(handledCalls.has(callId)) return; handledCalls.add(callId); }
    let args = {}; try{ args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {}); }catch(e){}
    const lang = args.lang === 'en' ? 'en' : 'es', wake = !!args.wake;
    const g = grammar; if(!g) return;
    if(callId) send({ type:'conversation.item.create', item:{ type:'function_call_output', call_id:callId, output:'{"ok":true}' } });   // cierra la llamada, sin respuesta
    assistantBusy = false; if(state === 'thinking') setState('ready');
    lastCall = null;
    if(name === 'ignore') return;
    if(handsFree && !wake) return;                                    // manos libres: solo con "Marina"
    if(name === 'unclear'){ lastLang = lang; say(g.speak({ status:'no_match', lang }).text, lang); return; }
    let p;
    if(CONTROL[name] && name !== 'unclear'){ p = { status:'ok', id:name, kind:name, lang, args:{}, caps:{} }; }
    else if(QUERY[name]){
      const q = QUERY[name], res = tools.execute(q.tool, {}, { origin:'user' });
      const out = g.speak({ status:'ok', id:q.id, kind:'query', lang, caps:{} }, res);
      refreshConfirmBar(); say(out.text, lang); lastCall = { sig:name }; return;
    } else {
      const clean = Object.assign({}, args); delete clean.lang; delete clean.wake;
      p = g.fromTool(name, clean, lang);
      if(!p){ say(g.speak({ status:'no_match', lang }).text, lang); return; }   // no está en la base: no se ejecuta
    }
    if(p.kind === 'confirm' || p.kind === 'cancel' || p.kind === 'repeat'){ lastCall = { sig:p.kind }; runParsed(p); return; }
    lastCall = { sig:p.id, tool:p.tool, args:p.args };
    runParsed(p);
  }

  /* Transcripción (llega en paralelo): solo informa y vigila. Si lo oído era OTRA orden de la base, se avisa en pantalla. */
  function onTranscript(text){
    text = (text || '').trim(); if(text.length < 2 || !grammar) return;
    caption('user', 'Oí: «' + text + '»', true);
    const p = grammar.parse(text);
    if(p.status !== 'ok' || !lastCall) return;
    const same = lastCall.sig === p.id || lastCall.sig === (p.kind === 'query' ? Object.keys(QUERY).find(k => QUERY[k].id === p.id) : null) ||
                 (lastCall.tool === p.tool && JSON.stringify(lastCall.args) === JSON.stringify(p.args));
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
    if(p.status !== 'ok'){ if(window.ASDAudio) ASDAudio.play('alarmSoft'); say(g.speak(p).text, p.lang || lastLang); return; }
    lastCall = null;
    runParsed(p);
  }

  /* ---------- Eventos del servidor ---------- */
  function onEvent(ev){
    switch(ev.type){
      case 'input_audio_buffer.speech_started':
        if(handsFree){ if(state === 'speaking') cancelOutput(); setState('listening'); }
        break;
      case 'input_audio_buffer.speech_stopped':
        if(handsFree){ heardStart = performance.now(); setState('thinking'); }
        break;
      case 'response.function_call_arguments.done':      // primer momento en que la orden está completa
        onToolCall(ev.name, ev.arguments, ev.call_id);
        break;
      case 'response.output_item.done':                  // respaldo
        if(ev.item && ev.item.type === 'function_call') onToolCall(ev.item.name, ev.item.arguments, ev.item.call_id);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        onTranscript(ev.transcript);
        break;
      case 'response.created':
        if(!assistantBusy && state !== 'listening') setState('thinking');
        break;
      case 'output_audio_buffer.started':
        setState('speaking'); break;
      case 'output_audio_buffer.stopped':
        assistantBusy = false; clearTimeout(busyTimer); if(state === 'speaking' || state === 'thinking') setState('ready'); break;
      case 'response.done':
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
      send({ type:'session.update', session:{ type:'realtime', audio:{ input:{ turn_detection: handsFree ? VAD() : null } } } });
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

  /* announce: frases fijas que la app dice sin que se las pidan (SOLO alarmas críticas y "rumbo alcanzado").
     Nunca interrumpen al práctico: si habla o espera respuesta, se encolan. Solo una alarma crítica corta a Marina si es ELLA quien habla. */
  function announce(text, opt){
    opt = opt || {};
    const lang = opt.lang || lastLang;
    const phrase = (text && typeof text === 'object') ? (text[lang] || text.es) : text;
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

  /* hablar() existente (alarmas de varada y UKC crítico; lectura del asesor IA que el práctico pide con el botón) */
  window.hablar = function(texto, opt){
    if(!texto) return;
    const critical = /cr[ií]tica|encallado|poco profundas/i.test(texto);
    announce(texto, Object.assign({ key:'hablar:' + texto.slice(0, 18), prio: critical ? 'critical' : 'normal', lang:'es' }, opt || {}));
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

  window.ASDVoice = { connect, disconnect, isLive, announce, sendText, setHandsFree, pending: () => tools ? tools.getPending() : null, refreshConfirm: refreshConfirmBar,
                      _toolCall: onToolCall, get state(){ return state; }, get tools(){ return sessionTools; }, get instructions(){ return instructions; } };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUi); else wireUi();
})();
