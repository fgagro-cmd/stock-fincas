'use strict';
/* Gestión fincas (antes Stock Fincas) — stock, entradas y salidas de mis fincas.
   Todo se guarda en el propio móvil (IndexedDB) y funciona sin conexión.
   El código no lleva datos: en un móvil nuevo se restaura desde la hoja de Google o un fichero. */

const APP_VERSION = '2.1.1';
const APP_NAME = 'Gestión fincas';

/* ---------- Listas fijas (todo con tilde: mismo lenguaje en el histórico, la app y Cuentas fincas) ---------- */
const CAT_STOCK = ['Fertilizantes', 'Fitosanitarios', 'Herbicidas', 'Bioestimulantes']; // los únicos que mueven stock
const CATEGORIAS = ['Ingreso', 'Gasto', 'Tarea'];
const TIPOS = {
  Ingreso: ['Cosecha', 'Subvención', 'Otros ingresos'],
  Gasto: ['Fertilizantes', 'Fitosanitarios', 'Herbicidas', 'Bioestimulantes', 'Combustible', 'Material de riego', 'Agua de riego', 'Enmienda orgánica', 'Arrendamiento', 'Otros'],
  Tarea: ['Fumigación', 'Labrar', 'Desbrozar', 'Poda', 'Herbicida', 'Mantenimiento', 'Mejoras', 'Estiércol', 'Recolección', 'Otras tareas'],
};
const TIPO2 = ['Con maquinaria', 'Sin maquinaria', 'Contratado'];
// Fincas de partida (los códigos con los que se guardaban los registros). Desde la v2 la lista vive en
// los datos (state.fincas) y se enlaza con el maestro de fincas; esta lista solo sirve para migrar.
const FINCAS_BASE = [
  { code: 'LN', name: 'Limoneros Niño' },
  { code: 'LH', name: 'Limoneros Herrero' },
  { code: 'PH', name: 'Pomelos Herrero' },
  { code: 'LG', name: 'Limoneros Gines' },
  { code: 'FC', name: 'Finca Cortijo' },
  { code: 'NP', name: 'Naranjos Prao Negro' },
];
const EXPORT_HEADER = ['Fecha', 'Descripción', 'Campaña', 'Categoria', 'Tipo', 'Tipo 2', 'Finca', 'Cantidad', 'Precio', 'Importe'];
const EPS = 0.0005;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, min = 2, max = 2) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const eur = (n) => nf(n) + ' €';
const qty = (n) => nf(n, 0, 3);
const round = (n, d) => { const k = 10 ** d; return Math.round((n + Number.EPSILON * Math.sign(n)) * k) / k; };
const fincaByCode = (c) => (state.fincas || FINCAS_BASE).find((f) => f.code === c);
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
function emptyState() {
  return { v: 3, settings: { campana: new Date().getFullYear(), lastBackup: null }, productos: [], entradas: [], movs: [], fincas: structuredClone(FINCAS_BASE), mxPend: [] };
}
/* v1 → v2: lista de fincas en los datos, enlace con maestros y cola de altas. No cambia ningún registro.
   v2 → v3: tipos con tilde (Fumigacion → Fumigación, etc.). Solo cambia el texto del tipo. */
