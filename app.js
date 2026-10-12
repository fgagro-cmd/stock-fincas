'use strict';
/* Stock Fincas — app de stock, entradas y salidas de mis fincas.
   Todo se guarda en el propio móvil (IndexedDB) y funciona sin conexión. */

const APP_VERSION = '1.1.0';

/* ---------- Listas fijas (textos tal como los lee el Excel de Gestión de fincas) ---------- */
const CAT_STOCK = ['Fertilizantes', 'Fitosanitarios', 'Herbicidas', 'Bioestimulantes']; // los únicos que mueven stock
const CATEGORIAS = ['Ingreso', 'Gasto', 'Tarea'];
const TIPOS = {
  Ingreso: ['Cosecha', 'Subvención', 'Otros ingresos'],
  Gasto: ['Fertilizantes', 'Fitosanitarios', 'Herbicidas', 'Bioestimulantes', 'Combustible', 'Material de riego', 'Agua de riego', 'Enmienda orgánica', 'Arrendamiento', 'Otros'],
  Tarea: ['Fumigacion', 'Labrar', 'Desbrozar', 'Poda', 'Herbicida', 'Mantenimiento', 'Mejoras', 'Estiércol', 'Recolección', 'Otras tareas'],
};
const TIPO2 = ['Con maquinaria', 'Sin maquinaria', 'Contratado'];
const FINCAS = [
  { code: 'LN', name: 'Limoneros Niño' },
  { code: 'LH', name: 'Limoneros Herrero' },
  { code: 'PH', name: 'Pomelos Herrero' },
  { code: 'LG', name: 'Limoneros Gines' },
  { code: 'FC', name: 'Finca Cortijo' },
  { code: 'NP', name: 'Naranjos Prao Negro' },
];
const EXPORT_HEADER = ['Fecha', 'Descripción', 'Campaña', 'Categoria', 'Tipo', 'Tipo 2', 'Finca', 'Cantidad', 'Precio', 'Importe'];
const EPS = 0.0005;

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, min = 2, max = 2) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const eur = (n) => nf(n) + ' €';
const qty = (n) => nf(n, 0, 3);
const round = (n, d) => { const k = 10 ** d; return Math.round((n + Number.EPSILON * Math.sign(n)) * k) / k; };
const fincaByCode = (c) => FINCAS.find((f) => f.code === c);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

function parseNum(s) {
  s = String(s ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c > -1) s = s.replace(',', '.');
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
}
const fmtIn = (n, d = 6) => (n === '' || n == null || !isFinite(n) ? '' : String(round(n, d)).replace('.', ','));
const numEs = (n, d) => String(round(n, d)).replace('.', ',');

function todayISO() { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
const fmtDate = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const monthOf = (iso) => iso.slice(0, 7);
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function dayLabel(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); }

/* ---------- Almacenamiento (IndexedDB) ---------- */
let dbp;
function idb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('stock-fincas', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function dbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function dbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}

/* ---------- Estado ---------- */
let state;
let saveChain = Promise.resolve();
function persist() {
  saveChain = saveChain.then(() => dbSet('state', state)).catch((e) => toast('No se pudo guardar en el móvil: ' + (e && e.message || e), true));
  markDirty();
  return saveChain;
}
function seedState() {
  return {
    v: 1,
    settings: { campana: 2026, lastBackup: null },
    productos: window.SEED_PRODUCTOS.map((p, i) => ({ id: 'p' + (i + 1), nombre: p.nombre, categoria: p.categoria, q0: p.q0, v0: p.v0 })),
    entradas: [],
    movs: [],
  };
}

/* ---------- Motor de stock ----------
   Stock = stock de partida + entradas − salidas.
   Valor = valor de partida + importe de entradas − importe de salidas (a precio congelado de cada salida).
   Precio medio = valor ÷ stock (igual que tu Excel). */
function computeStock(st = state) {
  const m = new Map();
  for (const p of st.productos) m.set(p.id, { p, q: p.q0, v: p.v0 });
  for (const e of st.entradas) { const x = m.get(e.producto); if (x) { x.q += e.cantidad; x.v += e.importe; } }
  for (const s of st.movs) if (s.producto) { const x = m.get(s.producto); if (x) { x.q -= s.cantidad; x.v -= s.importe; } }
  for (const x of m.values()) { x.q = round(x.q, 4); x.avg = x.q > EPS ? x.v / x.q : null; }
  return m;
}
const totalValor = (m) => { let t = 0; for (const x of m.values()) if (x.q > EPS) t += x.v; return t; };
function validate(st) {
  for (const x of computeStock(st).values()) {
    if (x.q < -EPS) return `No hay stock suficiente de «${x.p.nombre}» (quedaría en ${qty(x.q)})`;
  }
  return null;
}
/* Aplica un cambio sobre una copia, comprueba que ningún producto quede en negativo y solo entonces lo guarda. */
function commit(mutator) {
  const c = structuredClone(state);
  try { mutator(c); } catch (e) { toast(e.message, true); return false; }
  const err = validate(c);
  if (err) { toast(err, true); return false; }
  state = c; persist(); renderAll();
  return true;
}
const isStockMode = (categoria, tipo) => categoria === 'Gasto' && CAT_STOCK.includes(tipo);

/* ---------- UI: estado de pantalla ---------- */
const ui = { tab: 'salidas', stockCat: 'Todas', stockMode: 'con', stockQ: '', salMes: monthOf(todayISO()), salCat: 'Todas', entMes: monthOf(todayISO()), lastCat: 'Gasto', lastTipo: 'Fertilizantes' };

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, err ? 4200 : 2200);
}

/* ---------- Hojas inferiores (formularios) ---------- */
const sheetRoot = $('#sheetRoot');
let sheetOpen = false;
function openSheet(title, bodyHTML) {
  if (!sheetOpen) history.pushState({ sheet: true }, '');
  sheetOpen = true;
  sheetRoot.innerHTML = `<div class="scrim"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="x" aria-label="Cerrar">✕</button></header><div class="sheet-body">${bodyHTML}</div></section>`;
  $('.scrim', sheetRoot).onclick = closeSheet;
  $('.x', sheetRoot).onclick = closeSheet;
  return $('.sheet-body', sheetRoot);
}
function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false; sheetRoot.innerHTML = '';
  if (history.state && history.state.sheet) history.back();
}
window.addEventListener('popstate', () => { if (sheetOpen) { sheetOpen = false; sheetRoot.innerHTML = ''; } });

