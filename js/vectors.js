/* ASD Bridge Simulator: lenguaje visual de vectores (una sola fuente de verdad).
 *
 * Define qué color, forma y nombre tiene cada magnitud (HDG, COG, CTS, viento, corriente, deriva, derrota, empuje,
 * babor, estribor) y dibuja los vectores sobre el buque con una etiqueta que nombra cada flecha.
 * Los colores viven como tokens CSS (--v-*); este módulo los lee, así CSS y canvas nunca divergen.
 *
 * La geometría y la colocación de etiquetas son puras (sin DOM) y se prueban con `node --test tests/`.
 */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.ASDVectors = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  const D2R = Math.PI / 180;
  const norm = d => ((d % 360) + 360) % 360;
  const angDiff = (a, b) => { let d = norm(a - b); if(d > 180) d -= 360; return d; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad3 = d => String(Math.round(norm(d))).padStart(3, '0');

  /* Catálogo: cada magnitud tiene un color Y una forma, para que no dependa solo del color. */
  const CATALOG = [
    { key:'hdg',     name:'Proa',             abbr:'HDG',       css:'--v-hdg',     hex:'#4ade80', shape:'solid'  },
    { key:'cog',     name:'Rumbo real',       abbr:'COG',       css:'--v-cog',     hex:'#22d3ee', shape:'dashed' },
    { key:'cts',     name:'Rumbo a gobernar', abbr:'CTS',       css:'--v-cts',     hex:'#b48cf2', shape:'dotted' },
    { key:'wind',    name:'Viento',           abbr:'VIENTO',    css:'--v-wind',    hex:'#e2e8f0', shape:'barbed' },
    { key:'current', name:'Corriente',        abbr:'CORRIENTE', css:'--v-current', hex:'#3b82f6', shape:'wavy'   },
    { key:'drift',   name:'Deriva',           abbr:'DERIVA',    css:'--v-drift',   hex:'#facc15', shape:'wedge'  },
    { key:'route',   name:'Derrota',          abbr:'DERROTA',   css:'--v-route',   hex:'#f97316', shape:'route'  },
    { key:'thrust',  name:'Empuje neto',      abbr:'EMPUJE',    css:'--v-thrust',  hex:'#5fd6d0', shape:'thick'  }
  ];
  const SIDES = [
    { key:'port',      name:'Babor',    css:'--port', hex:'#f4948b' },
    { key:'starboard', name:'Estribor', css:'--stbd', hex:'#aede90' }
  ];

  function colors(){
    const out = {};
    let cs = null;
    try{ cs = getComputedStyle(document.documentElement); }catch(e){}
    CATALOG.concat(SIDES).forEach(c => {
      const v = cs && cs.getPropertyValue(c.css);
      out[c.key] = (v && v.trim()) || c.hex;
    });
    return out;
  }

  /* ---------- Geometría (coordenadas polares relativas al buque, en px de pantalla) ---------- */
  const G = { R0:15, HDG_LEN:92, CTS_LEN:80, COG_MIN:28, COG_MAX:130, COG_PER_KN:10, RING:52, WEDGE_R:40 };

  function geometry(d){
    // d: { hdg, cog, sogKn, cts, windFrom, windKn, curTo, curKn }   (grados y nudos)
    const out = { lines:[], marks:[], wedge:null };
    out.lines.push({ kind:'hdg', deg:norm(d.hdg), r0:G.R0, r1:G.HDG_LEN });
    const moving = d.cog != null && d.sogKn > 0.15;
    if(moving){
      out.lines.push({ kind:'cog', deg:norm(d.cog), r0:G.R0, r1:clamp(G.COG_MIN + d.sogKn*G.COG_PER_KN, G.COG_MIN, G.COG_MAX), sogKn:d.sogKn });
      const delta = angDiff(d.cog, d.hdg);
      if(Math.abs(delta) >= 0.5) out.wedge = { from:norm(d.hdg), to:norm(d.cog), delta, r:G.WEDGE_R };
    }
    if(d.cts != null) out.lines.push({ kind:'cts', deg:norm(d.cts), r0:G.R0, r1:G.CTS_LEN });
    if(d.windKn > 0)  out.marks.push({ kind:'wind',    deg:norm(d.windFrom), dir:'in',  r:G.RING, kn:d.windKn });   // entra desde su procedencia
    if(d.curKn > 0)   out.marks.push({ kind:'current', deg:norm(d.curTo),    dir:'out', r:G.RING, kn:d.curKn });    // sale hacia su destino
    return out;
  }

  /* Etiquetas: nombran cada flecha con su valor. */
  function tagList(geo, d, opts){
    const compact = !!(opts && opts.compact);
    const tags = [];
    const line = k => geo.lines.find(l => l.kind === k);
    const hdg = line('hdg'), cog = line('cog'), cts = line('cts');
    if(hdg) tags.push({ kind:'hdg', text: compact ? `HDG ${pad3(hdg.deg)}` : `HDG ${pad3(hdg.deg)}°`, deg:hdg.deg, r:hdg.r1 });
    if(cog) tags.push({ kind:'cog', text: compact ? `COG ${pad3(cog.deg)}·${d.sogKn.toFixed(1)}` : `COG ${pad3(cog.deg)}° · ${d.sogKn.toFixed(1)} kn`, deg:cog.deg, r:cog.r1 });
    if(cts) tags.push({ kind:'cts', text: compact ? `CTS ${pad3(cts.deg)}` : `CTS ${pad3(cts.deg)}°`, deg:cts.deg, r:cts.r1 });
    geo.marks.forEach(m => {
      if(m.kind === 'wind')    tags.push({ kind:'wind',    text: compact ? `VIE ${m.kn.toFixed(0)}` : `VIENTO ${m.kn.toFixed(0)} kn · ${pad3(m.deg)}°`,        deg:m.deg, r:m.r + 24 });
      if(m.kind === 'current') tags.push({ kind:'current', text: compact ? `COR ${m.kn.toFixed(1)}` : `CORRIENTE ${m.kn.toFixed(1)} kn · ${pad3(m.deg)}°`, deg:m.deg, r:m.r + 24 });
    });
    if(geo.wedge){
      const w = geo.wedge, mid = norm(w.from + w.delta/2);
      tags.push({ kind:'drift', text: compact ? `DER ${w.delta > 0 ? '+' : '−'}${Math.abs(w.delta).toFixed(0)}` : `DERIVA ${w.delta > 0 ? '+' : '−'}${Math.abs(w.delta).toFixed(1)}°`, deg:mid, r:w.r + 6 });
    }
    return tags;
  }

  function boxFor(cx, cy, t, w, h){
    const a = t.deg * D2R, dx = Math.sin(a), dy = -Math.cos(a);
    const px = cx + dx*t.r, py = cy + dy*t.r;
    const ext = Math.abs(dx)*w/2 + Math.abs(dy)*h/2 + 4;          // el borde cercano de la caja toca la punta
    return { x: px + dx*ext - w/2, y: py + dy*ext - h/2, w, h };
  }
  const overlap = (a, b) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2;
  function clampInto(b, bounds){
    b.x = clamp(b.x, bounds.x + 2, bounds.x + bounds.w - b.w - 2);
    b.y = clamp(b.y, bounds.y + 2, bounds.y + bounds.h - b.h - 2);
    return b;
  }
  /* Coloca las etiquetas en orden de prioridad; las que chocan se desplazan en vertical hasta quedar libres. */
  function placeTags(items, bounds, avoid){
    // `avoid`: rectángulos de la interfaz (panel, radar, consola…) que ninguna etiqueta debe tapar.
    const placed = (avoid || []).slice();
    items.forEach(t => {
      const w = t.box.w, h = t.box.h;
      let best = null;
      search:
      for(const s of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]){
        for(const hx of [0, -1, 1, -1.7, 1.7]){
          const c = clampInto({ x:t.box.x + hx*w*0.55, y:t.box.y + s*(h + 3), w, h }, bounds);
          if(!best) best = c;
          if(!placed.some(p => overlap(p, c))){ best = c; break search; }
        }
      }
      t.box = best; placed.push(best);
    });
    return items;
  }

  /* ---------- Dibujo ---------- */
  const CASING = 'rgba(5,15,22,.62)';
  const polar = (cx, cy, deg, r) => ({ x: cx + Math.sin(deg*D2R)*r, y: cy - Math.cos(deg*D2R)*r });

  function casedPath(ctx, pts, color, width, dash){
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash(dash || []);
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.strokeStyle = CASING; ctx.lineWidth = width + 3; ctx.stroke();
    ctx.strokeStyle = color;  ctx.lineWidth = width;     ctx.stroke();
    ctx.restore();
  }
  function head(ctx, tip, deg, color, size){
    const a = deg * D2R, ux = Math.sin(a), uy = -Math.cos(a), px = -uy, py = ux;
    const b = { x: tip.x - ux*size, y: tip.y - uy*size };
    ctx.save(); ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(b.x + px*size*.5, b.y + py*size*.5); ctx.lineTo(b.x - px*size*.5, b.y - py*size*.5); ctx.closePath();
    ctx.strokeStyle = CASING; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  function render(ctx, view){
    // view: { cx, cy, w, h, geo, tags, colors }
    const { cx, cy, geo, colors: C } = view;
    ctx.save();
    // anillo de referencia (viento y corriente se leen sobre él, como en el radar)
    if(geo.marks.length){
      ctx.beginPath(); ctx.arc(cx, cy, G.RING, 0, Math.PI*2);
      ctx.setLineDash([3, 5]); ctx.strokeStyle = CASING; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = 'rgba(226,232,240,.6)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    }
    // deriva: cuña entre la proa y el rumbo real
    if(geo.wedge){
      const w = geo.wedge, a1 = (w.from - 90)*D2R, a2 = (w.to - 90)*D2R, back = w.delta < 0;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, w.r, a1, a2, back); ctx.closePath();
      ctx.fillStyle = C.drift; ctx.globalAlpha = .24; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(cx, cy, w.r, a1, a2, back);
      ctx.strokeStyle = CASING; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = C.drift; ctx.lineWidth = 3; ctx.stroke();
    }
    // marcas de entorno
    geo.marks.forEach(m => {
      const col = C[m.kind];
      if(m.kind === 'wind'){
        const len = 20 + Math.min(m.kn, 40)/40*16;
        const tail = polar(cx, cy, m.deg, m.r - 4 + len), tip = polar(cx, cy, m.deg, m.r - 4);
        const inward = norm(m.deg + 180);
        casedPath(ctx, [tail, tip], col, 2.5);
        [0, .22].forEach(t => {                                       // plumas en la cola
          const q = { x: tail.x + (tip.x - tail.x)*t, y: tail.y + (tip.y - tail.y)*t };
          [-35, 35].forEach(s => { const e = polar(q.x, q.y, norm(m.deg + s), 8); casedPath(ctx, [q, e], col, 2); });
        });
        head(ctx, tip, inward, col, 9);
      } else {
        const len = 20 + Math.min(m.kn, 3)/3*16;
        const a = m.deg*D2R, ux = Math.sin(a), uy = -Math.cos(a), px = -uy, py = ux;
        const start = polar(cx, cy, m.deg, m.r - 18), pts = [];
        for(let i = 0; i <= 16; i++){
          const t = i/16, s = Math.sin(t*Math.PI*3)*3.2;
          pts.push({ x: start.x + ux*len*t + px*s, y: start.y + uy*len*t + py*s });
        }
        casedPath(ctx, pts, col, 2.5);
        head(ctx, pts[pts.length-1], m.deg, col, 9);
      }
    });
    // líneas: CTS, COG y encima HDG
    const order = ['cts', 'cog', 'hdg'];
    order.forEach(k => geo.lines.filter(l => l.kind === k).forEach(l => {
      const col = C[k], p0 = polar(cx, cy, l.deg, l.r0), p1 = polar(cx, cy, l.deg, l.r1);
      if(k === 'hdg'){ casedPath(ctx, [p0, p1], col, 3); head(ctx, p1, l.deg, col, 11); }
      if(k === 'cog'){ casedPath(ctx, [p0, p1], col, 3, [9, 6]); head(ctx, p1, l.deg, col, 10); }
      if(k === 'cts'){
        casedPath(ctx, [p0, p1], col, 3, [1, 7]);
        ctx.beginPath(); ctx.arc(p1.x, p1.y, 6, 0, Math.PI*2);
        ctx.strokeStyle = CASING; ctx.lineWidth = 4.5; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      }
    }));
    // etiquetas
    ctx.font = '700 11px "DM Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    (view.tags || []).forEach(t => {
      const b = t.box, col = C[t.kind], sp = t.text.indexOf(' '), abbr = t.text.slice(0, sp), rest = t.text.slice(sp);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(b.x, b.y, b.w, b.h, 4) : ctx.rect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(5,15,22,.78)'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = col; ctx.fillText(abbr, b.x + 6, b.y + b.h/2 + .5);
      ctx.fillStyle = '#e6efef'; ctx.fillText(rest, b.x + 6 + ctx.measureText(abbr).width, b.y + b.h/2 + .5);
    });
    ctx.restore();
  }

  /* Calcula etiquetas ya colocadas, para dibujar o para probar. */
  function layout(view, d, measure, avoid, mode){
    // mode: 'full' (por defecto), 'compact' (texto corto sobre el canvas) o 'none' (solo flechas; las cifras van en la lista)
    const geo = geometry(d), tags = mode === 'none' ? [] : tagList(geo, d, { compact: mode === 'compact' });
    tags.forEach(t => { const w = Math.ceil(measure(t.text)) + 12, h = 18; t.box = boxFor(view.cx, view.cy, t, w, h); });
    placeTags(tags, { x:0, y:0, w:view.w, h:view.h }, avoid);
    return { geo, tags };
  }

  /* Filas de la lista bajo el diagrama de fuerzas: el mismo dato que las etiquetas, fuera de la carta. */
  function listRows(d){
    const geo = geometry(d), rows = [];
    rows.push({ kind:'hdg', name:'Proa', value:`${pad3(d.hdg)}°` });
    if(d.cog != null && d.sogKn > 0.15) rows.push({ kind:'cog', name:'Rumbo real', value:`${pad3(d.cog)}° · ${d.sogKn.toFixed(1)} kn` });
    else rows.push({ kind:'cog', name:'Rumbo real', value:'—' });
    if(d.cts != null) rows.push({ kind:'cts', name:'Gobernar', value:`${pad3(d.cts)}°` });
    if(d.windKn > 0) rows.push({ kind:'wind', name:'Viento', value:`${d.windKn.toFixed(0)} kn de ${pad3(d.windFrom)}°` });          // "de" = desde donde sopla
    if(d.curKn > 0) rows.push({ kind:'current', name:'Corriente', value:`${d.curKn.toFixed(1)} kn a ${pad3(d.curTo)}°` });     // "a" = hacia donde va
    if(geo.wedge) rows.push({ kind:'drift', name:'Deriva', value:`${geo.wedge.delta > 0 ? '+' : '−'}${Math.abs(geo.wedge.delta).toFixed(1)}°` });
    return rows;
  }

  /* Muestras para la leyenda (SVG en línea con el mismo color y forma que en el mapa). */
  function sampleSVG(kind, color){
    const s = `fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`;
    const tri = `<path d="M40 7 L33 3.5 L33 10.5 Z" fill="${color}" stroke="none"/>`;
    const body = {
      hdg:     `<path d="M3 7 H34" ${s}/>${tri}`,
      cog:     `<path d="M3 7 H34" ${s} stroke-dasharray="6 4"/>${tri}`,
      cts:     `<path d="M3 7 H30" ${s} stroke-dasharray="1 5"/><circle cx="36" cy="7" r="3.4" ${s} stroke-width="1.8"/>`,
      wind:    `<path d="M3 7 H31 M3 7 l-0 0 M7 7 l-3 -4 M7 7 l-3 4 M12 7 l-3 -4 M12 7 l-3 4" ${s} stroke-width="2"/>${tri}`,
      current: `<path d="M3 7 q4 -4 8 0 t8 0 t8 0 t5 0" ${s}/>${tri}`,
      drift:   `<path d="M5 12 L5 2 A10 10 0 0 1 14 5 Z" fill="${color}" fill-opacity=".28" stroke="${color}" stroke-width="2"/>`,
      route:   `<path d="M4 11 L20 4 L38 9" ${s} stroke-dasharray="5 3"/><circle cx="20" cy="4" r="3" fill="${color}" stroke="none"/>`,
      thrust:  `<path d="M3 7 H33" ${s} stroke-width="3.6"/>${tri}`
    }[kind] || '';
    return `<svg class="legend-glyph" viewBox="0 0 44 14" width="44" height="14" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  return { CATALOG, SIDES, G, colors, geometry, tagList, listRows, boxFor, placeTags, layout, render, sampleSVG, overlap, norm, angDiff, pad3 };
});