const TIPO_TILDE = { Fumigacion: 'Fumigación', Subvencion: 'Subvención', Estiercol: 'Estiércol', 'Enmienda organica': 'Enmienda orgánica' };
function migrar(s) {
  if (!Array.isArray(s.fincas)) s.fincas = structuredClone(FINCAS_BASE);
  if (!Array.isArray(s.mxPend)) s.mxPend = [];
  if (!s.v || s.v < 3) {
    for (const m of s.movs || []) {
      const nuevo = TIPO_TILDE[m.tipo];
      if (nuevo) { if (m.desc === m.tipo) m.desc = nuevo; m.tipo = nuevo; }
    }
  }
  s.v = 3;
  return s;
}
const appVacia = () => !state.productos.length && !state.movs.length && !state.entradas.length;

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
  const linked = !isNew && x.p.mid;
  const pend = !isNew && state.mxPend.some((a) => a.ref === id);
  const np = npInit();
  const body = openSheet(isNew ? 'Producto nuevo' : x.p.nombre, `
    ${isNew ? '' : `<div class="box"><div><span>Stock</span><b>${qty(x.q)}</b></div><div><span>Precio medio</span><b>${x.avg != null ? eur(x.avg) : '—'}</b></div><div><span>Valor</span><b>${x.q > EPS ? eur(x.v) : '—'}</b></div>${linked ? `<div><span>Ficha del maestro</span><b>${esc(x.p.mid)} · ${esc(x.p.categoria)}</b></div>` : ''}</div>`}
    ${isNew ? '<div id="pNp"></div>' : linked ? '<p class="hint">El nombre y la categoría vienen del maestro de productos de Drive: cámbialos allí y se actualizan solos.</p>' : `
    <label class="fld"><span>Nombre</span><input id="pName" type="text" value="${esc(x.p.nombre)}" autocomplete="off"></label>
    <div class="fld"><span>Categoría</span><div class="chips wrap" id="pCat">${CAT_STOCK.map((c) => `<button type="button" class="chip" data-c="${c}" aria-pressed="${x.p.categoria === c}" ${used ? 'disabled' : ''}>${c}</button>`).join('')}</div></div>
    ${used ? '<p class="hint">La categoría no se puede cambiar porque el producto ya tiene movimientos.</p>' : ''}
    ${pend ? '<p class="hint">Alta pedida en el maestro: se enviará en cuanto haya conexión.</p>' : ''}`}
    ${linked ? '' : `<div class="actions ${isNew ? '' : 'two'}">
      ${isNew ? '' : `<button class="btn danger" id="pDel" ${unusedAndEmpty ? '' : 'disabled'}>Borrar</button>`}
      <button class="btn primary" id="pSave">Guardar</button>
    </div>`}
    ${!isNew && !linked && !unusedAndEmpty ? '<p class="hint" style="margin-top:10px">Solo se pueden borrar productos sin stock de partida ni movimientos.</p>' : ''}`);
  if (linked) return;
  if (isNew) { const b = $('#pNp', body); const re = () => { b.innerHTML = npHTML(np); npBind(b, np, re); }; re(); }
  let cat = isNew ? CAT_STOCK[0] : x.p.categoria;
  const pc = $('#pCat', body);
  if (pc) pc.onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b || b.disabled) return; cat = b.dataset.c; body.querySelectorAll('#pCat .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.c === cat)); };
  $('#pSave', body).onclick = () => {
    if (isNew) {
      let r; try { r = npBuild(np); } catch (e) { return toast(e.message, true); }
      if (commit((c) => { c.productos.push(r.prod); if (r.alta) pedirAlta(c, 'producto', r.prod.id, r.alta); })) { closeSheet(); toast('Producto creado' + (r.aviso ? ' · ' + r.aviso : '')); if (r.alta) refreshMx({}); }
      return;
    }
    const nombre = $('#pName', body).value.trim();
    if (!nombre) return toast('Escribe el nombre del producto', true);
    if (state.productos.some((p) => p.id !== id && MX.norm(p.nombre) === MX.norm(nombre))) return toast('Ya existe un producto con ese nombre', true);
    const ok = commit((c) => {
      const p = c.productos.find((p) => p.id === id);
      p.nombre = nombre; p.categoria = cat;
      c.movs.forEach((s) => { if (s.producto === id) s.desc = nombre; });
      c.mxPend.forEach((a) => { if (a.ref === id) a.datos = { nombre, categoria: cat }; });
    });
    if (ok) { closeSheet(); toast('Producto actualizado'); }
  };
  if (!isNew && unusedAndEmpty) armDelete($('#pDel', body), () => { if (commit((c) => { c.productos = c.productos.filter((p) => p.id !== id); c.mxPend = c.mxPend.filter((a) => a.ref !== id); })) { closeSheet(); toast('Producto borrado'); } });
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
function readAmounts(f, { allowNegativeQty = false, msgNeg = 'Indica la cantidad (negativa para corregir inventario)' } = {}) {
  const cantidad = parseNum(f.cantidad);
  if (!isFinite(cantidad) || cantidad === 0 || (!allowNegativeQty && cantidad < 0)) return { error: allowNegativeQty ? msgNeg : 'Indica una cantidad mayor que 0' };
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
        <div class="main"><div class="name">${esc(byId.get(e.producto)?.nombre ?? '(producto borrado)')}</div><div class="sub">${e.vk ? '<span class="pill in">Ventas</span>' : ''}${fmtDate(e.fecha)} · ${qty(e.cantidad)} × ${eur(e.cantidad ? e.importe / e.cantidad : 0)}${e.cantidad < 0 ? ' · corrección' : ''}</div></div>
        <div class="side"><div class="big ${e.importe < 0 ? 'neg' : ''}">${eur(e.importe)}</div></div>
      </button></li>`).join('')}</ul>` : '<div class="empty">No hay entradas en este mes.<br>Pulsa «Nueva entrada» para registrar una compra.</div>'}`;
  $('#entMes').onchange = (e) => { ui.entMes = e.target.value; renderEntradas(); };
  const ul = $('#view .list'); if (ul) ul.onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) openEntradaForm(state.entradas.find((x) => x.id === b.dataset.id)); };
}

function openEntradaForm(orig) {
  if (orig && orig.vk) {
    const p = state.productos.find((x) => x.id === orig.producto);
    openSheet('Entrada desde Ventas', `<div class="box"><div><span>Fecha</span><b>${fmtDate(orig.fecha)}</b></div><div><span>Producto</span><b>${esc(p ? p.nombre : '?')}</b></div><div><span>Cantidad</span><b>${qty(orig.cantidad)}</b></div><div><span>Precio</span><b>${eur(orig.cantidad ? orig.importe / orig.cantidad : 0)}</b></div><div><span>Importe</span><b>${eur(orig.importe)}</b></div></div>
      <p class="hint">Viene de una venta a tus fincas en la app Ventas. Para cambiarla o quitarla, cambia la venta en Ventas y se actualiza sola aquí.</p>`);
    return;
  }
  const isNew = !orig;
  const f = orig
    ? { fecha: orig.fecha, producto: orig.producto, nuevoNombre: '', nuevaCat: CAT_STOCK[0], cantidad: fmtIn(orig.cantidad), precio: fmtIn(orig.cantidad ? orig.importe / orig.cantidad : 0), importe: fmtIn(orig.importe, 4), edited: 'precio' }
    : { fecha: todayISO(), producto: '', nuevoNombre: '', nuevaCat: CAT_STOCK[0], cantidad: '', precio: '', importe: '', edited: 'precio' };
  const np = npInit();
  const body = openSheet(isNew ? 'Nueva entrada' : 'Editar entrada', '<div id="ef"></div>');
  const box = $('#ef', body);
  const draw = () => {
    const m = computeStock();
    const sel = m.get(f.producto);
    const groups = CAT_STOCK.map((c) => `<optgroup label="${c}">${[...m.values()].filter((x) => x.p.categoria === c).sort((a, b) => a.p.nombre.localeCompare(b.p.nombre, 'es')).map((x) => `<option value="${x.p.id}" ${f.producto === x.p.id ? 'selected' : ''}>${esc(x.p.nombre)}${x.q > EPS ? ' · ' + qty(x.q) : ''}</option>`).join('')}</optgroup>`).join('');
    box.innerHTML = `
      <label class="fld"><span>Fecha</span><input id="eF" type="date" value="${f.fecha}"></label>
      <label class="fld"><span>Producto</span><select id="eP"><option value="">Elige un producto…</option><option value="__new" ${f.producto === '__new' ? 'selected' : ''}>➕ Producto nuevo…</option>${groups}</select></label>
      ${f.producto === '__new' ? `<div id="eNp">${npHTML(np)}</div>` : ''}
      ${sel ? `<div class="box"><div><span>Stock ahora</span><b>${qty(sel.q)}</b></div><div><span>Precio medio ahora</span><b>${sel.avg != null ? eur(sel.avg) : '—'}</b></div></div>` : ''}
      ${amountsHTML(f, 'Precio unit. €')}
      <p class="hint">Para corregir el inventario, usa una cantidad negativa (por ejemplo −2).</p>
      <div class="actions ${isNew ? '' : 'two'}">
        ${isNew ? '' : '<button class="btn danger" id="eDel">Borrar</button>'}
        <button class="btn primary" id="eSave">Guardar</button>
      </div>`;
    $('#eF', box).onchange = (e) => { f.fecha = e.target.value; };
    $('#eP', box).onchange = (e) => { f.producto = e.target.value; draw(); };
    const enp = $('#eNp', box); if (enp) { const re = () => { enp.innerHTML = npHTML(np); npBind(enp, np, re); }; npBind(enp, np, re); }
    bindAmounts(box, f);
    $('#eSave', box).onclick = save;
    if (!isNew) armDelete($('#eDel', box), () => { if (commit((c) => { c.entradas = c.entradas.filter((e) => e.id !== orig.id); })) { closeSheet(); toast('Entrada borrada'); } });
  };
  const save = () => {
    if (!f.fecha) return toast('Indica la fecha', true);
    if (!f.producto) return toast('Elige un producto', true);
    let nuevo = null;
    if (f.producto === '__new') { try { nuevo = npBuild(np); } catch (e) { return toast(e.message, true); } }
    const a = readAmounts(f, { allowNegativeQty: true });
    if (a.error) return toast(a.error, true);
    const ok = commit((c) => {
      let pid = f.producto;
      if (nuevo) { pid = nuevo.prod.id; c.productos.push(nuevo.prod); if (nuevo.alta) pedirAlta(c, 'producto', pid, nuevo.alta); }
      if (isNew) c.entradas.push({ id: uid(), ts: Date.now(), fecha: f.fecha, producto: pid, cantidad: a.cantidad, importe: a.importe });
      else { const e = c.entradas.find((x) => x.id === orig.id); Object.assign(e, { fecha: f.fecha, producto: pid, cantidad: a.cantidad, importe: a.importe }); }
    });
    if (ok) { closeSheet(); toast((isNew ? 'Entrada guardada' : 'Entrada actualizada') + (nuevo && nuevo.aviso ? ' · ' + nuevo.aviso : '')); if (nuevo && nuevo.alta) refreshMx({}); }
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
      <div class="main"><div class="name">${esc(s.desc)}</div><div class="sub"><span class="pill ${pill}">${s.categoria}</span>${esc(s.tipo)}${s.tipo2 ? ' · ' + esc(s.tipo2) : ''} · ${esc(s.finca)}${s.hist ? ' · histórico' : ''}</div></div>
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
  const sinStock = !!(orig && orig.hist && !orig.producto); // línea del histórico del Excel: no mueve stock
  const body = openSheet(isNew ? 'Nueva salida' : 'Editar registro', '<div id="mf"></div>');
  const box = $('#mf', body);
  const descs = [...new Set(state.movs.filter((s) => !s.producto).map((s) => s.desc))].sort((a, b) => a.localeCompare(b, 'es')).slice(0, 80);

  const draw = () => {
    const stockMode = isStockMode(f.categoria, f.tipo) && !sinStock;
    const m = computeStock();
    const prods = stockMode ? [...m.values()].filter((x) => x.p.categoria === f.tipo).sort((a, b) => a.p.nombre.localeCompare(b.p.nombre, 'es')) : [];
    const sel = stockMode && f.producto ? m.get(f.producto) : null;
    const own = !isNew && orig.producto === f.producto ? orig.cantidad : 0; // lo que ya descuenta esta misma salida
    box.innerHTML = `
      ${sinStock ? '<p class="hint" style="margin-top:0">Línea del histórico del Excel: no mueve stock.</p>' : ''}
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
      <div class="fld"><span>Finca</span><div class="grid2" data-k="finca">${state.fincas.filter((fi) => fi.activa !== false || fi.code === f.finca).map((fi) => `<button type="button" class="opt" data-v="${fi.code}" aria-pressed="${f.finca === fi.code}"><b>${fi.code}</b>${fi.name}</button>`).join('')}</div></div>
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
    const stockMode = isStockMode(f.categoria, f.tipo) && !sinStock;
    if (stockMode && !f.producto) return toast('Elige el producto', true);
    // Las líneas que no mueven stock admiten cantidad negativa (descuentos, bonificaciones, ajustes)
    const a = readAmounts(f, { allowNegativeQty: !stockMode, msgNeg: 'Indica la cantidad (negativa para un descuento o ajuste)' });
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
      <p class="hint">Mismo orden de columnas que tu Excel de Gestión de fincas: Fecha, Descripción, Campaña, Categoria, Tipo, Tipo 2, Finca, Cantidad, Precio, Importe (sin Mes ni Año). La tabla completa, con Mes y Año, está siempre en la pestaña «Tabla principal» de tu hoja de Google.</p>
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
  const tabla = [...state.movs].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.ts - a.ts).map((s) => [s.fecha, s.desc, s.campana, s.categoria, s.tipo, s.tipo2 || '', fincaByCode(s.finca)?.name ?? s.finca, s.cantidad, round(s.precio, 6), s.importe, MESES[Number(s.fecha.slice(5, 7)) - 1], Number(s.fecha.slice(0, 4))]);
  return { tabla, salidas, entradas, stock, total: round(totalValor(m), 2), estado: JSON.stringify(state), version: APP_VERSION };
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
        state = migrar(s); await persist(); closeSheet(); renderAll(); toast('Restaurado desde la hoja'); if (mxOn()) refreshMx({});
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
      $('#syUse', box).onclick = async () => { state = migrar(info); await persist(); renderAll(); finish(); };
      $('#syOver', box).onclick = finish;
      $('#syCan', box).onclick = () => { sync = prev; drawSync(box); };
      return;
    }
    finish();
  } catch (e) { sync = prev; toast(e.message || 'No se pudo conectar', true); }
}

