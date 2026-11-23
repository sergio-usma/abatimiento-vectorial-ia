'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../js/vectors.js');

const base = { hdg:300, cog:312, sogKn:4.2, cts:null, windFrom:45, windKn:18, curTo:245, curKn:0.5 };

test('catálogo: ninguna magnitud repite color, forma ni nombre', () => {
  const all = V.CATALOG.concat(V.SIDES);
  assert.equal(new Set(all.map(c => c.hex.toLowerCase())).size, all.length);
  assert.equal(new Set(V.CATALOG.map(c => c.shape)).size, V.CATALOG.length);
  assert.equal(new Set(all.map(c => c.name)).size, all.length);
  assert.equal(new Set(V.CATALOG.map(c => c.abbr)).size, V.CATALOG.length);
});

test('geometría: HDG siempre; COG solo en movimiento y su largo crece con la velocidad', () => {
  const still = V.geometry({ ...base, sogKn: 0 });
  assert.ok(still.lines.find(l => l.kind === 'hdg'));
  assert.equal(still.lines.find(l => l.kind === 'cog'), undefined);
  assert.equal(still.wedge, null);
  const slow = V.geometry({ ...base, sogKn: 1 }).lines.find(l => l.kind === 'cog');
  const fast = V.geometry({ ...base, sogKn: 8 }).lines.find(l => l.kind === 'cog');
  assert.ok(fast.r1 > slow.r1);
  assert.ok(fast.r1 <= V.G.COG_MAX && slow.r1 >= V.G.COG_MIN);
});

test('deriva: la cuña mide el ángulo HDG → COG con signo, también cruzando el 000', () => {
  assert.equal(Math.round(V.geometry({ ...base, hdg:300, cog:312 }).wedge.delta), 12);
  assert.equal(Math.round(V.geometry({ ...base, hdg:300, cog:288 }).wedge.delta), -12);
  assert.equal(Math.round(V.geometry({ ...base, hdg:355, cog:5 }).wedge.delta), 10);
  assert.equal(V.geometry({ ...base, hdg:300, cog:300.2 }).wedge, null);   // deriva despreciable: no se dibuja
});

test('viento entra desde su procedencia; corriente sale hacia su destino', () => {
  const g = V.geometry(base);
  const w = g.marks.find(m => m.kind === 'wind'), c = g.marks.find(m => m.kind === 'current');
  assert.equal(w.deg, 45); assert.equal(w.dir, 'in');
  assert.equal(c.deg, 245); assert.equal(c.dir, 'out');
  assert.equal(V.geometry({ ...base, windKn:0, curKn:0 }).marks.length, 0);
});

test('CTS solo aparece con guiado', () => {
  assert.equal(V.geometry(base).lines.find(l => l.kind === 'cts'), undefined);
  assert.equal(V.geometry({ ...base, cts:320 }).lines.find(l => l.kind === 'cts').deg, 320);
});

test('etiquetas: nombran cada flecha con su valor', () => {
  const d = { ...base, cts:320 };
  const texts = V.tagList(V.geometry(d), d).map(t => t.text);
  assert.ok(texts.includes('HDG 300°'));
  assert.ok(texts.includes('COG 312° · 4.2 kn'));
  assert.ok(texts.includes('CTS 320°'));
  assert.ok(texts.includes('VIENTO 18 kn · 045°'));
  assert.ok(texts.includes('CORRIENTE 0.5 kn · 245°'));
  assert.ok(texts.some(t => t.startsWith('DERIVA +12.0')));
});

test('colocación: ninguna etiqueta se solapa con otra y todas quedan dentro del canvas', () => {
  const measure = t => t.length * 6.6;
  const cases = [
    { ...base, cts:305 },                                   // CTS casi sobre HDG
    { ...base, hdg:0, cog:3, cts:2, windFrom:0, curTo:0 },   // todo hacia el norte
    { ...base, hdg:90, cog:95, cts:92, windFrom:90, curTo:90 },
    { ...base, hdg:200, cog:190, cts:196, windFrom:20, curTo:200 }
  ];
  const view = { cx:420, cy:300, w:840, h:600 };
  cases.forEach((d, i) => {
    const { tags } = V.layout(view, d, measure);
    for(let a = 0; a < tags.length; a++){
      const b = tags[a].box;
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= view.w && b.y + b.h <= view.h, `caso ${i}: fuera del canvas`);
      for(let c = a + 1; c < tags.length; c++) assert.ok(!V.overlap(b, tags[c].box), `caso ${i}: ${tags[a].text} choca con ${tags[c].text}`);
    }
  });
});

test('colocación: cerca del borde las etiquetas se mantienen dentro', () => {
  const measure = t => t.length * 6.6;
  const { tags } = V.layout({ cx:40, cy:30, w:300, h:200 }, { ...base, hdg:270, cog:280 }, measure);
  tags.forEach(t => assert.ok(t.box.x >= 0 && t.box.y >= 0 && t.box.x + t.box.w <= 300 && t.box.y + t.box.h <= 200));
});

test('colocación: las etiquetas esquivan los rectángulos de la interfaz', () => {
  const measure = t => t.length * 6.6;
  const view = { cx:420, cy:300, w:840, h:600 };
  const ui = [{ x:480, y:250, w:200, h:120 }, { x:200, y:380, w:150, h:150 }];      // p. ej. panel de puente y radar
  const { tags } = V.layout(view, { ...base, hdg:60, cog:70, cts:65, windFrom:90, curTo:120 }, measure, ui);
  tags.forEach(t => ui.forEach(r => assert.ok(!V.overlap(t.box, r), `${t.text} tapa la interfaz`)));
});

test('muestras de leyenda: una por magnitud, con su color', () => {
  V.CATALOG.forEach(c => {
    const svg = V.sampleSVG(c.key, c.hex);
    assert.match(svg, /<svg/); assert.ok(svg.includes(c.hex), c.key);
  });
});

test('etiquetas compactas son más cortas y el modo none no dibuja texto', () => {
  const g = V.geometry(base);
  const full = V.tagList(g, base).map(t => t.text.length), comp = V.tagList(g, base, { compact:true }).map(t => t.text.length);
  comp.forEach((n, i) => assert.ok(n < full[i]));
  assert.equal(V.layout({ cx:420, cy:300, w:840, h:600 }, base, t => t.length*6.6, [], 'none').tags.length, 0);
  assert.ok(V.layout({ cx:420, cy:300, w:840, h:600 }, base, t => t.length*6.6, [], 'compact').tags.length > 0);
});

test('filas de la lista: mismo dato que las etiquetas, con SOG junto al COG y sentido en viento/corriente', () => {
  const rows = V.listRows({ ...base, cts:320 });
  const by = Object.fromEntries(rows.map(r => [r.kind, r]));
  assert.equal(by.hdg.value, '300°');
  assert.equal(by.cog.value, '312° · 4.2 kn');
  assert.equal(by.cts.value, '320°');
  assert.equal(by.wind.value, '18 kn de 045°'); assert.equal(by.current.value, '0.5 kn a 245°');
  assert.match(by.drift.value, /^\+12\.0°/);
  assert.equal(V.listRows({ ...base, sogKn:0 }).find(r => r.kind === 'cog').value, '—');
});