function armDelete(btn, action) {
  let armed = false, timer;
  btn.onclick = () => {
    if (!armed) { armed = true; btn.classList.add('armed'); btn.textContent = 'Pulsa otra vez para borrar'; timer = setTimeout(() => { armed = false; btn.classList.remove('armed'); btn.textContent = 'Borrar'; }, 3500); }
    else { clearTimeout(timer); action(); }
  };
}

/* ---------- Pantalla: Stock ---------- */
function renderStock() {
  const m = computeStock();
  const all = [...m.values()];
  const withStock = all.filter((x) => x.q > EPS).length;
  const cats = ['Todas', ...CAT_STOCK];
  $('#view').innerHTML = `
    <div class="toolbar"><input id="stockQ" class="grow" type="search" placeholder="Buscar producto" value="${esc(ui.stockQ)}" autocomplete="off"></div>
    <div class="chips" id="stockCats">${cats.map((c) => `<button class="chip" data-cat="${c}" aria-pressed="${ui.stockCat === c}">${c}</button>`).join('')}</div>
    <div class="seg" id="stockMode">
      <button data-mode="con" aria-pressed="${ui.stockMode === 'con'}">Con stock (${withStock})</button>
      <button data-mode="todos" aria-pressed="${ui.stockMode === 'todos'}">Todos (${all.length})</button>
    </div>
    <ul class="list" id="stockList"></ul>`;
  $('#stockQ').oninput = (e) => { ui.stockQ = e.target.value; renderStockList(); };
  $('#stockCats').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) { ui.stockCat = b.dataset.cat; renderStock(); } };
  $('#stockMode').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) { ui.stockMode = b.dataset.mode; renderStock(); } };
  renderStockList();
}
function renderStockList() {
  const m = computeStock();
  const q = ui.stockQ.trim().toLowerCase();
  const items = [...m.values()]
    .filter((x) => (ui.stockCat === 'Todas' || x.p.categoria === ui.stockCat) && (ui.stockMode === 'todos' || x.q > EPS) && (!q || x.p.nombre.toLowerCase().includes(q)))
    .sort((a, b) => a.p.nombre.localeCompare(b.p.nombre, 'es'));
  const ul = $('#stockList');
  if (!items.length) { ul.innerHTML = `<li class="empty">${ui.stockMode === 'con' ? 'No hay productos con stock en este filtro.' : 'Sin resultados.'}</li>`; return; }
  ul.innerHTML = items.map((x) => `
    <li><button class="row ${x.q > EPS ? '' : 'dim'}" data-id="${x.p.id}">
      <div class="main"><div class="name">${esc(x.p.nombre)}</div><div class="sub">${esc(x.p.categoria)}${x.avg != null ? ` · P. medio ${eur(x.avg)}` : ''}</div></div>
      <div class="side"><div class="big">${qty(x.q)}</div><div class="sub">${x.q > EPS ? eur(x.v) : 'sin stock'}</div></div>
    </button></li>`).join('');
  ul.onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) openProductSheet(b.dataset.id); };
}

function openProductSheet(id) {
  const isNew = !id;
  const m = computeStock();
  const x = isNew ? null : m.get(id);
  const used = !isNew && (state.entradas.some((e) => e.producto === id) || state.movs.some((s) => s.producto === id));
  const unusedAndEmpty = !isNew && !used && x.p.q0 === 0 && x.p.v0 === 0;
  const body = openSheet(isNew ? 'Producto nuevo' : x.p.nombre, `
    ${isNew ? '' : `<div class="box"><div><span>Stock</span><b>${qty(x.q)}</b></div><div><span>Precio medio</span><b>${x.avg != null ? eur(x.avg) : '—'}</b></div><div><span>Valor</span><b>${x.q > EPS ? eur(x.v) : '—'}</b></div></div>`}
    <label class="fld"><span>Nombre</span><input id="pName" type="text" value="${isNew ? '' : esc(x.p.nombre)}" autocomplete="off"></label>
    <div class="fld"><span>Categoría</span><div class="chips wrap" id="pCat">${CAT_STOCK.map((c) => `<button type="button" class="chip" data-c="${c}" aria-pressed="${(isNew ? CAT_STOCK[0] : x.p.categoria) === c}" ${!isNew && used ? 'disabled' : ''}>${c}</button>`).join('')}</div></div>
    ${!isNew && used ? '<p class="hint">La categoría no se puede cambiar porque el producto ya tiene movimientos.</p>' : ''}
    <div class="actions ${isNew ? '' : 'two'}">
      ${isNew ? '' : `<button class="btn danger" id="pDel" ${unusedAndEmpty ? '' : 'disabled'}>Borrar</button>`}
      <button class="btn primary" id="pSave">Guardar</button>
    </div>
    ${!isNew && !unusedAndEmpty ? '<p class="hint" style="margin-top:10px">Solo se pueden borrar productos sin stock de partida ni movimientos.</p>' : ''}`);
  let cat = isNew ? CAT_STOCK[0] : x.p.categoria;
  $('#pCat', body).onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b || b.disabled) return; cat = b.dataset.c; body.querySelectorAll('#pCat .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.c === cat)); };
  $('#pSave', body).onclick = () => {
    const nombre = $('#pName', body).value.trim();
    if (!nombre) return toast('Escribe el nombre del producto', true);
    if (state.productos.some((p) => p.id !== id && p.nombre.toLowerCase() === nombre.toLowerCase())) return toast('Ya existe un producto con ese nombre', true);
    const ok = commit((c) => {
      if (isNew) c.productos.push({ id: 'p' + uid().slice(0, 8), nombre, categoria: cat, q0: 0, v0: 0 });
      else {
        const p = c.productos.find((p) => p.id === id);
        p.nombre = nombre; p.categoria = cat;
        c.movs.forEach((s) => { if (s.producto === id) s.desc = nombre; });
      }
    });
    if (ok) { closeSheet(); toast(isNew ? 'Producto creado' : 'Producto actualizado'); }
  };
  if (!isNew && unusedAndEmpty) armDelete($('#pDel', body), () => { if (commit((c) => { c.productos = c.productos.filter((p) => p.id !== id); })) { closeSheet(); toast('Producto borrado'); } });
}