/* ---------- Llamada a un Apps Script (maestros, Ventas) ---------- */
async function postScript(url, clave, accion, extra = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ accion, clave, ...extra }), signal: ctrl.signal });
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (_) { throw new Error('La dirección no responde como el script (revisa que esté publicado para «Cualquier usuario»)'); }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Tiempo de espera agotado');
    if (e instanceof TypeError) throw new Error('Sin conexión con Google');
    throw e;
  } finally { clearTimeout(t); }
}
const URL_SCRIPT = /^https:\/\/script\.google\.com\/macros\/s\/[^/\s]+\/exec\/?$/;
const nuevoId = (pre) => pre + uid().slice(0, 8);

/* ---------- Maestros compartidos (fincas y productos) ----------
   Se leen del servicio privado de maestros (Drive › Apps › Maestros) y se guardan en el móvil.
   Esta app solo lee y pide altas; nunca cambia ni borra nada de los maestros. */
let mx = { url: '', clave: '', data: null, lastFetch: null, lastError: '', avisar: false };
let IX = null, mxRunning = false;
const mxOn = () => !!(mx.url && mx.clave);
const callMx = (accion, extra = {}) => postScript(mx.url, mx.clave, accion, extra);
const mxErr = (r, def) => (r.error === 'clave' ? 'La clave de los maestros no coincide con la del script' : (r.error || def));
async function loadMx() { try { const s = await dbGet('mx'); if (s) mx = { ...mx, ...s }; } catch (_) { /* nada */ } IX = mx.data ? MX.indexar(mx.data) : null; }
function saveMx() { dbSet('mx', mx).catch(() => {}); }
const esPropiaMx = (f) => f.propia === true;

function planStock(st, ix) {
  const plan = { prod: [], unirProd: [], sinProd: [], cats: [], fin: [], nuevasFin: [], sinFin: [], retirarFin: [] };
  const usos = (pid) => st.entradas.filter((e) => e.producto === pid).length + st.movs.filter((m) => m.producto === pid).length;
  const porMid = new Map();
  for (const p of st.productos) {
    let m = null;
    if (p.mid) m = ix.prod.get(p.mid) || null; else { const r = MX.buscarProducto(ix, p.nombre); m = r ? r.p : null; }
    if (!m) { if (!p.mid) plan.sinProd.push(p.id); continue; }
    plan.prod.push({ id: p.id, mid: m.id });
    if (CAT_STOCK.includes(m.categoria) && m.categoria !== p.categoria) plan.cats.push({ id: p.id, nombre: m.nombre, de: p.categoria, a: m.categoria });
    if (!porMid.has(m.id)) porMid.set(m.id, []);
    porMid.get(m.id).push(p);
  }
  for (const [mid, ps] of porMid) {
    if (ps.length < 2) continue;
    const orden = [...ps].sort((a, b) => usos(b.id) - usos(a.id));
    plan.unirProd.push({ mid, queda: orden[0].id, quita: orden.slice(1).map((p) => ({ id: p.id, nombre: p.nombre, n: usos(p.id) })) });
  }
  const enlazadas = new Set();
  for (const f of st.fincas) {
    const m = f.mid ? ix.fin.get(f.mid) : MX.buscarFinca(ix, f.name, esPropiaMx);
    // Enlazada a una ficha que ya no existe o ya no es propia (p. ej. una duplicada): se retira
    if (f.mid && (!m || !esPropiaMx(m))) { plan.retirarFin.push(f.code); continue; }
    if (!m) { if (!f.mid) plan.sinFin.push(f.code); continue; }
    plan.fin.push({ code: f.code, mid: m.id }); enlazadas.add(m.id);
  }
  for (const m of ix.fin.values()) if (esPropiaMx(m) && !enlazadas.has(m.id)) plan.nuevasFin.push(m.id);
  return plan;
}
function codigoFinca(nombre, usados) {
  const pal = MX.norm(nombre).split(' ').filter((w) => w && !['finca', 'de', 'del', 'la', 'el', 'los', 'las'].includes(w));
  let c = (pal.map((w) => w[0]).join('').slice(0, 2) || 'F').toUpperCase();
  if (c.length < 2) c = (pal[0] || 'fi').slice(0, 2).toUpperCase();
  let k = c, n = 2; while (usados.has(k)) k = c + n++;
  return k;
}
function aplicarStock(c, plan, ix, { unir = false, nuevasFin = true } = {}) {
  const r = { prod: 0, ren: 0, cats: 0, unidos: 0, fin: 0, nuevasFin: 0 };
  const byId = new Map(c.productos.map((p) => [p.id, p]));
  for (const e of plan.prod) {
    const p = byId.get(e.id), m = ix.prod.get(e.mid); if (!p || !m) continue;
    if (p.mid !== m.id) { p.mid = m.id; r.prod++; }
    if (p.nombre !== m.nombre) { p.nombre = m.nombre; r.ren++; c.movs.forEach((s) => { if (s.producto === p.id) s.desc = m.nombre; }); }
    if (CAT_STOCK.includes(m.categoria) && p.categoria !== m.categoria) {
      p.categoria = m.categoria; r.cats++;
      c.movs.forEach((s) => { if (s.producto === p.id && s.categoria === 'Gasto') s.tipo = m.categoria; });
    }
  }
  if (unir) for (const u of plan.unirProd) {
    const queda = c.productos.find((p) => p.id === u.queda); if (!queda) continue;
    for (const q of u.quita) {
      const x = c.productos.find((p) => p.id === q.id); if (!x) continue;
      queda.q0 = round(queda.q0 + x.q0, 6); queda.v0 = round(queda.v0 + x.v0, 6);
      c.entradas.forEach((e) => { if (e.producto === x.id) e.producto = queda.id; });
      c.movs.forEach((s) => { if (s.producto === x.id) { s.producto = queda.id; s.desc = queda.nombre; s.tipo = s.categoria === 'Gasto' ? queda.categoria : s.tipo; } });
      c.productos = c.productos.filter((p) => p.id !== x.id); r.unidos++;
    }
  }
  for (const e of plan.fin) {
    const f = c.fincas.find((x) => x.code === e.code), m = ix.fin.get(e.mid); if (!f || !m) continue;
    if (f.mid !== m.id) { f.mid = m.id; r.fin++; }
    if (f.name !== m.nombre) { f.name = m.nombre; r.ren++; }
  }
  // Fincas retiradas del maestro: sin registros se quitan; con registros se ocultan (los registros no se tocan)
  for (const code of plan.retirarFin) {
    if (c.movs.some((s) => s.finca === code)) { const f = c.fincas.find((x) => x.code === code); if (f && f.activa !== false) { f.activa = false; r.fin++; } }
    else { c.fincas = c.fincas.filter((x) => x.code !== code); r.fin++; }
  }
  if (nuevasFin) for (const mid of plan.nuevasFin) {
    if (c.fincas.some((f) => f.mid === mid)) continue;
    const m = ix.fin.get(mid);
    c.fincas.push({ code: codigoFinca(m.nombre, new Set(c.fincas.map((f) => f.code))), name: m.nombre, mid });
    r.nuevasFin++;
  }
  return r;
}

