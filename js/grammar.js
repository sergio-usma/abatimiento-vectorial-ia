/* ASD Bridge Simulator: gramática local de órdenes de puente.
 *
 * Marina NO interpreta: la API de voz solo transcribe. Este módulo compara la transcripción con la base de órdenes
 * (data/bridge-commands.json) y devuelve la orden exacta, o nada. Así nadie improvisa ni obedece "lo que le viene en gana".
 * Compila los patrones una sola vez al cargar; `parse` cuesta microsegundos.
 *
 * Módulo puro (sin DOM): navegador (`window.ASDGrammar`) y Node (`node --test tests/`).
 */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.ASDGrammar = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  function intentsMod(){
    try{ if(typeof module === 'object' && module.exports) return require('./intents.js'); }catch(e){}
    return (typeof self !== 'undefined' && self.ASDIntents) || null;
  }

  const strip = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* ---------- Números hablados (ES/EN) ---------- */
  const UNITS = { cero:0, zero:0, uno:1, un:1, one:1, dos:2, two:2, tres:3, three:3, tree:3, cuatro:4, four:4, cinco:5, five:5, fife:5,
                  seis:6, six:6, siete:7, seven:7, ocho:8, eight:8, nueve:9, nine:9, niner:9 };
  const SPECIAL = { diez:10, ten:10, once:11, eleven:11, doce:12, twelve:12, trece:13, thirteen:13, catorce:14, fourteen:14, quince:15, fifteen:15,
                    dieciseis:16, sixteen:16, diecisiete:17, seventeen:17, dieciocho:18, eighteen:18, diecinueve:19, nineteen:19,
                    veintiuno:21, veintiun:21, veintidos:22, veintitres:23, veinticuatro:24, veinticinco:25, veintiseis:26, veintisiete:27, veintiocho:28, veintinueve:29 };
  const TENS = { veinte:20, twenty:20, treinta:30, thirty:30, cuarenta:40, forty:40, cincuenta:50, fifty:50, sesenta:60, sixty:60,
                 setenta:70, seventy:70, ochenta:80, eighty:80, noventa:90, ninety:90 };
  const DECIMAL = { punto:1, coma:1, point:1, dot:1 };

  const isUnitTok = t => Object.prototype.hasOwnProperty.call(UNITS, t) || /^\d$/.test(t);
  const unitVal = t => Object.prototype.hasOwnProperty.call(UNITS, t) ? UNITS[t] : +t;

  /* Texto -> cadena normalizada. Las cifras dichas dígito a dígito ("cero nueve cero", "0 9 0") se unen en "090";
     los números dichos como palabra ("noventa", "diez") llevan marca "#": sirven para grados, ángulos o nudos pero no para un rumbo. */
  function normalize(text){
    let s = strip(text).replace(/°/g, ' ').replace(/por\s*ciento|porciento|per\s*cent|percent|%/g, ' pct ');
    s = s.replace(/([a-z])-([a-z])/g, '$1 $2').replace(/(\d),(\d)/g, '$1.$2');
    s = s.replace(/[^a-z0-9. ]/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
    if(!s) return '';
    const tk = s.split(' '), out = [];
    for(let i = 0; i < tk.length; ){
      const w = tk[i];
      if(Object.prototype.hasOwnProperty.call(TENS, w)){
        let v = TENS[w], used = 1;
        if(tk[i+1] === 'y' && isUnitTok(tk[i+2]) && unitVal(tk[i+2]) > 0 && w !== 'veinte') { v += unitVal(tk[i+2]); used = 3; }
        else if(isUnitTok(tk[i+1]) && unitVal(tk[i+1]) > 0 && /^[a-z]/.test(tk[i+1])) { v += unitVal(tk[i+1]); used = 2; }
        out.push('#' + v); i += used; continue;
      }
      if(Object.prototype.hasOwnProperty.call(SPECIAL, w)){ out.push('#' + SPECIAL[w]); i++; continue; }
      if(w === 'cien' || w === 'ciento'){
        let v = 100, used = 1;
        if(Object.prototype.hasOwnProperty.call(TENS, tk[i+1])){ v += TENS[tk[i+1]]; used = 2; }
        out.push('#' + v); i += used; continue;
      }
      if(isUnitTok(w)){
        let j = i, digits = '';
        while(j < tk.length && isUnitTok(tk[j])){ digits += unitVal(tk[j]); j++; }
        out.push(digits); i = j; continue;
      }
      out.push(w); i++;
    }
    // decimales: "0 punto 5" -> "0.5"
    const res = [];
    for(let i = 0; i < out.length; i++){
      if(DECIMAL[out[i]] && res.length && /^#?\d+$/.test(res[res.length-1]) && /^\d+$/.test(out[i+1] || '')){ res[res.length-1] += '.' + out[i+1]; i++; }
      else res.push(out[i]);
    }
    return res.join(' ');
  }

  /* ---------- Rumbo dicho dígito a dígito ---------- */
  const DIG = { es: ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve'], en: ['zero','one','two','three','four','five','six','seven','eight','nine'] };
  function spoken(n, lang){
    const d = String(Math.round(((n % 360) + 360) % 360)).padStart(3, '0').split('').map(Number);
    return d.map(i => DIG[lang === 'en' ? 'en' : 'es'][i]).join(' ');
  }

  function create(db){
    const points = Object.keys(db.points).sort((a, b) => b.length - a.length);
    const SLOT = {
      heading: '(\\d{1,3})',
      deg:     '#?(\\d{1,3})',
      angle:   '#?(\\d{1,2})',
      speed:   '#?(\\d{1,2})',
      kn:      '#?(\\d{1,3}(?:\\.\\d+)?)',
      dir:     '(\\d{1,3}|' + points.join('|') + ')',
      side:    '(' + Object.keys(db.sides).join('|') + ')'
    };
    const expand = p => { let s = p, n = 0; while(/%[A-Z_]+%/.test(s) && n++ < 8) s = s.replace(/%[A-Z_]+%/g, m => db.macros[m] || ''); return s; };

    const IM = intentsMod(), loose = IM ? IM.create({ points: db.points }) : null;
    const compiled = [];
    db.commands.forEach(cmd => ['es', 'en'].forEach(lang => (cmd[lang] || []).forEach(pat => {
      const names = [];
      let src = strip(expand(pat)).replace(/\((?!\?)/g, '(?:');
      src = src.replace(/\{(\w+)\}/g, (_, n) => { if(!SLOT[n]) throw new Error('slot desconocido {' + n + '} en ' + cmd.id); names.push(n); return SLOT[n]; });
      if(new Set(names).size !== names.length) throw new Error('slot repetido en ' + cmd.id + ': ' + pat);
      compiled.push({ cmd, lang, names, re: new RegExp('^' + src + '$') });
    })));

    // palabras de relleno al principio o al final ("por favor", "capitán", "aye")
    const fillers = (db.fillers || []).map(strip).sort((a, b) => b.length - a.length);
    const wake = (db.wake || []).map(strip);
    function peel(s){
      let wokeUp = false, again = true;
      while(again){
        again = false;
        for(const w of wake){ if(s === w || s.startsWith(w + ' ')){ s = s.slice(w.length).trim(); wokeUp = true; again = true; } }
        for(const f of fillers){
          if(s === f){ s = ''; again = true; }
          else if(s.startsWith(f + ' ')){ s = s.slice(f.length).trim(); again = true; }
          else if(s.endsWith(' ' + f)){ s = s.slice(0, -f.length - 1).trim(); again = true; }
        }
      }
      return { s, wokeUp };
    }

    function matchAll(s){
      const hits = [];
      compiled.forEach(c => { const m = c.re.exec(s); if(m) hits.push({ c, m }); });
      return hits;
    }

    function slotValue(name, raw){
      if(name === 'dir'){
        if(/^\d+$/.test(raw)) return { value: +raw, source: 'digits' };
        return { value: db.points[raw], source: 'point', word: raw };
      }
      if(name === 'side') return { value: db.sides[raw] };
      return { value: parseFloat(raw) };
    }
    const RANGE = { heading: [0, 359], deg: [1, 180], angle: [1, 35], speed: [1, 40], kn: [0, 60], dir: [0, 359] };

    function resolveArgs(spec, caps){
      const out = {};
      Object.keys(spec || {}).forEach(k => {
        const v = spec[k];
        if(typeof v === 'string' && /\{\w+\}/.test(v)){
          const whole = /^\{(\w+)\}$/.exec(v);
          if(whole){ if(caps[whole[1]] !== undefined) out[k] = caps[whole[1]].value; }
          else {
            let ok = true; const t = v.replace(/\{(\w+)\}/g, (_, n) => { if(caps[n] === undefined){ ok = false; return ''; } return caps[n].value; });
            if(ok) out[k] = t;
          }
        } else if(v && typeof v === 'object' && v.$){
          if(caps[v.$] !== undefined) out[k] = caps[v.$].value * (v.mul === undefined ? 1 : v.mul);
        } else out[k] = v;
      });
      return out;
    }

    /* parse: { status:'ok', id, kind, tool, args, lang, confirm, caps, wake } | { status:'no_match'|'digits_required'|'ambiguous'|'bad_range', ... } */
    function parse(text){
      const raw = String(text == null ? '' : text);
      const { s, wokeUp } = peel(normalize(raw));
      if(!s) return { status: 'no_match', heard: raw, wake: wokeUp };
      let hits = matchAll(s);
      if(!hits.length){
        // ¿era una orden de rumbo dicha como número ("noventa")? Se rechaza: los rumbos son por dígitos.
        if(s.indexOf('#') >= 0){
          const alt = matchAll(s.replace(/#/g, ''));
          if(alt.some(h => h.c.names.indexOf('heading') >= 0)) return { status: 'digits_required', heard: raw, wake: wokeUp };
        }
        const lp = loose && loose.parse(s);
        if(lp) return Object.assign(lp, { heard: raw, normalized: s, wake: wokeUp });
        return { status: 'no_match', heard: raw, normalized: s, wake: wokeUp };
      }
      const built = [];
      for(const h of hits){
        const caps = {}; let bad = null;
        h.c.names.forEach((n, i) => {
          const r = h.m[i + 1]; if(r === undefined) return;
          const sv = slotValue(n, r); caps[n] = sv;
          if(RANGE[n] && (sv.value < RANGE[n][0] || sv.value > RANGE[n][1])) bad = n;
        });
        if(bad){ built.push({ bad }); continue; }
        const args = resolveArgs(h.c.cmd.args, caps);
        built.push({ h, caps, args });
      }
      const good = built.filter(b => !b.bad);
      if(!good.length) return { status: 'bad_range', slot: built[0].bad, heard: raw, wake: wokeUp };
      // misma orden por varios patrones, o dos órdenes con idéntico efecto: no es ambigüedad
      const key = b => b.h.c.cmd.id;
      const ids = Array.from(new Set(good.map(key)));
      if(ids.length > 1){
        const sig = b => (b.h.c.cmd.tool || b.h.c.cmd.kind) + JSON.stringify(b.args);
        if(new Set(good.map(sig)).size > 1) return { status: 'ambiguous', candidates: ids, heard: raw, normalized: s, wake: wokeUp };
      }
      const pick = good[0], c = pick.h.c, cmd = c.cmd;
      return { status: 'ok', id: cmd.id, cat: cmd.cat, kind: cmd.kind || 'order', tool: cmd.tool || null, args: pick.args, lang: c.lang,
               confirm: !!cmd.confirm, caps: pick.caps, wake: wokeUp, heard: raw, normalized: s };
    }

    /* ---------- Lo que Marina dice (frase fija y breve; nunca improvisada) ---------- */
    const msg = (key, lang) => ((db.messages[key] || db.messages.error || {})[lang]) || '';
    const L = db.labels;
    const sideWord = (v, lang) => (L.side[lang] || {})[v] || v;
    const num = v => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)) : String(v));
    function dirPhrase(cap, kind, lang){
      if(!cap) return '';
      const word = cap.source === 'point' ? (L.point[lang] || {})[String(cap.value)] : spoken(cap.value, lang);
      if(kind === 'from') return lang === 'es' ? ' por el ' + word : ' from ' + word;
      return lang === 'es' ? ' hacia el ' + word : ' toward ' + word;
    }
    function fill(tpl, parsed, res){
      const lang = parsed.lang, caps = parsed.caps || {};
      return String(tpl).replace(/\{([^}]+)\}/g, (_, k) => {
        if(k.indexOf('r.') === 0){
          const v = res && res[k.slice(2)];
          if(v && typeof v === 'object') return v[lang] || v.es || '';
          return v == null ? '' : String(v);
        }
        const [name, fmt] = k.split(':'), cap = caps[name];
        if(fmt === 'kn_es') return cap ? ' ' + num(cap.value) + ' nudos' : '';
        if(fmt === 'kn_en') return cap ? ' ' + num(cap.value) + ' knots' : '';
        if(fmt === 'from_es') return dirPhrase(cap, 'from', 'es');
        if(fmt === 'from_en') return dirPhrase(cap, 'from', 'en');
        if(fmt === 'to_es') return dirPhrase(cap, 'to', 'es');
        if(fmt === 'to_en') return dirPhrase(cap, 'to', 'en');
        if(!cap) return '';
        if(fmt === 'spoken') return spoken(cap.value, lang);
        if(fmt === 'side') return sideWord(cap.value, lang);
        return num(cap.value);
      }).replace(/\s+([.,])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    }

    /* Viento relativo al buque: "por la amura de estribor", "por la aleta de babor"... */
    function windRel(e, lang){
      if(e.wind_rel_deg == null) return '';
      const r = e.wind_rel_deg > 180 ? 360 - e.wind_rel_deg : e.wind_rel_deg, es = lang === 'es';
      const side = e.wind_rel_side ? sideWord({ estribor: 'starboard', babor: 'port' }[e.wind_rel_side], lang) : '';
      if(r < 22.5) return es ? ', por la proa' : ', on the bow';
      if(r >= 157.5) return es ? ', por la popa' : ', astern';
      if(es) return `, por ${r < 67.5 ? 'la amura' : r < 112.5 ? 'el través' : 'la aleta'} de ${side}`;
      return `, on the ${side} ${r < 67.5 ? 'bow' : r < 112.5 ? 'beam' : 'quarter'}`;
    }
    /* Sugerencia de derrota: si el desvío supera 30 m, volver hacia la derrota. Solo sugiere; nunca actúa. */
    function trackSuggestion(res, lang){
      const r = res.route;
      if(!r || typeof r === 'string' || !r.cross_track_side || !(r.cross_track_m >= 30)) return '';
      const off = r.cross_track_side === 'estribor' ? 'starboard' : 'port', back = off === 'port' ? 'starboard' : 'port';
      const deg = r.cross_track_m >= 100 ? 15 : 10;
      return lang === 'es' ? `Desvío de ${r.cross_track_m} metros a ${sideWord(off, 'es')}: sugiero caer ${deg} grados a ${sideWord(back, 'es')} hacia la derrota.`
                           : `Off track ${r.cross_track_m} meters to ${sideWord(off, 'en')}: I suggest altering ${deg} degrees to ${sideWord(back, 'en')} toward the track.`;
    }

    const sideOf = (s, lang) => ({ estribor: 'starboard', babor: 'port' }[s] ? sideWord({ estribor: 'starboard', babor: 'port' }[s], lang) : '');
    const composers = {
      q_heading(res, lang){
        const h = res.heading_spoken && res.heading_spoken[lang], o = res.ordered_heading_spoken && res.ordered_heading_spoken[lang];
        return lang === 'es' ? `Rumbo ${h}${o ? ', ordenado ' + o : ''}.` : `Heading ${h}${o ? ', ordered ' + o : ''}.`;
      },
      q_status(res, lang){
        const h = res.heading_spoken && res.heading_spoken[lang], o = res.ordered_heading_spoken && res.ordered_heading_spoken[lang];
        const sog = res.nav && res.nav.sog_kn != null ? res.nav.sog_kn : null, eng = res.engine_order ? ((L.engine.es && lang === 'es' && L.engine.es[res.engine_order]) || res.engine_order) : null;
        const alerts = (res.alerts && res.alerts.length) ? res.alerts.join(', ') : '';
        return lang === 'es'
          ? `Rumbo ${h}${o ? ', ordenado ' + o : ''}.${sog != null ? ` ${num(sog)} nudos.` : ''}${eng ? ' ' + eng + '.' : ''}${alerts ? ' ' + alerts + '.' : ''}`
          : `Heading ${h}${o ? ', ordered ' + o : ''}.${sog != null ? ` ${num(sog)} knots.` : ''}${eng ? ' ' + eng + '.' : ''}${alerts ? ' ' + alerts + '.' : ''}`;
      },
      q_drift(res, lang){
        if(!res.bow && !res.stern) return msg('no_data', lang);
        const end = (e, es, en) => {
          if(!e || !(e.transverse_speed_kn >= 0.05)) return lang === 'es' ? `${es} quieta` : `${en} still`;
          return lang === 'es' ? `${es} ${num(e.transverse_speed_kn)} nudos a ${sideOf(e.side, 'es')}` : `${en} ${num(e.transverse_speed_kn)} knots to ${sideOf(e.side, 'en')}`;
        };
        const quiet = !(res.bow && res.bow.transverse_speed_kn >= 0.05) && !(res.stern && res.stern.transverse_speed_kn >= 0.05);
        if(quiet) return lang === 'es' ? 'Sin caída significativa.' : 'No significant fall.';
        return `${end(res.bow, 'Proa', 'Bow')}, ${end(res.stern, 'popa', 'stern')}.`;
      },
      q_recommend(res, lang){
        const parts = [], sg = res.suggestion, es = lang === 'es';
        if(sg){
          const side = sideWord(sg.side, lang);
          parts.push(sg.type === 'alter' ? (es ? `Sugiero caer ${sg.degrees} grados a ${side}.` : `I suggest altering ${sg.degrees} degrees to ${side}.`)
                                         : (es ? `Sugiero timón ${sg.degrees} a ${side}.` : `I suggest ${side} ${sg.degrees}.`));
        }
        const t = trackSuggestion(res, lang); if(t) parts.push(t);
        if(!parts.length && res.suggestion === undefined) return msg('no_data', lang);      // aún no hay fuerzas calculadas
        if(!parts.length) return es ? 'Sin caída significativa. Sin sugerencias.' : 'No significant fall. No suggestions.';
        return parts.join(' ');
      },
      q_weather(res, lang){
        const e = res.environment, es = lang === 'es'; if(!e) return msg('no_data', lang);
        const wind = e.wind_kn >= 0.5
          ? (es ? `Viento por el ${spoken(e.wind_from_deg, lang)}, ${num(e.wind_kn)} nudos${windRel(e, lang)}.` : `Wind from ${spoken(e.wind_from_deg, lang)}, ${num(e.wind_kn)} knots${windRel(e, lang)}.`)
          : (es ? 'Sin viento.' : 'No wind.');
        const cur = e.current_kn >= 0.05
          ? (es ? `Corriente hacia el ${spoken(e.current_toward_deg, lang)}, ${num(e.current_kn)} nudos.` : `Current setting ${spoken(e.current_toward_deg, lang)}, ${num(e.current_kn)} knots.`)
          : (es ? 'Sin corriente.' : 'No current.');
        const sea = es ? `Mar ${num(e.hs_m)} metros.` : `Sea ${num(e.hs_m)} meters.`;
        const tide = e.tide_m ? (es ? ` Marea ${num(e.tide_m)} metros.` : ` Tide ${num(e.tide_m)} meters.`) : '';
        return `${wind} ${cur} ${sea}${tide}`;
      },
      q_track(res, lang){
        const r = res.route, es = lang === 'es';
        if(!r || typeof r === 'string') return es ? 'Sin derrota guiada.' : 'No guided route.';
        const side = r.cross_track_side ? sideWord({ estribor: 'starboard', babor: 'port' }[r.cross_track_side], lang) : '';
        const xte = !r.cross_track_m || !side ? (es ? 'En la derrota.' : 'On track.')
                  : (es ? `Fuera de la derrota ${r.cross_track_m} metros a ${side}.` : `Off track ${r.cross_track_m} meters to ${side}.`);
        const eta = r.eta_min != null ? (es ? ` Llegada en ${r.eta_min} minutos.` : ` ETA ${r.eta_min} minutes.`) : '';
        const brg = res.bearing_to_waypoint_spoken && res.bearing_to_waypoint_spoken[lang], cts = res.cts_spoken && res.cts_spoken[lang];
        return es ? `Punto ${r.waypoint}, ${num(r.distance_nm)} millas${brg ? ', demora ' + brg : ''}${cts ? ', rumbo a gobernar ' + cts : ''}. ${xte}${eta}`
                  : `Waypoint ${String(r.waypoint).replace(' de ', ' of ')}, ${num(r.distance_nm)} miles${brg ? ', bearing ' + brg : ''}${cts ? ', steer ' + cts : ''}. ${xte}${eta}`;
      },
      q_leeway(res, lang){
        if(res.leeway_deg == null) return msg('no_data', lang);
        const es = lang === 'es';
        const sd = (v, side) => (!(v >= 0.1) || !side || side === 'sin caída') ? '' : (es ? ' a ' : ' to ') + sideWord({ estribor: 'starboard', babor: 'port' }[side], lang);
        return es ? `Abatimiento ${num(res.leeway_deg)} grados${sd(res.leeway_deg, res.leeway_side)}. Deriva ${num(res.drift_deg)} grados${sd(res.drift_deg, res.drift_side)}. ${num(res.sog_kn)} nudos sobre el fondo.`
                  : `Leeway ${num(res.leeway_deg)} degrees${sd(res.leeway_deg, res.leeway_side)}. Drift ${num(res.drift_deg)} degrees${sd(res.drift_deg, res.drift_side)}. ${num(res.sog_kn)} knots over ground.`;
      },
      q_depth(res, lang){
        const n = res.nav, es = lang === 'es', e = res.environment || {};
        if(!n || typeof n === 'string') return msg('no_data', lang);
        const band = n.ukc_m < 0 ? (es ? 'Encallado.' : 'Aground.') : n.ukc_m < 1.5 ? (es ? 'UKC crítico.' : 'UKC critical.') : n.ukc_m < 3 ? (es ? 'UKC bajo.' : 'UKC low.') : '';
        return (es ? `Profundidad ${num(n.depth_m)} metros. UKC ${num(n.ukc_m)} metros${e.tide_m ? ', marea ' + num(e.tide_m) : ''}. ${band}`
                   : `Depth ${num(n.depth_m)} meters. UKC ${num(n.ukc_m)} meters${e.tide_m ? ', tide ' + num(e.tide_m) : ''}. ${band}`).trim();
      },
      q_speed(res, lang){
        const n = res.nav, es = lang === 'es';
        if(!n || typeof n === 'string') return msg('no_data', lang);
        const eng = res.engine_order ? ((es && L.engine.es && L.engine.es[res.engine_order]) || res.engine_order) : null;
        const t = res.thrust_pct, r = Math.abs(res.rate_of_turn_deg_s || 0);
        const rot = r >= 0.05 ? (es ? ` Giro ${num(r)} grados por segundo.` : ` Turning ${num(r)} degrees per second.`) : '';
        return es ? `${num(n.stw_kn)} nudos al agua, ${num(n.sog_kn)} sobre el fondo.${eng ? ' ' + eng + '.' : ''}${t ? ` Empuje ${t.port} y ${t.stbd} por ciento.` : ''}${rot}`
                  : `${num(n.stw_kn)} knots through water, ${num(n.sog_kn)} over ground.${eng ? ' ' + eng + '.' : ''}${t ? ` Thrust ${t.port} and ${t.stbd} percent.` : ''}${rot}`;
      },
      q_full(res, lang){
        return ['q_status', 'q_weather', 'q_leeway', 'q_drift', 'q_track', 'q_depth'].map(k => composers[k](res, lang)).join(' ');
      }
    };

    /* speak(parsed, resultadoDeLaHerramienta) -> { text, lang } */
    function speak(parsed, res){
      const lang = parsed.lang || 'es';
      if(parsed.status === 'incomplete') return { text: msg('ask_' + parsed.missing, lang) || msg('no_match', lang), lang };
      if(parsed.loose && parsed.status === 'ok'){
        if(res && res.status === 'needs_confirmation') return { text: msg('confirm_' + (res.key || ''), lang) || msg('error', lang), lang };
        if(res && res.status === 'error') return { text: msg(res.error, lang) || res.message || msg('error', lang), lang };
        let t = speakTool(parsed.tool, parsed.args, res, lang);
        if(res && res.warning_code) t += ' ' + msg(res.warning_code, lang);
        if(res && res.note_code) t += ' ' + msg(res.note_code, lang);
        return { text: t.trim(), lang };
      }
      if(parsed.status !== 'ok'){
        const key = parsed.status === 'digits_required' ? 'digits_required' : 'no_match';
        return { text: msg(key, lang === 'en' ? 'en' : 'es'), lang };
      }
      const cmd = db.commands.find(c => c.id === parsed.id);
      if(res && res.status === 'needs_confirmation') return { text: msg('confirm_' + (res.key || ''), lang) || msg('error', lang), lang };
      if(res && res.status === 'error') return { text: msg(res.error, lang) || msg('error', lang), lang };
      let text;
      if(cmd.kind === 'confirm') text = msg('done', lang);
      else if(cmd.kind === 'query'){
        const f = composers[parsed.id];
        text = (res && res.status === 'error') ? msg(res.error, lang) : (f ? f(res || {}, lang) : '');
      } else text = fill(((cmd.say || {})[lang]) || '', parsed, res);
      if(res && res.warning_code) text += ' ' + msg(res.warning_code, lang);
      if(res && res.note_code) text += ' ' + msg(res.note_code, lang);
      return { text: text.trim(), lang };
    }

    /* De una llamada a herramienta (la que hace el modelo al OÍR la orden) a la entrada de la base que la describe.
       Si ninguna entrada coincide, la llamada NO se ejecuta: el modelo solo puede hacer lo que está en el JSON. */
    const capOf = (slot, v) => (slot === 'dir' ? { value: v, source: 'digits' } : { value: v });
    function fromTool(tool, args, lang){
      args = args || {};
      const keys = Object.keys(args).filter(k => k !== 'lang' && k !== 'wake');
      for(const c of db.commands){
        if(c.tool !== tool) continue;
        const spec = c.args || {}, caps = {}; let ok = keys.every(k => Object.prototype.hasOwnProperty.call(spec, k));
        for(const k of Object.keys(spec)){
          if(!ok) break;
          const sp = spec[k], v = args[k];
          if(typeof sp === 'string' && /\{\w+\}/.test(sp)){
            if(v === undefined) continue;
            const whole = /^\{(\w+)\}$/.exec(sp);
            if(whole){
              if(whole[1] === 'side' && v !== 'port' && v !== 'starboard') ok = false;
              else if(k === 'delta_knots' && !(v >= 0)) ok = false;
              else caps[whole[1]] = capOf(whole[1], v);
            } else {
              const m = new RegExp('^' + sp.replace(/\{\w+\}/g, '(port|starboard)') + '$').exec(String(v));
              if(!m) ok = false; else caps.side = capOf('side', m[1]);
            }
          } else if(sp && typeof sp === 'object' && sp.$){
            if(v === undefined) continue;
            if(!(v < 0)) ok = false; else caps[sp.$] = capOf(sp.$, v / (sp.mul || 1));
          } else if(v !== sp) ok = false;
        }
        if(ok) return { status: 'ok', id: c.id, cat: c.cat, kind: c.kind || 'order', tool, args: Object.fromEntries(keys.map(k => [k, args[k]])), lang: lang === 'en' ? 'en' : 'es', confirm: !!c.confirm, caps };
      }
      return null;
    }

    /* Frase de repetición para una llamada que no está en la base (o llegó por el analizador flexible): con el valor YA aplicado. */
    const ENGINE_EN = { full_ahead: 'Full ahead', half_ahead: 'Half ahead', slow_ahead: 'Slow ahead', dead_slow_ahead: 'Dead slow ahead', stop: 'Stop engines',
                        dead_slow_astern: 'Dead slow astern', slow_astern: 'Slow astern', half_astern: 'Half astern', full_astern: 'Full astern' };
    const ENGINE_KEY = {}; Object.keys(ENGINE_EN).forEach(k => { ENGINE_KEY[ENGINE_EN[k]] = k; });
    const cap = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
    function speakTool(name, a, res, lang){
      a = a || {}; res = res || {};
      const es = lang !== 'en', sp = v => spoken(v, es ? 'es' : 'en');
      const side = v => sideWord(v, lang);
      const engLabel = k => { const en = ENGINE_EN[k] || k; return es ? ((L.engine.es && L.engine.es[en]) || en) : en; };
      switch(name){
        case 'steer_course': return es ? `Rumbo ${sp(a.degrees)}.` : `Steer course ${sp(a.degrees)}.`;
        case 'alter_course': return es ? `Cae ${a.degrees} a ${side(a.side)}${res.ordered_heading_spoken ? ', rumbo ' + res.ordered_heading_spoken.es : ''}.`
                                       : `Alter ${a.degrees} to ${side(a.side)}${res.ordered_heading_spoken ? ', course ' + res.ordered_heading_spoken.en : ''}.`;
        case 'helm_order': {
          const o = a.order;
          if(o === 'port' || o === 'starboard') return `${cap(side(o))} ${a.angle}.`;
          if(o === 'hard_port' || o === 'hard_starboard') return es ? `Todo a ${side(o.slice(5))}.` : `Hard to ${side(o.slice(5))}.`;
          if(o === 'midships') return es ? 'Timón a la vía.' : 'Midships.';
          if(o === 'steady') return es ? 'Así.' : 'Steady.';
          if(o === 'ease') return es ? `Timón a ${side(res.helm_angle < 0 ? 'port' : 'starboard')} ${a.angle}.` : `Ease to ${a.angle}.`;
          if(o === 'nothing_port' || o === 'nothing_starboard'){
            const sd = side(o.slice(8));
            return res.no_change ? (es ? `Nada a ${sd}, sin cambio.` : `Nothing to ${sd}, no change.`) : (es ? `Nada a ${sd}.` : `Nothing to ${sd}.`);
          }
          return msg('done', lang);
        }
        case 'engine_order': {
          if(a.order === 'stop'){
            if(a.side === 'port' || a.side === 'starboard') return es ? `Máquina de ${side(a.side)} parada.` : `${cap(side(a.side))} engine stopped.`;
            return es ? 'Máquinas paradas.' : 'Engines stopped.';
          }
          const lab = engLabel(a.order).toLowerCase();
          if(a.side === 'port' || a.side === 'starboard') return es ? `Máquina de ${side(a.side)} ${lab}.` : `${cap(side(a.side))} engine ${lab}.`;
          return es ? `Máquinas ${lab}.` : `Engines ${lab}.`;
        }
        case 'engine_pair': return es ? `Babor ${engLabel(a.port).toLowerCase()}, estribor ${engLabel(a.starboard).toLowerCase()}.`
                                      : `Port ${engLabel(a.port).toLowerCase()}, starboard ${engLabel(a.starboard).toLowerCase()}.`;
        case 'speed_order': {
          const v = res.ordered_speed_kn != null ? res.ordered_speed_kn : (a.knots != null ? (a.direction === 'astern' ? -a.knots : a.knots) : null);
          if(v == null) return msg('done', lang);
          return es ? `Velocidad ${num(Math.abs(v))} nudos${v < 0 ? ' atrás' : ''}.` : `Speed ${num(Math.abs(v))} knots${v < 0 ? ' astern' : ''}.`;
        }
        case 'power_percent': {
          const back = a.direction === 'astern';
          return es ? `Empuje ${num(a.percent)} por ciento ${back ? 'atrás' : 'avante'}.` : `Power ${num(a.percent)} percent ${back ? 'astern' : 'ahead'}.`;
        }
        case 'engine_step': return es ? `${engLabel(ENGINE_KEY[res.engine_order] || 'stop')}.` : `${res.engine_order || 'Engines'}.`;
        case 'standby': return es ? 'Máquinas listas.' : 'Engines ready.';
        case 'all_stop': return es ? 'Alto general.' : 'All stop.';
        case 'manual_control': return es ? 'Control manual.' : 'Manual control.';
        case 'set_wind': {
          const kn = res.knots != null ? res.knots : a.knots;
          return es ? `Viento${kn != null ? ' ' + num(kn) + ' nudos' : ''}${a.from_deg != null ? ' por el ' + spoken(a.from_deg, 'es') : ''}.`
                    : `Wind${kn != null ? ' ' + num(kn) + ' knots' : ''}${a.from_deg != null ? ' from ' + spoken(a.from_deg, 'en') : ''}.`;
        }
        case 'set_current': {
          const kn = res.knots != null ? res.knots : a.knots;
          const dir = a.toward_deg != null ? (es ? ' hacia el ' + spoken(a.toward_deg, 'es') : ' toward ' + spoken(a.toward_deg, 'en'))
                    : a.from_deg != null ? (es ? ' por el ' + spoken(a.from_deg, 'es') : ' from ' + spoken(a.from_deg, 'en')) : '';
          return es ? `Corriente${kn != null ? ' ' + num(kn) + ' nudos' : ''}${dir}.` : `Current${kn != null ? ' ' + num(kn) + ' knots' : ''}${dir}.`;
        }
        case 'set_sea': return a.tide_m != null ? (es ? `Marea ${num(a.tide_m)} metros.` : `Tide ${num(a.tide_m)} meters.`) : (es ? `Mar ${num(a.hs_m)} metros.` : `Sea ${num(a.hs_m)} meters.`);
        default: return res.message && es ? String(res.message) + '.' : msg('done', lang);
      }
    }

    /* Texto de práctica o de vista previa de una orden ("Rumbo 090"), para el panel. */
    function describe(parsed){
      if(parsed.status !== 'ok') return '';
      const cmd = db.commands.find(c => c.id === parsed.id);
      return fill(((cmd.say || {})[parsed.lang]) || cmd.id, parsed, null) || cmd.id;
    }

    /* Vocabulario para sesgar la transcripción (prompt de la API de voz). */
    function transcriptionPrompt(){
      return 'Órdenes de puente de un remolcador, en español o inglés: rumbo cero nueve cero, steer course zero nine zero, cae cinco a babor, port ten, ' +
             'starboard twenty, todo a estribor, hard to port, timón a la vía, midships, full avante, media avante, poca avante, full ahead, half ahead, slow ahead, ' +
             'dead slow ahead, stop engines, para máquinas, viento por el este, wind from the east, corriente, current, nudos, knots, Marina.';
    }

    return { parse, speak, speakTool, describe, fromTool, transcriptionPrompt, db, compiledCount: compiled.length };
  }

  return { create, normalize, spoken, strip };
});
