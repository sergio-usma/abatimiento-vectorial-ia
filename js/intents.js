/* ASD Bridge Simulator: analizador FLEXIBLE de órdenes de puente.
 *
 * Segunda pasada de js/grammar.js: cuando ninguna frase exacta de data/bridge-commands.json coincide, este módulo busca palabras clave y
 * valores (con su unidad) sin depender del orden de las palabras ni de verbos concretos. Así "viento de 45 grados por el 000",
 * "pon proa al 090", "nada a babor" o "máquina de babor poca avante, estribor poca atrás" se ejecutan en vez de contestar "Repita".
 *
 * Recibe texto YA normalizado por grammar.normalize (minúsculas, sin acentos, cifras unidas: "cero nueve cero" -> "090",
 * número dicho como palabra -> "#45", "por ciento" -> "pct") y sin la palabra de activación.
 * Devuelve { status:'ok', id, tool, args, lang, loose:true } | { status:'incomplete', missing, lang } | { status:'digits_required', lang } | null.
 *
 * Módulo puro (sin DOM): navegador (`window.ASDIntents`) y Node (`node --test tests/`).
 */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.ASDIntents = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  const W = s => new Set(s.split(' '));
  const ES = W('el la los las de del por desde hacia viento corriente mar ola olas oleaje marea babor estribor timon cana via asi rumbo avante atras poca poco media medio toda todo nudos nudo grados grado maquina maquinas motor motores velocidad empuje potencia cae caiga mantiene manten mantener menos mas ciar proa popa pon ponga gobierna gobierne cambia cambie meta nada');
  const EN = W('the of from toward towards setting wind current sea swell tide port starboard helm rudder midships steady course heading ahead astern slow half full dead stop engine engines speed knots knot degrees degree thrust power push less more ease nothing meet her steer alter come fall turn maintain make');

  const ARTICLES = W('el la los las the of un una');
  const FROM_PREP = W('por del desde from');
  const TO_PREP = W('hacia towards toward setting');
  const ABS_MARK = W('a hasta to at');
  const INC = W('aumenta aumente incrementa incremente sube suba refuerza refuerce increase raise strengthen add mas more');
  const DEC = W('reduce reduzca baja baje disminuye disminuya afloja modera decrease lower ease drop menos less');
  const KN_UNIT = W('nudos nudo knots knot kts kt kn');
  const DEG_UNIT = W('grados grado degrees degree deg');
  const M_UNIT = W('metros metro meters meter metres metre');
  const SIDE = { babor: 'port', port: 'port', estribor: 'starboard', starboard: 'starboard' };

  const isNum = t => /^#?\d+(\.\d+)?$/.test(t || '');
  const numOf = t => parseFloat(String(t).replace('#', ''));
  const rawOf = t => String(t).replace('#', '');
  const norm360 = d => ((d % 360) + 360) % 360;

  function create(opts){
    opts = opts || {};
    const points = {};
    Object.keys(opts.points || {}).forEach(k => { if(k.length >= 3 || k === 'ne' || k === 'nw' || k === 'sw') points[k] = opts.points[k]; });

    const detectLang = tk => {
      let es = 0, en = 0; tk.forEach(t => { if(ES.has(t)) es++; if(EN.has(t)) en++; });
      return en > es ? 'en' : 'es';
    };
    const ok = (tool, args, lang) => ({ status: 'ok', id: 'loose:' + tool, cat: 'Libre', kind: 'order', tool, args, lang, confirm: false, caps: {}, loose: true });
    const miss = (missing, lang) => ({ status: 'incomplete', missing, lang });

    /* ---------- utilidades de posición ---------- */
    function prepBefore(tk, i){
      let j = i - 1; while(j >= 0 && ARTICLES.has(tk[j])) j--;
      const w = tk[j];
      if(FROM_PREP.has(w)) return 'from';
      if(TO_PREP.has(w)) return 'to';
      return '';
    }
    function unitAt(tk, i){
      const w = tk[i + 1];
      if(KN_UNIT.has(w)) return 'kn';
      if(DEG_UNIT.has(w)) return 'deg';
      if(M_UNIT.has(w)) return 'm';
      if(w === 'pct') return 'pct';
      return '';
    }
    function numbers(tk){
      const out = [];
      tk.forEach((t, i) => { if(isNum(t)) out.push({ i, val: numOf(t), raw: rawOf(t), hash: t[0] === '#', unit: unitAt(tk, i), prep: prepBefore(tk, i), used: false }); });
      return out;
    }
    /* Punto cardinal solo con preposición delante o pegado a la palabra clave: "este" también es un demostrativo. */
    function pointDirs(tk, famIdx){
      const out = [];
      tk.forEach((t, i) => {
        if(!Object.prototype.hasOwnProperty.call(points, t)) return;
        const prep = prepBefore(tk, i);
        if(prep || i === famIdx + 1 || (ARTICLES.has(tk[famIdx + 1]) && i === famIdx + 2)) out.push({ i, deg: points[t], kind: prep || '' });
      });
      return out;
    }

    /* ---------- viento, corriente, mar, marea ---------- */
    function env(tk, lang){
      const famIdx = tk.findIndex(t => t === 'viento' || t === 'wind' || t === 'corriente' || t === 'current');
      const seaIdx = tk.findIndex(t => ['mar', 'ola', 'olas', 'oleaje', 'sea', 'swell', 'wave', 'waves'].indexOf(t) >= 0);
      const tideIdx = tk.findIndex(t => t === 'marea' || t === 'tide');
      if(tideIdx >= 0 && famIdx < 0){
        const n = numbers(tk)[0]; return n ? ok('set_sea', { tide_m: n.val }, lang) : null;
      }
      if(seaIdx >= 0 && famIdx < 0){
        const n = numbers(tk)[0]; return n ? ok('set_sea', { hs_m: n.val }, lang) : null;
      }
      if(famIdx < 0) return null;
      const wind = tk[famIdx] === 'viento' || tk[famIdx] === 'wind';
      if(!wind && tk.some(t => t === 'ligada' || t === 'enlazada' || t === 'linked')) return ok('set_current', { linked_to_wind: true }, lang);
      const calm = tk.some(t => t === 'calma' || t === 'calm') || (tk[famIdx - 1] === 'sin' || tk[famIdx - 1] === 'no');
      const ns = numbers(tk);
      let dir = null;
      // 1) número con "por/del/desde/from" o "hacia/toward/setting"
      const withPrep = ns.find(n => n.prep && n.unit !== 'kn');
      if(withPrep){ dir = { deg: withPrep.val, kind: withPrep.prep }; withPrep.used = true; }
      // 2) punto cardinal
      if(!dir){ const p = pointDirs(tk, famIdx)[0]; if(p) dir = { deg: p.deg, kind: p.kind }; }
      // 3) intensidad: con unidad de nudos; si no, el primer número libre
      let sp = ns.find(n => !n.used && n.unit === 'kn');
      if(!sp){
        const free = ns.filter(n => !n.used && n.unit !== 'deg' && n.unit !== 'm');
        // sin dirección aún, un número de tres cifras ("045", "000") es la dirección y el otro la intensidad
        if(!dir && free.length > 1){ const d3 = free.find(n => n.raw.length === 3); if(d3){ dir = { deg: d3.val, kind: '' }; d3.used = true; } }
        sp = ns.find(n => !n.used && n.unit !== 'deg' && n.unit !== 'm');
      }
      // 4) "N grados" sin otra dirección es la dirección; con una dirección ya dada es la intensidad (error de unidad: "45 grados" por 45 nudos)
      const degN = ns.find(n => !n.used && n.unit === 'deg');
      if(degN){
        if(!dir){ dir = { deg: degN.val, kind: '' }; degN.used = true; }
        else if(!sp){ sp = degN; }
      }
      if(sp) sp.used = true;
      if(!dir){ const d3 = ns.find(n => !n.used && !n.unit && n.raw.length === 3); if(d3){ dir = { deg: d3.val, kind: '' }; d3.used = true; } }
      // 5) un solo número de tres cifras sin unidad ni intensidad: dirección ("viento 045")
      if(!dir && sp && !sp.unit && sp.raw.length === 3 && ns.length === 1){ dir = { deg: sp.val, kind: '' }; sp = null; }

      let kn = null, dk = null;
      if(calm && !sp) kn = 0;
      else if(sp){
        const verbDelta = tk.some(t => INC.has(t) || DEC.has(t));
        const abs = ABS_MARK.has(tk[sp.i - 1]) || (ARTICLES.has(tk[sp.i - 1]) && ABS_MARK.has(tk[sp.i - 2]));
        const sgn = tk.some(t => DEC.has(t)) && !tk.some(t => t === 'mas' || t === 'more' || (INC.has(t) && t !== 'mas' && t !== 'more')) ? -1 : 1;
        if(verbDelta && !abs) dk = sgn * sp.val; else kn = sp.val;
      }
      if(kn === null && dk === null && !dir) return null;
      if(wind){
        const args = {};
        if(dir) args.from_deg = dir.kind === 'to' ? norm360(dir.deg + 180) : norm360(dir.deg);
        if(kn !== null) args.knots = kn; else if(dk !== null) args.delta_knots = dk;
        return ok('set_wind', args, lang);
      }
      const args = {};
      if(dir){ if(dir.kind === 'from') args.from_deg = norm360(dir.deg); else args.toward_deg = norm360(dir.deg); }   // sin preposición: la corriente se da "hacia"
      if(kn !== null) args.knots = kn; else if(dk !== null) args.delta_knots = dk;
      return ok('set_current', args, lang);
    }

    /* ---------- máquinas ---------- */
    const AHEAD = W('avante ahead adelante'), ASTERN = W('atras astern popa ciar ciando');
    function magOf(tk){
      const has = (...w) => w.some(x => tk.includes(x));
      if(has('stop', 'para', 'pare', 'paren', 'parar', 'detener', 'detenga', 'parada', 'paradas')) return 'stop';
      if(has('full', 'toda', 'todo', 'maxima', 'maximo', 'crash')) return 'full';
      if(has('half', 'media', 'medio')) return 'half';
      if((has('muy') && has('poca', 'poco', 'despacio')) || has('dead')) return 'dead_slow';
      if(has('poca', 'poco', 'slow', 'despacio', 'lento')) return 'slow';
      return null;
    }
    function dirOfEng(tk){
      if(tk.some(t => ASTERN.has(t))) return 'astern';
      if(tk.some(t => AHEAD.has(t))) return 'ahead';
      return null;
    }
    function orderKey(mag, dir){ return mag === 'stop' ? 'stop' : mag + '_' + (dir || 'ahead'); }

    function engines(tk, lang){
      const engWord = tk.some(t => ['maquina', 'maquinas', 'motor', 'motores', 'engine', 'engines'].indexOf(t) >= 0);
      const dir = dirOfEng(tk);
      if(!engWord && !dir) return null;
      // "máquina de babor poca avante, estribor poca atrás": un grupo por banda
      const sIdx = []; tk.forEach((t, i) => { if(SIDE[t]) sIdx.push(i); });
      if(sIdx.length === 2 && SIDE[tk[sIdx[0]]] !== SIDE[tk[sIdx[1]]]){
        const g1 = tk.slice(sIdx[0] + 1, sIdx[1]), g2 = tk.slice(sIdx[1] + 1);
        // inglés: "port engine slow ahead starboard engine slow astern" también encaja (el grupo sigue a la banda)
        const o1 = magOf(g1), o2 = magOf(g2);
        if(o1 && o2){
          const k1 = orderKey(o1, dirOfEng(g1)), k2 = orderKey(o2, dirOfEng(g2));
          const sd = SIDE[tk[sIdx[0]]];
          return ok('engine_pair', sd === 'port' ? { port: k1, starboard: k2 } : { port: k2, starboard: k1 }, lang);
        }
      }
      const mag = magOf(tk);
      if(!mag) return engWord ? miss('engine', lang) : null;
      const args = { order: orderKey(mag, dir) };
      if(tk.some(t => t === 'ambas' || t === 'both' || t === 'ambos')) args.side = 'both';
      else if(sIdx.length === 1) args.side = SIDE[tk[sIdx[0]]];
      return ok('engine_order', args, lang);
    }

    /* ---------- velocidad y potencia ---------- */
    function speedPower(tk, lang){
      const ns = numbers(tk);
      const astern = tk.some(t => ASTERN.has(t));
      const pctN = ns.find(n => n.unit === 'pct');
      const powerWord = tk.some(t => ['empuje', 'potencia', 'power', 'thrust', 'push'].indexOf(t) >= 0);
      if(pctN || (powerWord && ns.length)){
        const n = pctN || ns[0];
        return ok('power_percent', { percent: n.val, direction: astern ? 'astern' : 'ahead' }, lang);
      }
      const speedWord = tk.some(t => ['velocidad', 'speed', 'nudos', 'knots', 'kts', 'knot', 'nudo'].indexOf(t) >= 0);
      if(!speedWord) return null;
      if(tk.some(t => ['simulacion', 'simulation', 'sim'].indexOf(t) >= 0)) return null;
      const n = ns.find(x => x.unit === 'kn') || ns.find(x => !x.unit && !x.hash) || ns[0];
      if(n){
        const verbDelta = tk.some(t => (INC.has(t) && t !== 'mas' && t !== 'more') || (DEC.has(t) && t !== 'menos' && t !== 'less'));
        const abs = ABS_MARK.has(tk[n.i - 1]) || (tk[n.i - 1] === 'of' || tk[n.i - 1] === 'de');
        const byMark = tk[n.i - 1] === 'by' || tk[n.i - 1] === 'en' || tk[n.i + 1 + (n.unit ? 1 : 0)] === 'mas' || tk[n.i + 1 + (n.unit ? 1 : 0)] === 'menos';
        if(verbDelta && !abs && byMark || (verbDelta && !abs && !tk.some(t => t === 'mantener' || t === 'manten' || t === 'maintain' || t === 'make'))){
          const neg = tk.some(t => DEC.has(t) && t !== 'less' && t !== 'menos') || tk.includes('menos') || tk.includes('less');
          return ok('speed_order', { delta_knots: neg ? -n.val : n.val }, lang);
        }
        const args = { knots: n.val }; if(astern) args.direction = 'astern';
        return ok('speed_order', args, lang);
      }
      const up = tk.some(t => INC.has(t) && t !== 'mas'), down = tk.some(t => DEC.has(t) && t !== 'menos');
      if(up !== down) return ok('engine_step', { direction: up ? 'up' : 'down' }, lang);
      return null;
    }

    /* ---------- timón y rumbo ---------- */
    function helmCourse(tk, lang){
      const ns = numbers(tk);
      const side = (tk.map(t => SIDE[t]).filter(Boolean))[0] || null;
      const helmWord = tk.some(t => ['timon', 'cana', 'helm', 'rudder', 'wheel', 'meta', 'metan', 'meter'].indexOf(t) >= 0);
      if(tk.includes('nada') || tk.includes('nothing')) return side ? ok('helm_order', { order: 'nothing_' + side }, lang) : miss('side', lang);
      if(tk.includes('meet') && tk.includes('her')) return ok('helm_order', { order: 'steady' }, lang);
      const easeWord = tk.includes('ease') || tk.includes('alivia') || tk.includes('aliviar') || tk.includes('suaviza') || (tk.includes('menos') && (tk.includes('cana') || tk.includes('timon')));
      if(easeWord){
        const n = ns[0]; return n ? ok('helm_order', { order: 'ease', angle: n.val }, lang) : miss('angle', lang);
      }
      const headingWord = tk.some(t => ['rumbo', 'course', 'heading', 'proa', 'gobierna', 'gobierne', 'steer', 'steady', 'al'].indexOf(t) >= 0);
      const alterWord = tk.some(t => ['cae', 'caiga', 'guine', 'alter', 'come', 'fall', 'turn', 'cambia', 'cambie', 'altere'].indexOf(t) >= 0);
      if(headingWord && !alterWord){
        const h = ns.find(n => !n.unit || n.unit === 'deg');
        if(h){
          if(h.hash) return { status: 'digits_required', lang };
          if(h.val > 359) return null;
          return ok('steer_course', { degrees: h.val }, lang);
        }
        if(tk.includes('steady') || tk.includes('asi')) return ok('helm_order', { order: 'steady' }, lang);
        if(tk.some(t => ['rumbo', 'course', 'heading', 'proa'].indexOf(t) >= 0)) return miss('heading', lang);
      }
      if(alterWord){
        const n = ns.find(x => !x.prep) || ns[0];
        if(!side) return miss('side', lang);
        if(!n) return miss('degrees', lang);
        return ok('alter_course', { side, degrees: n.val }, lang);
      }
      const hard = tk.some(t => ['todo', 'toda', 'hard', 'full'].indexOf(t) >= 0) && side && !ns.length;
      if(hard) return ok('helm_order', { order: 'hard_' + side }, lang);
      if(side && (ns.length || helmWord)){
        const n = ns[0];
        if(!n) return miss('angle', lang);
        return ok('helm_order', { order: side, angle: n.val }, lang);
      }
      if(tk.some(t => ['via', 'midships', 'amidships'].indexOf(t) >= 0) && (helmWord || tk.length <= 3)) return ok('helm_order', { order: 'midships' }, lang);
      if(tk.includes('steady') || (tk.includes('asi') && tk.length <= 3)) return ok('helm_order', { order: 'steady' }, lang);
      return null;
    }

    /* ---------- cierre de maniobra y acuses ---------- */
    function closing(tk, lang){
      const j = tk.join(' ');
      if(/\b(stand ?by|atencion) (engines?|maquinas?)\b/.test(j) || /\bmaquinas listas\b/.test(j)) return ok('standby', {}, lang);
      if(/\bfinished with engines?\b/.test(j) || /\b(fin|final) de (la )?maniobra\b/.test(j) || /\bterminado con (las )?maquinas\b/.test(j)) return ok('all_stop', {}, lang);
      if(/\bfinished with (the )?wheel\b/.test(j) || /\bno more steering\b/.test(j) || /\bfin de gobierno\b/.test(j) || /\bsin gobierno\b/.test(j)) return ok('manual_control', {}, lang);
      return null;
    }

    function parse(s){
      const tk = String(s || '').split(' ').filter(Boolean);
      if(!tk.length) return null;
      const lang = detectLang(tk);
      return closing(tk, lang) || env(tk, lang) || speedPower(tk, lang) || engines(tk, lang) || helmCourse(tk, lang);
    }
    return { parse };
  }

  return { create };
});