function pedirAlta(c, tipo, ref, datos) { if (mxOn()) c.mxPend.push({ k: uid(), tipo, ref, datos }); }
async function procesarAltas() {
  for (const a of [...state.mxPend]) {
    const r = await callMx('alta', { tipo: a.tipo, datos: a.datos, app: APP_NAME });
    if (!r.ok) throw new Error(mxErr(r, 'No se pudo dar de alta en el maestro'));
    commit((c) => {
      c.mxPend = c.mxPend.filter((x) => x.k !== a.k);
      const p = c.productos.find((x) => x.id === a.ref);
      if (p && !p.mid) p.mid = r.id;
    });
  }
}
async function refreshMx({ auto = false, manual = false } = {}) {
  if (!mxOn() || mxRunning) return;
  if (!navigator.onLine) { if (manual) toast('Sin conexión: los maestros se actualizarán al volver', true); return; }
  if (auto && !state.mxPend.length && mx.lastFetch && Date.now() - new Date(mx.lastFetch).getTime() < 30 * 60000) return;
  mxRunning = true; renderMxStatus();
  try {
    await procesarAltas();
    const r = await callMx('leer');
    if (!r.ok) throw new Error(mxErr(r, 'No se pudieron leer los maestros'));
    mx.data = { clientes: r.clientes || [], fincas: r.fincas || [], productos: r.productos || [] };
    mx.lastFetch = new Date().toISOString(); mx.lastError = '';
    IX = MX.indexar(mx.data); saveMx();
    aplicarMaestros(manual);
  } catch (e) { mx.lastError = e.message || String(e); saveMx(); if (manual) toast(mx.lastError, true); }
  finally { mxRunning = false; renderMxStatus(); }
}
/* Nombres y fincas nuevas se aplican solos. El primer enlace, los cambios de categoría y unir
   productos repetidos se enseñan antes para que los confirmes. */