/* ---------- Campos de cantidad / precio / total ---------- */
const amountsHTML = (f, lblPrecio = 'Precio €') => `
  <div class="grid3">
    <label class="fld"><span>Cantidad</span><input id="aQ" type="text" inputmode="decimal" value="${esc(f.cantidad)}" placeholder="0"></label>
    <label class="fld"><span>${lblPrecio}</span><input id="aP" type="text" inputmode="decimal" value="${esc(f.precio)}" placeholder="0"></label>
    <label class="fld"><span>Total €</span><input id="aT" type="text" inputmode="decimal" value="${esc(f.importe)}" placeholder="0"></label>
  </div>`;
function bindAmounts(root, f) {
  const q = $('#aQ', root), p = $('#aP', root), t = $('#aT', root);
  const sync = (who) => {
    const cq = parseNum(q.value), cp = parseNum(p.value), ct = parseNum(t.value);
    f.cantidad = q.value; f.precio = p.value; f.importe = t.value;
    if (who === 'q') {
      if (f.edited === 'importe' && isFinite(cq) && cq !== 0 && isFinite(ct)) { f.precio = fmtIn(ct / cq); p.value = f.precio; }
      else if (isFinite(cq) && isFinite(cp)) { f.importe = fmtIn(cq * cp, 4); t.value = f.importe; }
    } else if (who === 'p') {
      f.edited = 'precio';
      if (isFinite(cq) && isFinite(cp)) { f.importe = fmtIn(cq * cp, 4); t.value = f.importe; } else { f.importe = ''; t.value = ''; }
    } else if (who === 't') {
      f.edited = 'importe';
      if (isFinite(cq) && cq !== 0 && isFinite(ct)) { f.precio = fmtIn(ct / cq); p.value = f.precio; } else { f.precio = ''; p.value = ''; }
    }
  };
  q.oninput = () => sync('q'); p.oninput = () => sync('p'); t.oninput = () => sync('t');
}
/* Devuelve {cantidad, precio, importe} a partir del formulario, o un texto de error. */
function readAmounts(f, { allowNegativeQty = false } = {}) {
  const cantidad = parseNum(f.cantidad);
  if (!isFinite(cantidad) || cantidad === 0 || (!allowNegativeQty && cantidad < 0)) return { error: allowNegativeQty ? 'Indica la cantidad (negativa para corregir inventario)' : 'Indica una cantidad mayor que 0' };
  const p = parseNum(f.precio), t = parseNum(f.importe);
  let precio, importe;
  if (f.edited === 'importe' && isFinite(t)) { importe = round(t, 4); precio = importe / cantidad; }
  else if (isFinite(p)) { precio = p; importe = round(cantidad * p, 4); }
  else if (isFinite(t)) { importe = round(t, 4); precio = importe / cantidad; }
  else return { error: 'Indica el precio unitario o el total' };
  if (precio < 0) return { error: 'El precio no puede ser negativo' };
  return { cantidad, precio, importe };
}

/* ---------- Pantalla: Entradas ---------- */
function renderEntradas() {
  const meses = [...new Set([ui.entMes, ...state.entradas.map((e) => monthOf(e.fecha))])].sort().reverse();
  const items = state.entradas.filter((e) => ui.entMes === 'todos' || monthOf(e.fecha) === ui.entMes)
    .sort((a, b) => (b.fecha.localeCompare(a.fecha)) || (b.ts - a.ts));
  const byId = new Map(state.productos.map((p) => [p.id, p]));
  const total = items.reduce((s, e) => s + e.importe, 0);
  $('#view').innerHTML = `
    <div class="toolbar"><select id="entMes" class="grow" aria-label="Mes"><option value="todos">Todos los meses</option>${meses.map((mm) => `<option value="${mm}" ${mm === ui.entMes ? 'selected' : ''}>${monthLabel(mm)}</option>`).join('')}</select></div>
    <div class="summary"><span><b>${items.length}</b> entradas</span><span>Importe <b>${eur(total)}</b></span></div>
    ${items.length ? `<ul class="list">${items.map((e) => `
      <li><button class="row" data-id="${e.id}">
        <div class="main"><div class="name">${esc(byId.get(e.producto)?.nombre ?? '(producto borrado)')}</div><div class="sub">${fmtDate(e.fecha)} · ${qty(e.cantidad)} × ${eur(e.cantidad ? e.importe / e.cantidad : 0)}${e.cantidad < 0 ? ' · corrección' : ''}</div></div>
        <div class="side"><div class="big ${e.importe < 0 ? 'neg' : ''}">${eur(e.importe)}</div></div>
      </button></li>`).join('')}</ul>` : '<div class="empty">No hay entradas en este mes.<br>Pulsa «Nueva entrada» para registrar una compra.</div>'}`;
  $('#entMes').onchange = (e) => { ui.entMes = e.target.value; renderEntradas(); };
  const ul = $('#view .list'); if (ul) ul.onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) openEntradaForm(state.entradas.find((x) => x.id === b.dataset.id)); };
}

