/* ASD Bridge Simulator: instrucciones y herramientas de la sesión de voz (OpenAI Realtime).
 *
 * El modelo es solo el OÍDO: en cada turno llama UNA herramienta y nunca habla. Este módulo construye, a partir de la base de
 * órdenes (data/bridge-commands.json), el prompt y el esquema de herramientas. Es puro (sin DOM): navegador (`window.ASDVoicePrompt`)
 * y Node (`node --test tests/`). El texto es determinista: idéntico entre turnos para aprovechar el caché de prompt de OpenAI.
 *
 * Estructura del prompt (guía de prompting de OpenAI para modelos Realtime): reglas en viñetas cortas, una sección por tema,
 * ejemplos frase -> llamada (incluidos los negativos) y condiciones escritas como "SI ... ENTONCES ...".
 */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.ASDVoicePrompt = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  /* Informes: tema que oye el modelo -> id de la base (js/grammar.js compone la frase, sin modelo). */
  const REPORTS = {
    heading:        { id: 'q_heading',   desc: 'rumbo actual y ordenado ("¿cuál es el rumbo?", "what is the heading")' },
    status:         { id: 'q_status',    desc: 'estado general ("informa el estado", "report status")' },
    weather:        { id: 'q_weather',   desc: 'meteo: viento, corriente, mar y marea ("informe meteorológico", "weather report")' },
    track:          { id: 'q_track',     desc: 'seguimiento de la derrota: punto, distancia, desvío lateral ("informe de derrota", "track report")' },
    leeway:         { id: 'q_leeway',    desc: 'abatimiento y deriva en grados ("informe de abatimiento", "informe de deriva", "report leeway")' },
    fall:           { id: 'q_drift',     desc: 'caída de la proa y de la popa ("¿cómo cae la proa?", "how is the bow falling")' },
    depth:          { id: 'q_depth',     desc: 'profundidad y UKC ("informe de profundidad", "what is the UKC")' },
    speed:          { id: 'q_speed',     desc: 'velocidad, máquinas y empuje ("informe de velocidad", "speed report")' },
    recommendation: { id: 'q_recommend', desc: 'sugerencia para mantener rumbo y derrota ("recomendación", "what do you recommend")' },
    full:           { id: 'q_full',      desc: 'informe completo ("informe completo", "full report")' }
  };
  const TOPIC_BY_ID = {}; Object.keys(REPORTS).forEach(t => { TOPIC_BY_ID[REPORTS[t].id] = t; });

  /* Herramientas de control: sin argumentos propios. */
  const CONTROL = {
    confirm: 'USA cuando el práctico confirma una acción pendiente ("confirmo", "sí, hazlo", "confirm"). NO la uses si no hay una pregunta de confirmación reciente: entonces ignore.',
    cancel:  'USA cuando el práctico cancela una acción pendiente ("cancela", "negativo", "cancel").',
    repeat:  'USA cuando el práctico pide repetir lo último que dijo Marina ("repite", "say again").',
    unclear: 'USA SOLO cuando el práctico dio una orden o pidió un informe y FALTA un dato obligatorio (indica cuál en missing: Marina lo preguntará) o el audio es ininteligible (missing = other). NO la uses porque la frase no esté en los ejemplos: si entiendes la intención, llama la herramienta que corresponde. Un rumbo dicho como número ("treinta") también es unclear (missing = heading).',
    ignore:  'USA para charla, preguntas generales, opiniones, ruido, silencio, una frase suelta o, en manos libres, una frase que no empieza por "Marina". No hace nada. NO la uses si hubo una orden o un informe claros.'
  };

  const MISSING = ['heading', 'side', 'angle', 'degrees', 'value', 'direction', 'engine', 'speed', 'percent', 'other'];
  const OMIT = ['confirm_action', 'get_status', 'drift_report'];       // las gestiona la app (token) o van dentro de `report`

  /* Esquema de herramientas de la sesión. Todas llevan `lang`; `wake` solo en manos libres (en PTT no aporta nada y estorba). */
  function buildTools(defs, opts){
    const hands = !!(opts && opts.handsFree);
    const extra = { lang: { type: 'string', enum: ['es', 'en'], description: 'Idioma en que habló el práctico.' } };
    if(hands) extra.wake = { type: 'boolean', description: 'true solo si la frase empezó por "Marina".' };
    const req = hands ? ['lang', 'wake'] : ['lang'];
    const wrap = (name, description, params) => ({ type: 'function', name, description,
      parameters: { type: 'object', properties: Object.assign({}, (params && params.properties) || {}, extra), required: ((params && params.required) || []).concat(req) } });
    const list = defs.filter(d => OMIT.indexOf(d.name) < 0).map(d => wrap(d.name, d.description, d.parameters));
    const UNCLEAR_PARAMS = { properties: { missing: { type: 'string', enum: MISSING, description: 'Dato que falta. other = audio ininteligible.' } }, required: ['missing'] };
    list.push(wrap('report',
      'Informe o sugerencia de SOLO LECTURA. USA solo cuando el práctico lo pide con claridad. NO la uses para dar órdenes ni por iniciativa propia. Temas: ' +
      Object.keys(REPORTS).map(t => `${t} = ${REPORTS[t].desc}`).join('; ') + '.',
      { properties: { topic: { type: 'string', enum: Object.keys(REPORTS) } }, required: ['topic'] }));
    Object.keys(CONTROL).forEach(n => list.push(wrap(n, CONTROL[n], n === 'unclear' ? UNCLEAR_PARAMS : null)));
    return list;
  }

  /* Ejemplos "frase -> llamada" sacados de la base; `parse` es grammar.parse (resuelve los argumentos exactos). */
  function exampleLines(db, parse){
    const out = [];
    const take = { es: 2, en: 1 };
    db.commands.forEach(c => ['es', 'en'].forEach(lang => (c.examples[lang] || []).slice(0, take[lang]).forEach(t => {
      const p = parse(t);
      if(p.status !== 'ok') return;
      let call;
      if(p.kind === 'query') call = 'report ' + JSON.stringify({ topic: TOPIC_BY_ID[p.id] });
      else if(p.kind === 'confirm' || p.kind === 'cancel' || p.kind === 'repeat') call = p.kind;
      else call = p.tool + (p.args && Object.keys(p.args).length ? ' ' + JSON.stringify(p.args) : '');
      out.push(`"${t}" -> ${call}`);
    })));
    return out;
  }

  /* Catálogo por familias (IMO SMCP A.918(22) y uso de puente): el modelo mapea sinónimos y paráfrasis a la herramienta, no solo repite ejemplos. */
  const FAMILIES = [
    'Rumbo (steer_course): "steer/steady on/come to/make course N", "rumbo/gobierna al/pon proa al N", "port|starboard, steer N" (la banda se ignora).',
    'Caída (alter_course): "cae/caiga/cambia N grados a babor|estribor", "alter/come/turn N degrees to port|starboard".',
    'Timón (helm_order): "port|starboard N" / "N a babor|estribor" / "meta N a babor" / "caña a estribor N" (port/starboard + angle); "todo a|hard to" (hard_*); "a la vía|midships" (midships); "así|steady|steady as she goes|meet her" (steady); "ease to N|menos caña N" (ease + angle); "nada a babor|nothing to port" (nothing_port / nothing_starboard).',
    'Máquinas (engine_order): full/half/slow/dead slow ahead|astern = toda|media|poca|muy poca avante|atrás (ciar = atrás); "emergency|crash" = full; stop = para máquinas; side port|starboard para un solo motor ("máquina de babor"), both para "ambas"; DOS motores distintos = engine_pair; all_stop = alto general / finished with engines / fin de maniobra; standby = stand by engines / atención máquinas.',
    'Velocidad (speed_order): "mantén/maintain/make N nudos|knots" (knots), "aumenta/reduce la velocidad en N" (delta_knots); sin número "reduce/aumenta velocidad" = engine_step; potencia en porcentaje = power_percent ("empuje/push/power N por ciento").',
    'Ambiente: set_wind (SIEMPRE desde), set_current (por/del = desde; hacia = toward), set_sea (olas hs_m, marea tide_m). Un número con "grados" junto a otra dirección con "por el" es la INTENSIDAD (error de unidad): "viento de 45 grados por el 000" = knots 45, from_deg 0.',
    'Mando: manual_control = control manual / take the con / finished with wheel / fin de gobierno; set_autopilot = sigue la derrota; sim_control, set_sim_speed, route, ui, place_vessel según su descripción.'
  ];

  /* Qué significa cada orden (IMO SMCP A.918(22) y uso de puente). Es lo que más se confunde: el número de "estribor 10" son grados de TIMÓN. */
  const DISTINCTIONS = [
    '- TIMÓN (helm_order) = banda + número SIN verbo de rumbo: "estribor 10", "babor 15", "diez a estribor", "starboard ten", "meta diez a babor". El número son grados de TIMÓN (ángulo de la pala), NO grados de rumbo. La proa cae sin parar hacia esa banda HASTA NUEVA ORDEN (así/steady, a la vía, otro timón o un rumbo).',
    '- CAMBIO DE RUMBO (alter_course) = verbo de rumbo + grados + banda: "cae 10 grados a estribor", "cambia el rumbo 10 grados a babor", "alter course 10 degrees". La proa gira esos grados y se queda en el rumbo nuevo.',
    '- RUMBO (steer_course) = ir a un rumbo absoluto: "rumbo cero nueve cero", "pon proa al 090", "steer 090", "port, steer 182".',
    '- ASÍ / STEADY (helm_order steady) = frena el giro y mantiene el rumbo al que llegó la proa. A LA VÍA / MIDSHIPS (midships) = pala al centro: no fija rumbo, la proa puede seguir girando por inercia. "Así, rumbo 090" o "steady on 090" = steer_course.',
    '- MENOS CAÑA N / EASE TO N (ease) = reducir el timón actual a N grados, misma banda. NADA A BABOR|ESTRIBOR / NOTHING TO (nothing_port|nothing_starboard) = que la proa no vaya más hacia esa banda. MEET HER = frenar el giro (steady). TODO A / HARD TO = timón al máximo.',
    '- MÁQUINAS: engine_order = posición fija del telégrafo (full/half/slow/dead slow ahead|astern, stop). speed_order = velocidad objetivo en nudos que se MANTIENE. power_percent = porcentaje fijo de empuje. engine_step = un punto más o menos.',
    '- Una banda con número y sin verbo de rumbo NUNCA es alter_course.'
  ];

  const NEGATIVES = [
    '"¿Qué hora es?" -> ignore',
    '"Esto está difícil hoy" -> ignore',
    '"Rumbo treinta" -> unclear {"missing":"heading"}   (el rumbo se dice por dígitos)',
    '"Cae a babor" -> unclear {"missing":"degrees"}   (falta el valor)',
    '"Mmm... la..." (frase cortada, ininteligible) -> unclear {"missing":"other"}',
    '"Estribor 10" -> helm_order {"order":"starboard","angle":10}   (timón: la proa cae sin parar; NO es cambio de rumbo)',
    '"Starboard ten" -> helm_order {"order":"starboard","angle":10}',
    '"Babor quince" -> helm_order {"order":"port","angle":15}',
    '"Cae diez grados a estribor" -> alter_course {"side":"starboard","degrees":10}   (cambio de rumbo de 10 grados)',
    '"Timón a la vía" -> helm_order {"order":"midships"}   (pala al centro; no es "así")',
    '"Así" -> helm_order {"order":"steady"}',
    '"¿Tú qué opinas del viento?" -> ignore   (no es un informe de la lista; solo "report" cuando lo piden con claridad)',
    '"Hola, ¿me escuchas?" -> ignore',
    '(silencio o ruido) -> ignore'
  ];

  function buildInstructions(db, parse, opts){
    const hands = !!(opts && opts.handsFree);
    return [
      '# Rol',
      '- Eres el OÍDO de un timonel y maquinista de puente. NO eres un asistente ni conversas.',
      '- En cada turno de audio del práctico llamas EXACTAMENTE UNA herramienta de la lista. Nunca dos.',
      '- NUNCA hables. NUNCA escribas texto. SIN preámbulo antes de la llamada. SIN sonidos ni muletillas.',
      '',
      '# Regla de mando',
      '- SOLO el práctico decide. Ejecutas únicamente lo que ordena o pide en ESE turno.',
      '- Informes y sugerencias (herramienta report) SOLO SI los pide con claridad. NUNCA por iniciativa, NUNCA "para ayudar", NUNCA después de una orden.',
      '- No inventes, completes, corrijas ni deduzcas valores que no dijo. SI falta un dato obligatorio ENTONCES unclear.',
      '- Una orden por turno: si dijo varias, llama solo la primera completa y entendida.',
      '',
      '# Idioma',
      '- lang = idioma de la frase completa: es o en. No lo deduzcas por el acento. Ignora muletillas ("eh", "ok", "aye", "por favor").',
      hands ? '- Manos libres: wake = true SOLO si la frase empezó por "Marina". SI wake es false ENTONCES llama ignore.' : '- Pulsar para hablar: lo que oyes es para ti; no necesitas la palabra "Marina".',
      '',
      '# Intención',
      '- Entiende la INTENCIÓN, no busques la frase exacta. El práctico usa sinónimos y modismos de puente (IMO SMCP y uso marinero) en es y en.',
      '- SI la orden se relaciona con una herramienta, aunque no esté en los ejemplos, ENTONCES llama esa herramienta con los valores que dijo.',
      '- Errores de palabra o de unidad: usa el sentido ("viento de 45 grados por el 000" = 45 nudos desde 000).',
      '- Si el valor viene dicho de otra forma (palabra, cifras sueltas, punto cardinal), conviértelo al argumento de la herramienta.',
      '',
      '# Audio poco claro',
      '- unclear SOLO si falta un dato obligatorio (pon cuál en missing) o el audio es ininteligible (missing = other). NUNCA solo porque la frase no está en los ejemplos.',
      '- SI es charla, una pregunta general, una opinión, ruido o silencio ENTONCES ignore.',
      '',
      '# Datos',
      '- Rumbos: tres dígitos hablados uno a uno ("cero nueve cero" = 90). Un rumbo dicho como número ("treinta") es unclear.',
      '- Viento y corriente: "por el X" o "del X" = DESDE X (from). "hacia X" = toward. Direcciones: grados o punto cardinal (norte, noreste, east...).',
      '- "a N" = valor absoluto. "en N", "N más" o "N menos" = incremento (delta_knots, negativo si baja).',
      '- Banda: babor = port, estribor = starboard. Timón: "diez a babor" = port 10.',
      '',
      '# Distinciones (no las confundas)',
      DISTINCTIONS.join('\n'),
      '',
      '# Familias de órdenes',
      FAMILIES.join('\n'),
      '',
      '# Ejemplos (frase -> llamada)',
      exampleLines(db, parse).join('\n'),
      '',
      '# Ejemplos que NO son orden',
      NEGATIVES.join('\n')
    ].join('\n');
  }

  return { REPORTS, TOPIC_BY_ID, CONTROL, MISSING, FAMILIES, DISTINCTIONS, buildTools, buildInstructions, exampleLines };
});