function aplicarMaestros(manual) {
  if (!IX) return false;
  const plan = planStock(state, IX);
  if (!state.settings.mxEnlazado || plan.unirProd.length || plan.cats.length) {
    mx.avisar = true; saveMx(); renderMxStatus();
    if (manual) { if (sheetOpen) { closeSheet(); setTimeout(openEnlace, 40); } else openEnlace(); }
    return manual;
  }
  mx.avisar = false; saveMx();
  const prueba = structuredClone(state);
  aplicarStock(prueba, plan, IX);
  if (JSON.stringify(prueba) !== JSON.stringify(state)) {
    if (commit((c) => { aplicarStock(c, planStock(c, IX), IX); }) && manual) toast('Maestros actualizados');
  } else if (manual) toast('Todo al día con los maestros');
  return false;
}
function openEnlace() {
  if (!IX) return;
  const plan = planStock(state, IX);
  const prueba = structuredClone(state);
  const r = aplicarStock(prueba, plan, IX, { unir: true });
  const cambios = [];
  for (const p of state.productos) { const n = prueba.productos.find((x) => x.id === p.id); if (n && n.nombre !== p.nombre) cambios.push([p.nombre, n.nombre]); }
  for (const f of state.fincas) { const n = prueba.fincas.find((x) => x.code === f.code); if (n && n.name !== f.name) cambios.push([f.name, n.name]); }
  const nuevas = prueba.fincas.filter((f) => !state.fincas.some((x) => x.code === f.code));
  const unir = plan.unirProd.map((u) => [u.quita.map((q) => `${q.nombre} (${q.n} mov.)`).join(', '), prodNombre(u.queda)]);
  const sin = [...plan.sinProd.map((id) => prodNombre(id)), ...plan.sinFin.map((c) => fincaByCode(c)?.name || c)];
  const primera = !state.settings.mxEnlazado;
  const lista = (xs) => `<div class="box">${xs.map(([a, b]) => `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('')}</div>`;
  const body = openSheet(primera ? 'Enlazar con los maestros' : 'Cambios de los maestros', `
    <p class="small" style="margin-top:0">Cada producto y finca queda unido a su ficha del maestro (P008, F004…). Stock, precios, entradas y salidas no cambian de importe.</p>
    <div class="box">
      <div><span>Productos enlazados</span><b>${plan.prod.length}</b></div>
      <div><span>Fincas enlazadas</span><b>${plan.fin.length}</b></div>
      <div><span>Nombres que se igualan al maestro</span><b>${cambios.length}</b></div>
      <div><span>Productos que cambian de categoría</span><b>${plan.cats.length}</b></div>
      <div><span>Fincas propias que se añaden</span><b>${nuevas.length}</b></div>
      ${unir.length ? `<div><span>Productos repetidos que se unen</span><b>${unir.length}</b></div>` : ''}
      <div><span>Sin enlazar (los revisas tú)</span><b>${sin.length}</b></div>
    </div>
    ${plan.cats.length ? `<h3>Cambian de categoría</h3>${lista(plan.cats.map((x) => [x.nombre, `${x.de} → ${x.a}`]))}<p class="hint">Sus salidas ya anotadas pasan también a la nueva categoría.</p>` : ''}
    ${unir.length ? `<h3>Se unen en un solo producto</h3>${lista(unir.map(([a, b]) => [a, '→ ' + b]))}<p class="hint">Su stock, entradas y salidas pasan al producto que queda.</p>` : ''}
    ${nuevas.length ? `<h3>Fincas propias nuevas</h3>${lista(nuevas.map((f) => [f.name, f.code]))}` : ''}
    ${cambios.length ? `<details class="more"><summary>${cambios.length === 1 ? 'Ver el nombre que cambia' : `Ver los ${cambios.length} nombres que cambian`}</summary>${lista(cambios.map(([a, b]) => [a, '→ ' + b]))}</details>` : ''}
    ${sin.length ? `<details class="more" open><summary>Sin enlazar (${sin.length})</summary>${lista(sin.map((n) => [n, '']))}<p class="hint">Después los enlazas o los das de alta en Ajustes → Maestros → Revisar sin enlazar.</p></details>` : ''}
    <div class="actions" style="margin-top:16px">
      <button class="btn" id="enBk">Guardar copia antes (recomendado)</button>
      <button class="btn primary" id="enOk">Aplicar</button>
      <button class="btn" id="enNo">Ahora no</button>
    </div>`);
  $('#enBk', body).onclick = shareOrDownloadBackup;
  $('#enNo', body).onclick = closeSheet;
  $('#enOk', body).onclick = () => {
    if (commit((c) => { aplicarStock(c, planStock(c, IX), IX, { unir: true }); c.settings.mxEnlazado = true; })) {
      mx.avisar = false; saveMx(); renderMxStatus(); closeSheet(); toast('Enlazado con los maestros');
    }
  };
}
const prodNombre = (id) => state.productos.find((p) => p.id === id)?.nombre ?? '(producto)';
function openSinEnlazar() {
  if (!IX) return toast('Primero conecta los maestros', true);
  const plan = planStock(state, IX);
  const pend = new Set(state.mxPend.map((a) => a.ref));
  const prodOpts = CAT_STOCK.map((c) => `<optgroup label="${c}">${[...IX.prod.values()].filter((p) => p.categoria === c).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((p) => `<option value="${p.id}">${esc(p.nombre)} · ${p.id}</option>`).join('')}</optgroup>`).join('');
  const finOpts = [...IX.fin.values()].filter(esPropiaMx).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((f) => `<option value="${f.id}">${esc(f.nombre)} · ${f.id}</option>`).join('');
  const ps = plan.sinProd.map((id) => state.productos.find((p) => p.id === id)).filter(Boolean);
  const fs = plan.sinFin.map((c) => fincaByCode(c)).filter(Boolean);
  const body = openSheet('Sin enlazar', ps.length + fs.length ? `
    <p class="small" style="margin-top:0">No se han reconocido por nombre ni alias. Enlázalos a su ficha o pide el alta (quedará en amarillo en el maestro).</p>
    ${ps.map((p) => `<div class="box"><div><span><b>${esc(p.nombre)}</b> · ${esc(p.categoria)}</span>${pend.has(p.id) ? '<b>Alta pedida</b>' : ''}</div></div>
      ${pend.has(p.id) ? '' : `<label class="fld"><span>Es esta ficha del maestro</span><select data-sp="${p.id}"><option value="">Elige…</option>${prodOpts}</select></label>
      <div class="actions two" style="margin-bottom:16px"><button class="btn" data-ep="${p.id}">Enlazar</button><button class="btn" data-ap="${p.id}">Dar de alta</button></div>`}`).join('')}
    ${fs.map((f) => `<div class="box"><div><span><b>${esc(f.name)}</b> · finca ${esc(f.code)}</span></div></div>
      <label class="fld"><span>Es esta finca del maestro</span><select data-sf="${f.code}"><option value="">Elige…</option>${finOpts}</select></label>
      <div class="actions" style="margin-bottom:16px"><button class="btn" data-ef="${f.code}">Enlazar</button></div>`).join('')}
    <p class="hint">Una finca que no esté en el maestro se da de alta en la hoja «Maestro de fincas» (con Propia = Sí).</p>`
    : '<div class="box"><div><span>✓ Todo está enlazado con los maestros</span></div></div>');
  const again = () => { closeSheet(); setTimeout(openSinEnlazar, 40); };
  body.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ep) {
      const mid = body.querySelector(`[data-sp="${b.dataset.ep}"]`).value; if (!mid) return toast('Elige la ficha del maestro', true);
      if (commit((c) => { c.productos.find((p) => p.id === b.dataset.ep).mid = mid; })) { if (!aplicarMaestros(true)) again(); }
    } else if (b.dataset.ap) {
      const p = state.productos.find((x) => x.id === b.dataset.ap);
      if (commit((c) => pedirAlta(c, 'producto', p.id, { nombre: p.nombre, categoria: p.categoria }))) { toast('Alta pedida'); refreshMx({}); again(); }
    } else if (b.dataset.ef) {
      const mid = body.querySelector(`[data-sf="${b.dataset.ef}"]`).value; if (!mid) return toast('Elige la finca del maestro', true);
      if (state.fincas.some((f) => f.mid === mid)) return toast('Esa finca del maestro ya está enlazada a otra', true);
      if (commit((c) => { c.fincas.find((f) => f.code === b.dataset.ef).mid = mid; })) { if (!aplicarMaestros(true)) again(); }
    }
  };
}
function mxStatusText() {
  if (!mxOn()) return '';
  if (mxRunning) return 'Leyendo los maestros…';
  const pend = state && state.mxPend.length ? ` · ${state.mxPend.length} ${state.mxPend.length === 1 ? 'alta pendiente' : 'altas pendientes'}` : '';
  if (mx.lastError) return 'Maestros: ' + mx.lastError + pend;
  if (!mx.data) return 'Maestros: todavía sin leer' + pend;
  return `Maestros: ${mx.data.fincas.length} fincas · ${mx.data.productos.length} productos · leídos ${ago(mx.lastFetch)}${pend}`;
}
function renderMxStatus() {
  const el = $('#mxStatus');
  if (el) { el.hidden = !(mxOn() && mx.avisar && IX); el.textContent = '⚠ Maestros: hay cambios para revisar · pulsa aquí'; }
  const l = $('#mxLine'); if (l) l.textContent = mxStatusText();
}
function drawMx(box) {
  if (mxOn()) {
    const sin = IX ? (() => { const p = planStock(state, IX); return p.sinProd.length + p.sinFin.length; })() : 0;
    box.innerHTML = `
      <p class="small" id="mxLine">${esc(mxStatusText())}</p>
      <p class="small">Fincas y productos salen de los maestros de Drive (Apps › Maestros). Se guardan en el móvil y funcionan sin conexión.</p>
      <div class="actions">
        <button class="btn primary" id="mxNow">Actualizar ahora</button>
        ${IX ? `<button class="btn" id="mxRev">Revisar sin enlazar${sin ? ` (${sin})` : ''}</button>` : ''}
        ${mx.avisar && IX ? '<button class="btn" id="mxEnl">Ver cambios pendientes</button>' : ''}
        <button class="btn danger" id="mxOff">Desconectar</button>
      </div>`;
    $('#mxNow', box).onclick = () => refreshMx({ manual: true });
    const rv = $('#mxRev', box); if (rv) rv.onclick = () => { closeSheet(); setTimeout(openSinEnlazar, 40); };
    const en = $('#mxEnl', box); if (en) en.onclick = () => { closeSheet(); setTimeout(openEnlace, 40); };
    $('#mxOff', box).onclick = () => { mx = { ...mx, url: '', clave: '', lastError: '', avisar: false }; saveMx(); renderMxStatus(); drawMx(box); toast('Maestros desconectados (lo enlazado se mantiene)'); };
  } else {
    box.innerHTML = `
      <p class="small">Conecta la app con los maestros de fincas y productos de tu Drive. Es el mismo script de maestros que usa Ventas (misma dirección y clave).</p>
      <label class="fld"><span>Dirección del script de maestros (termina en /exec)</span><input id="mxU" type="url" value="${esc(mx.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <label class="fld"><span>Clave</span><input id="mxK" type="password" value="${esc(mx.clave)}" autocomplete="off"></label>
      <div class="actions"><button class="btn primary" id="mxOn">Probar y conectar</button></div>`;
    $('#mxOn', box).onclick = async () => {
      const url = $('#mxU', box).value.trim(), clave = $('#mxK', box).value.trim();
      if (!URL_SCRIPT.test(url)) return toast('La dirección debe ser la de la aplicación web del script y terminar en /exec', true);
      if (!clave) return toast('Escribe la clave', true);
      try {
        const r = await postScript(url, clave, 'ping');
        if (!r.ok) throw new Error(mxErr(r, 'El script no responde'));
        mx.url = url; mx.clave = clave; mx.lastError = ''; saveMx();
        toast('Conectado. Leyendo los maestros…'); drawMx(box);
        refreshMx({ manual: true });
      } catch (e) { toast(e.message || 'No se pudo conectar', true); }
    };
  }
}

/* Producto nuevo: del maestro o, si no está, se escribe y se pide el alta (queda en amarillo para revisar). */
function npInit() { return { modo: IX ? 'mx' : 'libre', mid: '', nombre: '', cat: CAT_STOCK[0] }; }
function npHTML(np) {
  if (np.modo === 'mx') {
    const usados = new Set(state.productos.map((p) => p.mid).filter(Boolean));
    const opts = CAT_STOCK.map((c) => { const xs = [...IX.prod.values()].filter((p) => p.categoria === c && p.activo !== false && !usados.has(p.id)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')); return xs.length ? `<optgroup label="${c}">${xs.map((p) => `<option value="${p.id}" ${np.mid === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</optgroup>` : ''; }).join('');
    return `<label class="fld"><span>Producto del maestro</span><select id="npM"><option value="">Elige producto…</option>${opts}<option value="__libre">— No está en el maestro —</option></select></label>`;
  }
  return `${IX ? '<button type="button" class="btn" id="npVolver" style="margin-bottom:12px;height:40px">← Elegir del maestro</button>' : ''}
    <label class="fld"><span>Nombre del producto nuevo</span><input id="npN" type="text" value="${esc(np.nombre)}" autocomplete="off"></label>
    <div class="fld"><span>Categoría</span><div class="chips wrap" id="npC">${CAT_STOCK.map((c) => `<button type="button" class="chip" data-c="${c}" aria-pressed="${np.cat === c}">${c}</button>`).join('')}</div></div>
    ${mxOn() ? '<p class="hint">Se pedirá el alta en el maestro de productos y quedará en amarillo para que la revises.</p>' : ''}`;
}
function npBind(box, np, redraw) {
  const m = $('#npM', box); if (m) m.onchange = (e) => { if (e.target.value === '__libre') { np.modo = 'libre'; np.mid = ''; redraw(); } else np.mid = e.target.value; };
  const v = $('#npVolver', box); if (v) v.onclick = () => { np.modo = 'mx'; redraw(); };
  const n = $('#npN', box); if (n) n.oninput = (e) => { np.nombre = e.target.value; };
  const c = $('#npC', box); if (c) c.onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { np.cat = b.dataset.c; c.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x.dataset.c === np.cat)); } };
}
function npBuild(np) {
  if (np.modo === 'mx') {
    const m = np.mid && IX.prod.get(np.mid); if (!m) throw new Error('Elige el producto del maestro');
    if (!CAT_STOCK.includes(m.categoria)) throw new Error('Ese producto no es de una categoría con stock');
    return { prod: { id: nuevoId('p'), mid: m.id, nombre: m.nombre, categoria: m.categoria, q0: 0, v0: 0 }, alta: null };
  }
  const nombre = np.nombre.trim(); if (!nombre) throw new Error('Escribe el nombre del producto');
  if (state.productos.some((p) => MX.norm(p.nombre) === MX.norm(nombre))) throw new Error('Ya existe un producto con ese nombre: elígelo de la lista');
  const r = IX && MX.buscarProducto(IX, nombre);
  if (r && CAT_STOCK.includes(r.p.categoria)) {
    if (state.productos.some((p) => p.mid === r.p.id)) throw new Error(`«${r.p.nombre}» ya existe: elígelo de la lista`);
    return { prod: { id: nuevoId('p'), mid: r.p.id, nombre: r.p.nombre, categoria: r.p.categoria, q0: 0, v0: 0 }, alta: null, aviso: 'Ya estaba en el maestro: queda enlazado' };
  }
  return { prod: { id: nuevoId('p'), nombre, categoria: np.cat, q0: 0, v0: 0 }, alta: { nombre, categoria: np.cat } };
}