function openEntradaForm(orig) {
  const isNew = !orig;
  const f = orig
    ? { fecha: orig.fecha, producto: orig.producto, nuevoNombre: '', nuevaCat: CAT_STOCK[0], cantidad: fmtIn(orig.cantidad), precio: fmtIn(orig.cantidad ? orig.importe / orig.cantidad : 0), importe: fmtIn(orig.importe, 4), edited: 'precio' }
    : { fecha: todayISO(), producto: '', nuevoNombre: '', nuevaCat: CAT_STOCK[0], cantidad: '', precio: '', importe: '', edited: 'precio' };
  const body = openSheet(isNew ? 'Nueva entrada' : 'Editar entrada', '<div id="ef"></div>');
  const box = $('#ef', body);
  const draw = () => {
    const m = computeStock();
    const sel = m.get(f.producto);
    const groups = CAT_STOCK.map((c) => `<optgroup label="${c}">${[...m.values()].filter((x) => x.p.categoria === c).sort((a, b) => a.p.nombre.localeCompare(b.p.nombre, 'es')).map((x) => `<option value="${x.p.id}" ${f.producto === x.p.id ? 'selected' : ''}>${esc(x.p.nombre)}${x.q > EPS ? ' · ' + qty(x.q) : ''}</option>`).join('')}</optgroup>`).join('');
    box.innerHTML = `
      <label class="fld"><span>Fecha</span><input id="eF" type="date" value="${f.fecha}"></label>
      <label class="fld"><span>Producto</span><select id="eP"><option value="">Elige un producto…</option><option value="__new" ${f.producto === '__new' ? 'selected' : ''}>➕ Producto nuevo…</option>${groups}</select></label>
      ${f.producto === '__new' ? `
        <label class="fld"><span>Nombre del producto nuevo</span><input id="eN" type="text" value="${esc(f.nuevoNombre)}" autocomplete="off"></label>
        <div class="fld"><span>Categoría</span><div class="chips wrap" id="eC">${CAT_STOCK.map((c) => `<button type="button" class="chip" data-c="${c}" aria-pressed="${f.nuevaCat === c}">${c}</button>`).join('')}</div></div>` : ''}
      ${sel ? `<div class="box"><div><span>Stock ahora</span><b>${qty(sel.q)}</b></div><div><span>Precio medio ahora</span><b>${sel.avg != null ? eur(sel.avg) : '—'}</b></div></div>` : ''}
      ${amountsHTML(f, 'Precio unit. €')}
      <p class="hint">Para corregir el inventario, usa una cantidad negativa (por ejemplo −2).</p>
      <div class="actions ${isNew ? '' : 'two'}">
        ${isNew ? '' : '<button class="btn danger" id="eDel">Borrar</button>'}
        <button class="btn primary" id="eSave">Guardar</button>
      </div>`;
    $('#eF', box).onchange = (e) => { f.fecha = e.target.value; };
    $('#eP', box).onchange = (e) => { f.producto = e.target.value; draw(); };
    const en = $('#eN', box); if (en) en.oninput = (e) => { f.nuevoNombre = e.target.value; };
    const ec = $('#eC', box); if (ec) ec.onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { f.nuevaCat = b.dataset.c; draw(); } };
    bindAmounts(box, f);
    $('#eSave', box).onclick = save;
    if (!isNew) armDelete($('#eDel', box), () => { if (commit((c) => { c.entradas = c.entradas.filter((e) => e.id !== orig.id); })) { closeSheet(); toast('Entrada borrada'); } });
  };
  const save = () => {
    if (!f.fecha) return toast('Indica la fecha', true);
    if (!f.producto) return toast('Elige un producto', true);
    let nombre = '';
    if (f.producto === '__new') {
      nombre = f.nuevoNombre.trim();
      if (!nombre) return toast('Escribe el nombre del producto nuevo', true);
      if (state.productos.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase())) return toast('Ya existe un producto con ese nombre: elígelo de la lista', true);
    }
    const a = readAmounts(f, { allowNegativeQty: true });
    if (a.error) return toast(a.error, true);
    const ok = commit((c) => {
      let pid = f.producto;
      if (pid === '__new') { pid = 'p' + uid().slice(0, 8); c.productos.push({ id: pid, nombre, categoria: f.nuevaCat, q0: 0, v0: 0 }); }
      if (isNew) c.entradas.push({ id: uid(), ts: Date.now(), fecha: f.fecha, producto: pid, cantidad: a.cantidad, importe: a.importe });
      else { const e = c.entradas.find((x) => x.id === orig.id); Object.assign(e, { fecha: f.fecha, producto: pid, cantidad: a.cantidad, importe: a.importe }); }
    });
    if (ok) { closeSheet(); toast(isNew ? 'Entrada guardada' : 'Entrada actualizada'); }
  };
  draw();
}

/* ---------- Pantalla: Salidas (registro de campo) ---------- */
function movsFiltered() {
  return state.movs.filter((s) => (ui.salMes === 'todos' || monthOf(s.fecha) === ui.salMes) && (ui.salCat === 'Todas' || s.categoria === ui.salCat))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.ts - a.ts);
}
function renderSalidas() {
  const meses = [...new Set([ui.salMes === 'todos' ? monthOf(todayISO()) : ui.salMes, ...state.movs.map((s) => monthOf(s.fecha))])].sort().reverse();
  const items = movsFiltered();
  const sum = (cat) => state.movs.filter((s) => s.categoria === cat && (ui.salMes === 'todos' || monthOf(s.fecha) === ui.salMes)).reduce((t, s) => t + s.importe, 0);
  let lastDay = '';
  const rows = items.map((s) => {
    const head = s.fecha !== lastDay ? `<li class="day">${dayLabel(s.fecha)}</li>` : ''; lastDay = s.fecha;
    const pill = s.categoria === 'Ingreso' ? 'in' : s.categoria === 'Tarea' ? 'task' : '';
    return `${head}<li><button class="row" data-id="${s.id}">
      <div class="main"><div class="name">${esc(s.desc)}</div><div class="sub"><span class="pill ${pill}">${s.categoria}</span>${esc(s.tipo)}${s.tipo2 ? ' · ' + esc(s.tipo2) : ''} · ${esc(s.finca)}</div></div>
      <div class="side"><div class="big">${eur(s.importe)}</div><div class="sub">${qty(s.cantidad)} × ${eur(s.precio)}</div></div>
    </button></li>`;
  }).join('');
  $('#view').innerHTML = `
    <div class="toolbar">
      <select id="salMes" class="grow" aria-label="Mes"><option value="todos">Todos los meses</option>${meses.map((mm) => `<option value="${mm}" ${mm === ui.salMes ? 'selected' : ''}>${monthLabel(mm)}</option>`).join('')}</select>
      <button class="btn" id="btnExport" style="height:46px;padding:0 14px">Exportar</button>
    </div>
    <div class="chips" id="salCats">${['Todas', ...CATEGORIAS].map((c) => `<button class="chip" data-cat="${c}" aria-pressed="${ui.salCat === c}">${c === 'Todas' ? 'Todas' : c + 's'}</button>`).join('')}</div>
    <div class="summary"><span>Gastos <b>${eur(sum('Gasto'))}</b></span><span>Tareas <b>${eur(sum('Tarea'))}</b></span><span>Ingresos <b>${eur(sum('Ingreso'))}</b></span></div>
    ${items.length ? `<ul class="list">${rows}</ul>` : '<div class="empty">No hay registros en este filtro.<br>Pulsa «Nueva salida» para anotar el día.</div>'}`;
  $('#salMes').onchange = (e) => { ui.salMes = e.target.value; renderSalidas(); };
  $('#salCats').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) { ui.salCat = b.dataset.cat; renderSalidas(); } };
  $('#btnExport').onclick = openExportSheet;
  const ul = $('#view .list'); if (ul) ul.onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) openMovForm(state.movs.find((x) => x.id === b.dataset.id)); };
}