/* ---------- Entradas automáticas desde Ventas ----------
   Lee la copia de Ventas (su script de Google, acción «estado»), toma las ventas a tus fincas
   (cliente propio) desde la fecha elegida y las anota como entradas, al precio de la venta.
   Si una venta cambia o se borra en Ventas, la entrada se actualiza o se quita. Ventas, a su vez,
   lee esta app y marca esas ventas como pasadas. */
let vt = { url: '', clave: '', lastFetch: null, lastError: '', lastN: 0 };
let vtRunning = false;
const vtOn = () => !!(vt.url && vt.clave && state && state.settings.ventasDesde);
async function loadVt() { try { const s = await dbGet('ventas'); if (s) vt = { ...vt, ...s }; } catch (_) { /* nada */ } }
function saveVt() { dbSet('ventas', vt).catch(() => {}); }
async function leerVentas(url = vt.url, clave = vt.clave) {
  const r = await postScript(url, clave, 'estado');
  if (!r.ok) throw new Error(r.error === 'clave' ? 'La clave no coincide con la del script de Ventas' : r.error === 'sin copia' ? 'La hoja de Ventas aún no tiene copia: activa la copia automática en Ventas' : (r.error || 'No se pudo leer Ventas'));
  const vs = JSON.parse(r.estado);
  if (!vs || !Array.isArray(vs.pedidos) || !Array.isArray(vs.clientes)) throw new Error('La copia de Ventas no es válida');
  return vs;
}
function lineasPropias(vs, desde) {
  const own = new Set(vs.clientes.filter((c) => c.propio).map((c) => c.id));
  const pv = new Map(vs.productos.map((p) => [p.id, p]));
  const out = [];
  for (const o of vs.pedidos) {
    if (!own.has(o.cli) || o.fecha < desde) continue;
    for (const l of o.lineas) if (l.prod) out.push({ vk: o.id + '|' + l.k, fecha: o.fecha, pv: pv.get(l.prod) || { nombre: '?' }, cantidad: l.cant, importe: round(l.cant * l.precio, 4), sig: [o.fecha, l.prod, l.cant, l.precio].join('|') });
  }
  return out;
}
/* Producto de esta app que corresponde a un producto de Ventas (por ficha del maestro o por nombre). */
function prodPara(c, pv, crear) {
  let x = pv.mid ? c.productos.find((p) => p.mid === pv.mid) : null;
  const m = pv.mid && IX ? IX.prod.get(pv.mid) : (IX ? MX.buscarProducto(IX, pv.nombre)?.p : null);
  if (!x && m) x = c.productos.find((p) => p.mid === m.id) || c.productos.find((p) => MX.norm(p.nombre) === MX.norm(m.nombre));
  if (!x) { const k = MX.norm(pv.nombre); x = c.productos.filter((p) => k === MX.norm(p.nombre) || k.startsWith(MX.norm(p.nombre) + ' ')).sort((a, b) => b.nombre.length - a.nombre.length)[0]; }
  if (x) return x.id;
  if (!crear || !m || !CAT_STOCK.includes(m.categoria)) return null;
  const p = { id: nuevoId('p'), mid: m.id, nombre: m.nombre, categoria: m.categoria, q0: 0, v0: 0 };
  c.productos.push(p);
  return p.id;
}
function planVentasFincas(st, vs) {
  const desde = st.settings.ventasDesde;
  const cands = lineasPropias(vs, desde);
  const ya = new Map(st.entradas.filter((e) => e.vk).map((e) => [e.vk, e]));
  const libres = st.entradas.filter((e) => !e.vk);
  const usadas = new Set();
  const plan = { nuevas: [], enlazar: [], cambiadas: [], borradas: [], sinProd: [] };
  for (const x of cands) {
    const e = ya.get(x.vk);
    if (e) { if (e.vsig !== x.sig) plan.cambiadas.push(x); continue; }
    const pid = prodPara(st, x.pv, false);
    // ¿Ya la anotaste a mano? (mismo producto y cantidad, ±7 días): se enlaza y no se duplica
    const man = pid && libres.find((m) => !usadas.has(m.id) && m.producto === pid && Math.abs(m.cantidad - x.cantidad) < 0.001 && Math.abs(new Date(m.fecha) - new Date(x.fecha)) <= 7 * 864e5);
    if (man) { usadas.add(man.id); plan.enlazar.push({ ...x, eid: man.id }); continue; }
    if (!pid && !(IX && (x.pv.mid ? IX.prod.get(x.pv.mid) : MX.buscarProducto(IX, x.pv.nombre)))) { plan.sinProd.push(x); continue; }
    plan.nuevas.push(x);
  }
  const vivos = new Set(cands.map((x) => x.vk));
  for (const e of ya.values()) if (!vivos.has(e.vk)) plan.borradas.push(e);
  return plan;
}
function aplicarVentasFincas(c, plan) {
  let n = 0;
  for (const x of plan.enlazar) { const e = c.entradas.find((y) => y.id === x.eid); if (e) { e.vk = x.vk; e.vsig = x.sig; n++; } }
  for (const x of plan.nuevas) {
    const pid = prodPara(c, x.pv, true); if (!pid) continue;
    c.entradas.push({ id: uid(), ts: Date.now(), fecha: x.fecha, producto: pid, cantidad: x.cantidad, importe: x.importe, vk: x.vk, vsig: x.sig, origen: 'Ventas' }); n++;
  }
  for (const x of plan.cambiadas) {
    const e = c.entradas.find((y) => y.vk === x.vk); if (!e) continue;
    const pid = prodPara(c, x.pv, true) || e.producto;
    Object.assign(e, { fecha: x.fecha, producto: pid, cantidad: x.cantidad, importe: x.importe, vsig: x.sig }); n++;
  }
  const quitar = new Set(plan.borradas.map((e) => e.id));
  if (quitar.size) { c.entradas = c.entradas.filter((e) => !quitar.has(e.id)); n += quitar.size; }
  return n;
}
async function refreshVentas({ auto = false, manual = false } = {}) {
  if (!vtOn() || vtRunning) return;
  if (!navigator.onLine) { if (manual) toast('Sin conexión: se comprobará al volver', true); return; }
  if (auto && vt.lastFetch && Date.now() - new Date(vt.lastFetch).getTime() < 15 * 60000) return;
  vtRunning = true; renderVtLine();
  try {
    const vs = await leerVentas();
    const plan = planVentasFincas(state, vs);
    const total = plan.nuevas.length + plan.enlazar.length + plan.cambiadas.length + plan.borradas.length;
    vt.lastFetch = new Date().toISOString(); vt.lastError = '';
    if (total) {
      let ok = commit((c) => { aplicarVentasFincas(c, plan); });
      // Si quitar o cambiar algo dejara un producto en negativo, al menos entran las nuevas
      if (!ok && (plan.cambiadas.length || plan.borradas.length)) { ok = commit((c) => { aplicarVentasFincas(c, { ...plan, cambiadas: [], borradas: [] }); }); vt.lastError = 'Hay ventas cambiadas o borradas en Ventas que dejarían stock en negativo: revísalas'; }
      if (ok) { vt.lastN = total; toast(`Desde Ventas: ${plan.nuevas.length} entradas nuevas${plan.cambiadas.length ? `, ${plan.cambiadas.length} cambiadas` : ''}${plan.borradas.length ? `, ${plan.borradas.length} quitadas` : ''}`); }
    } else if (manual) toast('Nada nuevo en Ventas');
    if (plan.sinProd.length) vt.lastError = `${plan.sinProd.length} ventas con un producto que no se encuentra: ${[...new Set(plan.sinProd.map((x) => x.pv.nombre))].join(', ')}`;
  } catch (e) { vt.lastError = e.message || String(e); if (manual) toast(vt.lastError, true); }
  finally { vtRunning = false; saveVt(); renderVtLine(); }
}
function vtText() {
  if (!vtOn()) return '';
  if (vtRunning) return 'Comprobando Ventas…';
  if (vt.lastError) return 'Ventas: ' + vt.lastError;
  const n = state.entradas.filter((e) => e.vk).length;
  return `Ventas a tus fincas desde el ${fmtDate(state.settings.ventasDesde)} · ${n} entradas · comprobado ${ago(vt.lastFetch)}`;
}
function renderVtLine() { const l = $('#vtLine'); if (l) l.textContent = vtText(); }
function drawVt(box) {
  if (vtOn()) {
    box.innerHTML = `
      <p class="small" id="vtLine">${esc(vtText())}</p>
      <p class="small">Las ventas a tus fincas en la app Ventas entran aquí solas como entradas, al precio de la venta. Se comprueba al abrir la app.</p>
      <div class="actions"><button class="btn primary" id="vtNow">Comprobar ahora</button><button class="btn danger" id="vtOff">Desconectar</button></div>`;
    $('#vtNow', box).onclick = () => refreshVentas({ manual: true });
    $('#vtOff', box).onclick = () => { vt = { ...vt, url: '', clave: '', lastError: '' }; saveVt(); drawVt(box); toast('Ventas desconectada (las entradas ya pasadas se quedan)'); };
  } else {
    const d = new Date(); const def = state.settings.ventasDesde || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    box.innerHTML = `
      <p class="small">Para que las ventas a tus fincas entren solas como entradas. Usa la dirección y la clave del script de la hoja de Ventas (las mismas que tienes en Ventas → Ajustes → Copia automática).</p>
      <label class="fld"><span>Dirección del script de Ventas (termina en /exec)</span><input id="vtU" type="url" value="${esc(vt.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <label class="fld"><span>Clave</span><input id="vtK" type="password" value="${esc(vt.clave)}" autocomplete="off"></label>
      <label class="fld"><span>Pasar las ventas desde</span><input id="vtD" type="date" value="${def}"></label>
      <p class="hint">Lo anterior a esa fecha ya lo tienes anotado. Antes de pasar nada verás la lista, y lo que ya anotaste a mano se enlaza sin duplicarse.</p>
      <div class="actions"><button class="btn primary" id="vtOn">Probar y ver la lista</button></div>`;
    $('#vtOn', box).onclick = async () => {
      const url = $('#vtU', box).value.trim(), clave = $('#vtK', box).value.trim(), desde = $('#vtD', box).value;
      if (!URL_SCRIPT.test(url)) return toast('La dirección debe ser la del script de Ventas y terminar en /exec', true);
      if (!clave) return toast('Escribe la clave', true);
      if (!desde) return toast('Elige la fecha desde la que pasar las ventas', true);
      if (url === mx.url) return toast('Esa es la dirección de los maestros: aquí va la del script de la hoja de Ventas', true);
      try {
        const vs = await leerVentas(url, clave);
        closeSheet(); setTimeout(() => openVentasInicio(url, clave, desde, vs), 40);
      } catch (e) { toast(e.message || 'No se pudo leer Ventas', true); }
    };
  }
}
function openVentasInicio(url, clave, desde, vs) {
  const prueba = structuredClone(state); prueba.settings.ventasDesde = desde;
  const plan = planVentasFincas(prueba, vs);
  const fila = (x, estado) => `<div><span>${fmtDate(x.fecha)} · ${esc(x.pv.nombre)} · ${qty(x.cantidad)}</span><b>${estado}</b></div>`;
  const body = openSheet('Ventas a tus fincas', `
    <p class="small" style="margin-top:0">Ventas a tus fincas desde el <b>${fmtDate(desde)}</b> que hay en la app Ventas:</p>
    <div class="box">
      <div><span>Nuevas: se añaden como entradas</span><b>${plan.nuevas.length}</b></div>
      <div><span>Ya anotadas a mano: se enlazan, no se duplican</span><b>${plan.enlazar.length}</b></div>
      ${plan.sinProd.length ? `<div><span>Con un producto que no se encuentra</span><b>${plan.sinProd.length}</b></div>` : ''}
    </div>
    ${plan.nuevas.length + plan.enlazar.length + plan.sinProd.length ? `<details class="more" open><summary>Ver la lista</summary><div class="box">${plan.nuevas.map((x) => fila(x, 'nueva')).join('')}${plan.enlazar.map((x) => fila(x, 'ya anotada')).join('')}${plan.sinProd.map((x) => fila(x, 'sin producto')).join('')}</div></details>` : '<p class="small">No hay ventas a tus fincas desde esa fecha. A partir de ahora entrarán solas.</p>'}
    <div class="actions" style="margin-top:16px"><button class="btn primary" id="viOk">Conectar y pasar</button><button class="btn" id="viNo">Cancelar</button></div>`);
  $('#viNo', body).onclick = closeSheet;
  $('#viOk', body).onclick = () => {
    const ok = commit((c) => { c.settings.ventasDesde = desde; aplicarVentasFincas(c, planVentasFincas(c, vs)); });
    if (ok) { vt = { ...vt, url, clave, lastFetch: new Date().toISOString(), lastError: '' }; saveVt(); closeSheet(); toast('Ventas conectada'); }
  };
}