function openMovForm(orig) {
  const isNew = !orig;
  const f = orig
    ? { fecha: orig.fecha, categoria: orig.categoria, tipo: orig.tipo, tipo2: orig.tipo2 || '', finca: orig.finca, desc: orig.producto ? '' : orig.desc, producto: orig.producto || '', cantidad: fmtIn(orig.cantidad), precio: fmtIn(orig.precio), importe: fmtIn(orig.importe, 4), edited: 'precio' }
    : { fecha: todayISO(), categoria: ui.lastCat, tipo: ui.lastTipo, tipo2: '', finca: '', desc: '', producto: '', cantidad: '', precio: '', importe: '', edited: 'precio' };
  const body = openSheet(isNew ? 'Nueva salida' : 'Editar registro', '<div id="mf"></div>');
  const box = $('#mf', body);
  const descs = [...new Set(state.movs.filter((s) => !s.producto).map((s) => s.desc))].sort((a, b) => a.localeCompare(b, 'es')).slice(0, 80);

  const draw = () => {
    const stockMode = isStockMode(f.categoria, f.tipo);
    const m = computeStock();
    const prods = stockMode ? [...m.values()].filter((x) => x.p.categoria === f.tipo).sort((a, b) => a.p.nombre.localeCompare(b.p.nombre, 'es')) : [];
    const sel = stockMode && f.producto ? m.get(f.producto) : null;
    const own = !isNew && orig.producto === f.producto ? orig.cantidad : 0; // lo que ya descuenta esta misma salida
    box.innerHTML = `
      <label class="fld"><span>Fecha</span><input id="mFe" type="date" value="${f.fecha}"></label>
      <div class="fld"><span>Categoría</span><div class="chips" data-k="categoria">${CATEGORIAS.map((c) => `<button type="button" class="chip" data-v="${c}" aria-pressed="${f.categoria === c}">${c}</button>`).join('')}</div></div>
      <div class="fld"><span>Tipo</span><div class="chips wrap" data-k="tipo">${TIPOS[f.categoria].map((t) => `<button type="button" class="chip" data-v="${esc(t)}" aria-pressed="${f.tipo === t}">${esc(t)}</button>`).join('')}</div></div>
      ${f.categoria === 'Tarea' ? `<div class="fld"><span>Tipo 2</span><div class="chips wrap" data-k="tipo2">${TIPO2.map((t) => `<button type="button" class="chip" data-v="${t}" aria-pressed="${f.tipo2 === t}">${t}</button>`).join('')}</div></div>` : ''}
      ${stockMode ? `
        <label class="fld"><span>Producto</span><select id="mPr"><option value="">Elige un producto…</option>${prods.map((x) => { const disabled = x.q + own <= EPS && x.p.id !== f.producto; return `<option value="${x.p.id}" ${f.producto === x.p.id ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(x.p.nombre)} · ${x.q + own > EPS ? qty(x.q + own) : 'sin stock'}</option>`; }).join('')}</select></label>
        ${sel ? `<p class="hint">Disponible: <b>${qty(sel.q + own)}</b>${sel.avg != null ? ` · Precio medio actual: <b>${eur(sel.avg)}</b>` : ''}. Al guardar, el precio queda fijado en esta salida.</p>` : ''}`
      : `
        <label class="fld"><span>Descripción</span><input id="mDe" type="text" list="mDl" value="${esc(f.desc)}" placeholder="Opcional (si lo dejas vacío: «${esc(f.tipo)}»)" autocomplete="off"></label>
        <datalist id="mDl">${descs.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>`}
      <div class="fld"><span>Finca</span><div class="grid2" data-k="finca">${FINCAS.map((fi) => `<button type="button" class="opt" data-v="${fi.code}" aria-pressed="${f.finca === fi.code}"><b>${fi.code}</b>${fi.name}</button>`).join('')}</div></div>
      ${amountsHTML(f)}
      <div class="actions two">
        ${isNew ? '<button class="btn" id="mSave2">Guardar y otra</button>' : '<button class="btn danger" id="mDel">Borrar</button>'}
        <button class="btn primary" id="mSave">Guardar</button>
      </div>`;
    $('#mFe', box).onchange = (e) => { f.fecha = e.target.value; };
    const de = $('#mDe', box); if (de) de.oninput = (e) => { f.desc = e.target.value; };
    const pr = $('#mPr', box);
    if (pr) pr.onchange = (e) => {
      f.producto = e.target.value;
      const x = computeStock().get(f.producto);
      if (x && x.avg != null) { f.precio = fmtIn(x.avg); f.edited = 'precio'; const c = parseNum(f.cantidad); f.importe = isFinite(c) ? fmtIn(c * x.avg, 4) : ''; }
      draw();
    };
    box.querySelectorAll('[data-k]').forEach((grp) => {
      grp.onclick = (e) => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        const k = grp.dataset.k, v = b.dataset.v;
        if (k === 'categoria') { if (f.categoria !== v) { f.categoria = v; f.tipo = TIPOS[v][0]; f.tipo2 = ''; f.producto = ''; } }
        else if (k === 'tipo') {
          const was = isStockMode(f.categoria, f.tipo);
          f.tipo = v; f.producto = '';
          if (was || isStockMode(f.categoria, v)) { f.precio = ''; f.importe = ''; f.edited = 'precio'; }
        }
        else if (k === 'tipo2') f.tipo2 = f.tipo2 === v ? '' : v;
        else f[k] = v;
        draw();
      };
    });
    bindAmounts(box, f);
    $('#mSave', box).onclick = () => save(false);
    const s2 = $('#mSave2', box); if (s2) s2.onclick = () => save(true);
    if (!isNew) armDelete($('#mDel', box), () => { if (commit((c) => { c.movs = c.movs.filter((s) => s.id !== orig.id); })) { closeSheet(); toast('Registro borrado'); } });
  };

  const save = (again) => {
    if (!f.fecha) return toast('Indica la fecha', true);
    if (!f.finca) return toast('Elige la finca', true);
    const stockMode = isStockMode(f.categoria, f.tipo);
    if (stockMode && !f.producto) return toast('Elige el producto', true);
    const a = readAmounts(f);
    if (a.error) return toast(a.error, true);
    const prod = stockMode ? state.productos.find((p) => p.id === f.producto) : null;
    const base = {
      fecha: f.fecha, categoria: f.categoria, tipo: f.tipo, tipo2: f.categoria === 'Tarea' ? f.tipo2 : '', finca: f.finca,
      desc: prod ? prod.nombre : (f.desc.trim() || f.tipo), producto: prod ? prod.id : null,
      cantidad: a.cantidad, precio: a.precio, importe: a.importe,
    };
    const ok = commit((c) => {
      if (isNew) c.movs.push({ id: uid(), ts: Date.now(), campana: c.settings.campana, ...base });
      else Object.assign(c.movs.find((s) => s.id === orig.id), base);
    });
    if (!ok) return;
    ui.lastCat = f.categoria; ui.lastTipo = f.tipo;
    if (ui.tab === 'salidas' && ui.salMes !== 'todos' && monthOf(f.fecha) !== ui.salMes) { ui.salMes = monthOf(f.fecha); renderAll(); }
    if (again) {
      toast('Guardado · puedes añadir otra');
      f.cantidad = ''; f.importe = ''; f.finca = '';
      if (stockMode) { const x = computeStock().get(f.producto); f.precio = x && x.avg != null ? fmtIn(x.avg) : ''; }
      draw(); const q = $('#aQ', box); if (q) q.focus();
    } else { closeSheet(); toast(isNew ? 'Guardado' : 'Registro actualizado'); }
  };
  draw();
}