/* ---------- Ajustes y copia de seguridad ---------- */
function backupJSON() { return JSON.stringify({ app: 'stock-fincas', version: APP_VERSION, exportedAt: new Date().toISOString(), state }, null, 1); }
async function shareOrDownloadBackup() {
  const name = `gestion-fincas-copia-${todayISO()}.json`;
  const text = backupJSON();
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Copia Gestión fincas' }); }
    else download(name, text, 'application/json');
  } catch (e) { if (e && e.name === 'AbortError') return; download(name, text, 'application/json'); }
  state.settings.lastBackup = new Date().toISOString(); persist(); toast('Copia generada');
}
function openSettings() {
  const body = openSheet('Ajustes', `
    <label class="fld"><span>Campaña que se anota en los registros nuevos</span><input id="sC" type="text" inputmode="numeric" value="${esc(state.settings.campana)}"></label>
    <div class="actions"><button class="btn" id="sSaveC">Guardar campaña</button></div>
    <div class="sep"></div>
    <h3>Maestros de fincas y productos</h3>
    <div id="mxBox"></div>
    <div class="sep"></div>
    <h3>Entradas automáticas desde Ventas</h3>
    <div id="vtBox"></div>
    <div class="sep"></div>
    <h3>Copia automática en Google Sheets</h3>
    <div id="syncBox"></div>
    <div class="sep"></div>
    <h3>Histórico del Excel de Gestión de fincas</h3>
    <p class="small">${histInfo()} El fichero está en Drive › Apps › Copia de seguridad (gestion-fincas-historico-excel.json). Cargarlo otra vez solo añade lo que falte; no duplica ni toca el stock.</p>
    <div class="actions"><label class="btn" style="display:grid;place-items:center;cursor:pointer">Cargar histórico del Excel<input id="sHi" type="file" accept="application/json,.json" hidden></label></div>
    <div class="sep"></div>
    <h3>Copia de seguridad en fichero</h3>
    <p class="small">Los datos viven en este móvil. Puedes guardar un fichero con todo (por ejemplo en Drive o WhatsApp).${state.settings.lastBackup ? ` Última copia: ${new Date(state.settings.lastBackup).toLocaleString('es-ES')}.` : ' Aún no has hecho ninguna.'}</p>
    <div class="actions">
      <button class="btn primary" id="sBk">Guardar copia / compartir</button>
      <label class="btn" style="display:grid;place-items:center;cursor:pointer">Restaurar desde fichero<input id="sRs" type="file" accept="application/json,.json" hidden></label>
    </div>
    <div class="sep"></div>
    <p class="small">${APP_NAME} v${APP_VERSION}. La app no lleva datos dentro: en un móvil nuevo se restaura desde la hoja de Google o desde un fichero de copia.</p>`);
  drawSync($('#syncBox', body));
  drawMx($('#mxBox', body));
  drawVt($('#vtBox', body));
  $('#sSaveC', body).onclick = () => {
    const n = parseInt($('#sC', body).value, 10);
    if (!(n >= 2000 && n <= 2100)) return toast('Escribe un año válido, por ejemplo 2026', true);
    state.settings.campana = n; persist(); toast('Campaña guardada: ' + n);
  };
  $('#sBk', body).onclick = shareOrDownloadBackup;
  $('#sHi', body).onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try { const j = JSON.parse(await file.text()); reopenSheet(() => openHistorico(j)); }
    catch (err) { toast('No se pudo leer el fichero: ' + (err.message || err), true); }
  };
  $('#sRs', body).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      const s = j && j.state;
      if (!validState(s)) throw new Error('El fichero no es una copia de Gestión fincas (Stock Fincas)');
      if (!confirm(`Se reemplazarán todos los datos actuales por los de la copia (${s.movs.length} registros, ${s.entradas.length} entradas). ¿Continuar?`)) return;
      state = migrar(s); await persist(); closeSheet(); renderAll(); toast('Copia restaurada'); if (mxOn()) refreshMx({});
    } catch (err) { toast(err.message || 'No se pudo leer la copia', true); }
    e.target.value = '';
  };
}

/* ---------- Histórico del Excel ----------
   Las líneas del Excel entran como registros «histórico» sin producto: cuentan para Cuentas fincas y la
   Tabla principal, pero no mueven el stock. Cada línea lleva un identificador fijo (h0001…), así que
   cargar el fichero otra vez solo añade las que falten. */
const reopenSheet = (fn) => { closeSheet(); setTimeout(fn, 40); };
function histInfo() {
  const h = state.movs.filter((s) => s.hist);
  if (!h.length) return 'Todavía no está cargado.';
  const fs = h.map((s) => s.fecha).sort();
  return `Cargado: ${h.length} líneas (${fmtDate(fs[0])} a ${fmtDate(fs[fs.length - 1])}).`;
}
function lineasHistorico(j) {
  if (!j || j.app !== 'gestion-fincas-historico' || !Array.isArray(j.lineas)) throw new Error('El fichero no es el histórico del Excel de Gestión de fincas');
  const porMid = new Map(state.fincas.filter((f) => f.mid).map((f) => [f.mid, f]));
  const porNombre = new Map(state.fincas.map((f) => [f.name.toLowerCase(), f]));
  const ya = new Set(state.movs.map((s) => s.id));
  const faltan = new Set(); const nuevas = []; let yaN = 0;
  for (const l of j.lineas) {
    if (ya.has(l.id)) { yaN++; continue; }
    const fi = porMid.get(l.fincaId) || porNombre.get(String(l.finca).toLowerCase());
    if (!fi) { faltan.add(l.finca); continue; }
    const tipo = TIPO_TILDE[l.tipo] || l.tipo;
    if (!TIPOS[l.categoria] || !TIPOS[l.categoria].includes(tipo)) throw new Error(`Tipo desconocido en el histórico: ${l.categoria} · ${l.tipo}`);
    nuevas.push({ id: l.id, ts: Number(l.ts) || 0, hist: true, campana: Number(l.campana), fecha: l.fecha, categoria: l.categoria, tipo, tipo2: l.categoria === 'Tarea' ? (l.tipo2 || '') : '', finca: fi.code, desc: l.desc || tipo, producto: null, cantidad: Number(l.cantidad) || 0, precio: Number(l.precio) || 0, importe: Number(l.importe) || 0 });
  }
  return { nuevas, faltan: [...faltan], total: j.lineas.length, yaN };
}
function openHistorico(j) {
  let r;
  try { r = lineasHistorico(j); } catch (e) { return toast(e.message, true); }
  const imp = r.nuevas.reduce((t, l) => t + l.importe, 0);
  const fs = r.nuevas.map((l) => l.fecha).sort();
  const body = openSheet('Cargar histórico del Excel', `
    <div class="box">
      <div><span>Líneas en el fichero</span><b>${r.total}</b></div>
      <div><span>Ya estaban en la app</span><b>${r.yaN}</b></div>
      <div><span>Se añaden</span><b>${r.nuevas.length}</b></div>
      ${r.nuevas.length ? `<div><span>Fechas</span><b>${fmtDate(fs[0])} – ${fmtDate(fs[fs.length - 1])}</b></div><div><span>Importe de lo que se añade</span><b>${eur(imp)}</b></div>` : ''}
    </div>
    ${r.faltan.length ? `<p class="hint" style="color:var(--danger)">No encuentro estas fincas en la app: ${r.faltan.map(esc).join(', ')}. Sus líneas no se cargan; conecta los maestros y vuelve a intentarlo.</p>` : ''}
    <p class="hint">No mueven el stock. Aparecen en Salidas en su mes, marcadas como histórico, y se envían a la Tabla principal de tu hoja.</p>
    <div class="actions"><button class="btn primary" id="hOk" ${r.nuevas.length ? '' : 'disabled'}>Añadir ${r.nuevas.length} líneas</button></div>`);
  $('#hOk', body).onclick = () => {
    if (commit((c) => { const ya = new Set(c.movs.map((s) => s.id)); for (const l of r.nuevas) if (!ya.has(l.id)) c.movs.push(l); })) { closeSheet(); toast(`Histórico cargado: ${r.nuevas.length} líneas`); }
  };
}

/* ---------- Render general ---------- */
function renderAll() {
  const m = computeStock();
  $('#totalValor').textContent = eur(totalValor(m));
  document.querySelectorAll('.tab').forEach((b) => { if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  renderSyncStatus(); renderMxStatus();
  $('#fabLabel').textContent = ui.tab === 'stock' ? 'Producto nuevo' : ui.tab === 'entradas' ? 'Nueva entrada' : 'Nueva salida';
  if (ui.tab === 'stock') renderStock(); else if (ui.tab === 'entradas') renderEntradas(); else renderSalidas();
  if (appVacia()) {
    $('#view').insertAdjacentHTML('afterbegin', `<div class="notice"><b>Este móvil todavía no tiene datos</b><p class="small">La app ya no lleva el stock dentro. Restáuralo una vez desde Ajustes: «Copia automática en Google Sheets» → «Restaurar desde la hoja», o «Restaurar desde fichero» con la copia guardada en Drive (Apps › Copia de seguridad).</p><button class="btn primary" id="goAj">Abrir Ajustes</button></div>`);
    $('#goAj').onclick = openSettings;
  }
}

async function init() {
  document.querySelectorAll('.tab').forEach((b) => b.onclick = () => { ui.tab = b.dataset.tab; window.scrollTo(0, 0); renderAll(); });
  $('#btnSettings').onclick = openSettings;
  $('#fab').onclick = () => { if (ui.tab === 'stock') openProductSheet(null); else if (ui.tab === 'entradas') openEntradaForm(null); else openMovForm(null); };
  await loadSync();
  $('#syncStatus').onclick = openSettings;
  $('#mxStatus').onclick = () => openEnlace();
  window.addEventListener('online', () => { if (sync.dirty) runSync(); else renderSyncStatus(); if (mxOn() && state.mxPend.length) refreshMx({ auto: true }); if (vtOn()) refreshVentas({ auto: true }); });
  window.addEventListener('offline', renderSyncStatus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (sync.dirty) runSync();
    (async () => { if (mxOn()) await refreshMx({ auto: true }); if (vtOn()) refreshVentas({ auto: true }); })();
  });
  setInterval(renderSyncStatus, 60000);
  try {
    let s = await dbGet('state');
    if (!s) { s = emptyState(); await dbSet('state', s); }
    else if (!s.v || s.v < 3) { migrar(s); await dbSet('state', s); }
    state = migrar(s);
  } catch (e) {
    state = emptyState();
    toast('Este navegador no permite guardar datos: lo que anotes se perderá al cerrar', true);
  }
  await loadMx(); await loadVt();
  renderAll();
  if (syncOn() && sync.dirty) setTimeout(runSync, 1500);
  setTimeout(async () => { if (mxOn()) await refreshMx({ auto: true }); if (vtOn()) refreshVentas({ auto: true }); }, 2000);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