/* ---------- Exportación para el Excel de Gestión de fincas ---------- */
function exportRows(list) {
  return [...list].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ts - b.ts).map((s) => [
    fmtDate(s.fecha), s.desc.replace(/[\t\r\n]+/g, ' '), s.campana, s.categoria, s.tipo, s.tipo2 || '', fincaByCode(s.finca)?.name ?? s.finca,
    numEs(s.cantidad, 4), numEs(s.precio, 6), numEs(s.importe, 4),
  ]);
}
const toTSV = (rows) => rows.map((r) => r.join('\t')).join('\n');
const csvCell = (v) => /[;"\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
const toCSV = (rows) => '﻿' + [EXPORT_HEADER, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (_) {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* nada */ } ta.remove(); return ok;
  }
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function openExportSheet() {
  const meses = [...new Set([monthOf(todayISO()), ...state.movs.map((s) => monthOf(s.fecha))])].sort().reverse();
  let mes = ui.salMes === 'todos' ? meses[0] : ui.salMes;
  const body = openSheet('Exportar salidas', '<div id="xf"></div>');
  const box = $('#xf', body);
  const draw = () => {
    const list = state.movs.filter((s) => mes === 'todos' || monthOf(s.fecha) === mes);
    const tot = list.reduce((t, s) => t + (s.categoria === 'Ingreso' ? 0 : s.importe), 0);
    box.innerHTML = `
      <label class="fld"><span>Periodo</span><select id="xM">${meses.map((m) => `<option value="${m}" ${m === mes ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}<option value="todos" ${mes === 'todos' ? 'selected' : ''}>Todos los meses</option></select></label>
      <div class="box"><div><span>Filas</span><b>${list.length}</b></div><div><span>Gastos + tareas</span><b>${eur(tot)}</b></div></div>
      <p class="hint">Mismo orden de columnas que tu Excel de Gestión de fincas: Fecha, Descripción, Campaña, Categoria, Tipo, Tipo 2, Finca, Cantidad, Precio, Importe (sin Mes ni Año).</p>
      <div class="actions">
        <button class="btn primary" id="xC" ${list.length ? '' : 'disabled'}>Copiar para pegar en Sheets</button>
        <button class="btn" id="xD" ${list.length ? '' : 'disabled'}>Descargar CSV (con cabecera)</button>
      </div>`;
    $('#xM', box).onchange = (e) => { mes = e.target.value; draw(); };
    $('#xC', box).onclick = async () => { const ok = await copyText(toTSV(exportRows(list))); toast(ok ? `Copiadas ${list.length} filas sin cabecera. Pega en Sheets.` : 'No se pudo copiar; usa el CSV', !ok); };
    $('#xD', box).onclick = () => { download(`salidas-${mes === 'todos' ? 'todas' : mes}.csv`, toCSV(exportRows(list)), 'text/csv;charset=utf-8'); toast('CSV descargado'); };
  };
  draw();
}

/* ---------- Copia automática en Google Sheets ----------
   La app envía el estado completo al receptor (Apps Script). La hoja es un espejo de un solo sentido:
   sin conexión queda "pendiente" y se envía al volver la conexión. */
let sync = { url: '', clave: '', enabled: false, dirty: false, lastOk: null, lastError: '' };
let syncRev = 0, syncTimer = null, syncRetry = null, syncRunning = false;
const syncOn = () => !!(sync.enabled && sync.url && sync.clave);
async function loadSync() { try { const s = await dbGet('sync'); if (s) sync = { ...sync, ...s }; } catch (_) { /* nada */ } }
function saveSync() { dbSet('sync', sync).catch(() => {}); }

function markDirty() {
  if (!syncOn()) return;
  sync.dirty = true; syncRev++; saveSync(); renderSyncStatus();
  clearTimeout(syncTimer); syncTimer = setTimeout(() => runSync(), 2500);
}
async function callScript(accion, extra = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    // Sin cabeceras propias: así es una petición simple (text/plain) y Google no exige comprobación previa.
    const res = await fetch(sync.url, { method: 'POST', body: JSON.stringify({ accion, clave: sync.clave, ...extra }), signal: ctrl.signal });
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (_) { throw new Error('La dirección no responde como el receptor (revisa que esté publicado para «Cualquier persona»)'); }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Tiempo de espera agotado');
    if (e instanceof TypeError) throw new Error('Sin conexión con Google');
    throw e;
  } finally { clearTimeout(t); }
}
function syncPayload() {
  const m = computeStock();
  const byId = new Map(state.productos.map((p) => [p.id, p]));
  const salidas = [...state.movs].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ts - b.ts).map((s) => [s.fecha, s.desc, s.campana, s.categoria, s.tipo, s.tipo2 || '', fincaByCode(s.finca)?.name ?? s.finca, s.cantidad, round(s.precio, 6), s.importe]);
  const entradas = [...state.entradas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ts - b.ts).map((e) => { const p = byId.get(e.producto); return [e.fecha, p ? p.nombre : '(producto borrado)', p ? p.categoria : '', e.cantidad, e.cantidad ? round(e.importe / e.cantidad, 6) : 0, e.importe]; });
  const stock = [...m.values()].sort((a, b) => CAT_STOCK.indexOf(a.p.categoria) - CAT_STOCK.indexOf(b.p.categoria) || a.p.nombre.localeCompare(b.p.nombre, 'es'))
    .map((x) => [x.p.nombre, x.p.categoria, x.q, x.avg != null ? round(x.avg, 4) : '', x.q > EPS ? round(x.v, 2) : 0]);
  return { salidas, entradas, stock, total: round(totalValor(m), 2), estado: JSON.stringify(state), version: APP_VERSION };
}
async function runSync() {
  if (!syncOn() || syncRunning) return;
  if (!navigator.onLine) { renderSyncStatus(); return; }
  syncRunning = true; const rev = syncRev; renderSyncStatus();
  try {
    const r = await callScript('sincronizar', syncPayload());
    if (!r.ok) throw new Error(r.error === 'clave' ? 'La clave no coincide con la del script' : (r.error || 'Error del receptor'));
    sync.lastOk = new Date().toISOString(); sync.lastError = '';
    if (syncRev === rev) sync.dirty = false;
  } catch (e) {
    sync.lastError = e.message || String(e); sync.dirty = true;
    clearTimeout(syncRetry); syncRetry = setTimeout(() => runSync(), 60000);
  } finally {
    syncRunning = false; saveSync(); renderSyncStatus();
    if (sync.dirty && !sync.lastError) { clearTimeout(syncTimer); syncTimer = setTimeout(() => runSync(), 800); }
  }
}
function ago(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleDateString('es-ES');
}
function syncStatusText() {
  if (!syncOn()) return '';
  if (syncRunning) return '☁ Enviando a Google Sheets…';
  if (sync.lastError) return '☁ No se pudo enviar: ' + sync.lastError;
  if (sync.dirty) return navigator.onLine ? '☁ Pendiente de enviar…' : '☁ Pendiente de enviar (sin conexión)';
  return '☁ Hoja al día · ' + ago(sync.lastOk);
}
function renderSyncStatus() {
  const el = $('#syncStatus'); if (el) { el.textContent = syncStatusText(); el.hidden = !syncOn(); }
  const box = $('#syncLine'); if (box) box.textContent = syncStatusText();
}
function validState(s) { return s && Array.isArray(s.productos) && Array.isArray(s.entradas) && Array.isArray(s.movs) && s.settings; }

function drawSync(box) {
  if (syncOn()) {
    box.innerHTML = `
      <p class="small" id="syncLine">${esc(syncStatusText())}</p>
      <p class="small">Cada cambio se envía solo a tu hoja de Google (pestañas Salidas, Entradas y Stock). Sin conexión se queda pendiente y se envía al volver.</p>
      <div class="actions">
        <button class="btn primary" id="syNow">Sincronizar ahora</button>
        <button class="btn" id="syRes">Restaurar desde la hoja</button>
        <button class="btn danger" id="syOff">Desactivar</button>
      </div>`;
    $('#syNow', box).onclick = () => { if (!navigator.onLine) return toast('Sin conexión: se enviará al volver', true); sync.lastError = ''; markDirty(); clearTimeout(syncTimer); runSync(); };
    $('#syRes', box).onclick = async () => {
      try {
        const est = await callScript('estado');
        if (!est.ok || !est.estado) throw new Error(est.error === 'sin copia' ? 'La hoja todavía no tiene copia' : (est.error || 'No se pudo leer la copia'));
        const s = JSON.parse(est.estado);
        if (!validState(s)) throw new Error('La copia de la hoja no es válida');
        if (!confirm(`Se reemplazarán los datos de este móvil por los de la hoja (${s.movs.length} registros, ${s.entradas.length} entradas, copia ${ago(est.fecha)}). ¿Continuar?`)) return;
        state = s; await persist(); closeSheet(); renderAll(); toast('Restaurado desde la hoja');
      } catch (e) { toast(e.message || 'No se pudo restaurar', true); }
    };
    $('#syOff', box).onclick = () => { sync.enabled = false; sync.dirty = false; sync.lastError = ''; saveSync(); renderSyncStatus(); drawSync(box); toast('Copia automática desactivada'); };
  } else {
    box.innerHTML = `
      <p class="small">Opcional. Envía automáticamente todo a una hoja de Google Sheets de tu Drive (copia de seguridad y datos listos para copiar). Necesita configurar una vez el script de Google que se explica en el README.</p>
      <label class="fld"><span>Dirección del script (termina en /exec)</span><input id="syU" type="url" value="${esc(sync.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <label class="fld"><span>Clave</span><input id="syK" type="password" value="${esc(sync.clave)}" autocomplete="off"></label>
      <div class="actions"><button class="btn primary" id="syOn">Probar y activar</button></div>`;
    $('#syOn', box).onclick = () => activateSync($('#syU', box).value.trim(), $('#syK', box).value.trim(), box);
  }
}
async function activateSync(url, clave, box) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/\s]+\/exec\/?$/.test(url)) return toast('La dirección debe ser la de la aplicación web del script y terminar en /exec', true);
  if (!clave) return toast('Escribe la clave', true);
  const prev = { ...sync };
  sync.url = url; sync.clave = clave;
  const finish = () => { sync.enabled = true; sync.dirty = true; sync.lastError = ''; syncRev++; saveSync(); renderSyncStatus(); drawSync(box); runSync(); toast('Conectado con Google Sheets'); };
  try {
    const ping = await callScript('ping');
    if (!ping.ok) throw new Error(ping.error === 'clave' ? 'La clave no coincide con la del script' : (ping.error || 'El receptor no responde'));
    const est = await callScript('estado');
    if (est.ok && est.estado) {
      // La hoja ya tiene una copia (por ejemplo, otro móvil): hay que decidir qué manda.
      let info = null; try { info = JSON.parse(est.estado); } catch (_) { /* nada */ }
      const n = info && validState(info) ? `${info.movs.length} registros y ${info.entradas.length} entradas` : 'datos';
      box.innerHTML = `
        <p><b>La hoja ya contiene una copia</b> (${n}, ${ago(est.fecha)}).</p>
        <p class="small">Si este móvil es nuevo, usa la copia de la hoja. Si lo de este móvil es lo correcto, sobrescribe la hoja.</p>
        <div class="actions">
          <button class="btn primary" id="syUse" ${info && validState(info) ? '' : 'disabled'}>Usar la copia de la hoja en este móvil</button>
          <button class="btn" id="syOver">Sobrescribir la hoja con los datos de este móvil</button>
          <button class="btn" id="syCan">Cancelar</button>
        </div>`;
      $('#syUse', box).onclick = async () => { state = info; await persist(); renderAll(); finish(); };
      $('#syOver', box).onclick = finish;
      $('#syCan', box).onclick = () => { sync = prev; drawSync(box); };
      return;
    }
    finish();
  } catch (e) { sync = prev; toast(e.message || 'No se pudo conectar', true); }
}

/* ---------- Ajustes y copia de seguridad ---------- */
function backupJSON() { return JSON.stringify({ app: 'stock-fincas', version: APP_VERSION, exportedAt: new Date().toISOString(), state }, null, 1); }
async function shareOrDownloadBackup() {
  const name = `stock-fincas-copia-${todayISO()}.json`;
  const text = backupJSON();
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Copia Stock Fincas' }); }
    else download(name, text, 'application/json');
  } catch (e) { if (e && e.name === 'AbortError') return; download(name, text, 'application/json'); }
  state.settings.lastBackup = new Date().toISOString(); persist(); toast('Copia generada');
}
function openSettings() {
  const body = openSheet('Ajustes', `
    <label class="fld"><span>Campaña que se anota en los registros nuevos</span><input id="sC" type="text" inputmode="numeric" value="${esc(state.settings.campana)}"></label>
    <div class="actions"><button class="btn" id="sSaveC">Guardar campaña</button></div>
    <div class="sep"></div>
    <h3>Copia automática en Google Sheets</h3>
    <div id="syncBox"></div>
    <div class="sep"></div>
    <h3>Copia de seguridad en fichero</h3>
    <p class="small">Los datos viven en este móvil. Puedes guardar un fichero con todo (por ejemplo en Drive o WhatsApp).${state.settings.lastBackup ? ` Última copia: ${new Date(state.settings.lastBackup).toLocaleString('es-ES')}.` : ' Aún no has hecho ninguna.'}</p>
    <div class="actions">
      <button class="btn primary" id="sBk">Guardar copia / compartir</button>
      <label class="btn" style="display:grid;place-items:center;cursor:pointer">Restaurar desde fichero<input id="sRs" type="file" accept="application/json,.json" hidden></label>
    </div>
    <div class="sep"></div>
    <p class="small">Stock Fincas v${APP_VERSION} · stock de partida cargado desde Control_Stock_Fincas.xlsx (hasta 30/09/2026).</p>`);
  drawSync($('#syncBox', body));
  $('#sSaveC', body).onclick = () => {
    const n = parseInt($('#sC', body).value, 10);
    if (!(n >= 2000 && n <= 2100)) return toast('Escribe un año válido, por ejemplo 2026', true);
    state.settings.campana = n; persist(); toast('Campaña guardada: ' + n);
  };
  $('#sBk', body).onclick = shareOrDownloadBackup;
  $('#sRs', body).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      const s = j && j.state;
      if (!validState(s)) throw new Error('El fichero no es una copia de Stock Fincas');
      if (!confirm(`Se reemplazarán todos los datos actuales por los de la copia (${s.movs.length} registros, ${s.entradas.length} entradas). ¿Continuar?`)) return;
      state = s; await persist(); closeSheet(); renderAll(); toast('Copia restaurada');
    } catch (err) { toast(err.message || 'No se pudo leer la copia', true); }
    e.target.value = '';
  };
}

/* ---------- Render general ---------- */
function renderAll() {
  const m = computeStock();
  $('#totalValor').textContent = eur(totalValor(m));
  document.querySelectorAll('.tab').forEach((b) => { if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  renderSyncStatus();
  $('#fabLabel').textContent = ui.tab === 'stock' ? 'Producto nuevo' : ui.tab === 'entradas' ? 'Nueva entrada' : 'Nueva salida';
  if (ui.tab === 'stock') renderStock(); else if (ui.tab === 'entradas') renderEntradas(); else renderSalidas();
}

async function init() {
  document.querySelectorAll('.tab').forEach((b) => b.onclick = () => { ui.tab = b.dataset.tab; window.scrollTo(0, 0); renderAll(); });
  $('#btnSettings').onclick = openSettings;
  $('#fab').onclick = () => { if (ui.tab === 'stock') openProductSheet(null); else if (ui.tab === 'entradas') openEntradaForm(null); else openMovForm(null); };
  await loadSync();
  $('#syncStatus').onclick = openSettings;
  window.addEventListener('online', () => { if (sync.dirty) runSync(); else renderSyncStatus(); });
  window.addEventListener('offline', renderSyncStatus);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sync.dirty) runSync(); });
  setInterval(renderSyncStatus, 60000);
  try {
    let s = await dbGet('state');
    if (!s) { s = seedState(); await dbSet('state', s); }
    state = s;
  } catch (e) {
    state = seedState();
    toast('Este navegador no permite guardar datos: lo que anotes se perderá al cerrar', true);
  }
  renderAll();
  if (syncOn() && sync.dirty) setTimeout(runSync, 1500);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
