/**
 * Gestión fincas · receptor para Google Sheets (también sirve a la app Cuentas fincas)
 *
 * Pestañas que escribe la app Gestión fincas en cada envío (espejo; no escribas dentro):
 *   Tabla principal -> todas las líneas (histórico del Excel + lo nuevo), mismas 12 columnas que tu Excel,
 *                      la más reciente arriba. Para tu Excel: copia las columnas A–J y pégalas en su tabla.
 *   Entradas        -> compras y correcciones de inventario
 *   Stock           -> stock, precio medio y valor por producto
 *   _copia          -> copia completa para poder restaurar la app (oculta; no tocar)
 *
 * Pestañas que escribe la app Cuentas fincas (sí puedes mirarlas; mejor cambiarlas desde la app):
 *   Presupuestos    -> lo que presupuestas por campaña, finca y concepto
 *   Parámetros      -> mano de obra propia (€/h) y reglas de arrendamiento de cada finca
 *
 * La superficie y el número de árboles de cada finca se leen del «Maestro de fincas» (Drive › Apps › Maestros).
 */

const CLAVE = 'CAMBIA-ESTA-CLAVE'; // debe ser idéntica a la que escribes en las apps (Ajustes)

const HOJAS = { tabla: 'Tabla principal', antigua: 'Salidas', entradas: 'Entradas', stock: 'Stock', copia: '_copia', presupuestos: 'Presupuestos', parametros: 'Parámetros' };
const CAB_TABLA = ['Fecha', 'Descripción', 'Campaña', 'Categoria', 'Tipo', 'Tipo 2', 'Finca', 'Cantidad', 'Precio', 'Importe', 'Mes', 'Año'];
const CAB_ENTRADAS = ['Fecha', 'Producto', 'Categoría', 'Cantidad', 'Precio unit.', 'Importe'];
const CAB_STOCK = ['Producto', 'Categoría', 'Stock', 'Precio medio', 'Valor'];
const CAB_PRESUP = ['Campaña', 'Finca ID', 'Finca', 'Concepto', 'Descripción', 'Valor', 'Actualizado'];
const CAB_PARAM = ['Clave', 'Valor', 'Descripción'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function doGet() {
  return salida({ ok: true, mensaje: 'Gestión fincas: receptor activo' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let bloqueado = false;
  try {
    lock.waitLock(25000);
    bloqueado = true;
    const req = JSON.parse(e.postData.contents);
    if (!req || req.clave !== CLAVE) return salida({ ok: false, error: 'clave' });
    if (req.accion === 'ping') return salida({ ok: true });
    if (req.accion === 'sincronizar') return salida(sincronizar(req));
    if (req.accion === 'estado') return salida(leerEstado());
    if (req.accion === 'cuentas') return salida(leerCuentas());
    if (req.accion === 'guardarPresupuesto') return salida(guardarPresupuesto(req));
    if (req.accion === 'guardarParametros') return salida(guardarParametros(req));
    return salida({ ok: false, error: 'accion desconocida' });
  } catch (err) {
    return salida({ ok: false, error: String((err && err.message) || err) });
  } finally {
    if (bloqueado) { try { lock.releaseLock(); } catch (_) { /* nada */ } }
  }
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function libro() { return SpreadsheetApp.getActiveSpreadsheet(); }
function hoja(nombre) { return libro().getSheetByName(nombre) || libro().insertSheet(nombre); }
function tz() { return libro().getSpreadsheetTimeZone(); }
function aFecha(iso) { return Utilities.parseDate(String(iso), tz(), 'yyyy-MM-dd'); }
function aIso(v) { return v instanceof Date ? Utilities.formatDate(v, tz(), 'yyyy-MM-dd') : String(v || ''); }

function escribirTabla(nombre, cabecera, filas, formatos) {
  const sh = hoja(nombre);
  sh.clear();
  sh.getRange(1, 1, 1, cabecera.length).setValues([cabecera])
    .setFontWeight('bold').setBackground('#1f6f43').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (filas.length) {
    sh.getRange(2, 1, filas.length, cabecera.length).setValues(filas);
    formatos.forEach(function (f, i) { if (f) sh.getRange(2, i + 1, filas.length, 1).setNumberFormat(f); });
  }
  sh.autoResizeColumns(1, cabecera.length);
}

/* Las versiones antiguas de la app mandan «salidas» (10 columnas, la más antigua arriba): se convierten. */
function tablaDesdeSalidas(salidas) {
  return salidas.slice().reverse().map(function (r) {
    const m = Number(String(r[0]).slice(5, 7));
    return r.concat([MESES[m - 1] || '', Number(String(r[0]).slice(0, 4))]);
  });
}

function sincronizar(req) {
  const tabla = (req.tabla || tablaDesdeSalidas(req.salidas || [])).map(function (r) { const x = r.slice(); x[0] = aFecha(x[0]); return x; });
  const entradas = (req.entradas || []).map(function (r) { const x = r.slice(); x[0] = aFecha(x[0]); return x; });
  const stock = (req.stock || []).slice();
  stock.push(['TOTAL', '', '', '', req.total]);

  escribirTabla(HOJAS.tabla, CAB_TABLA, tabla, ['dd/mm/yyyy', null, '0', null, null, null, null, '#,##0.###', '#,##0.00####', '#,##0.00', null, '0']);
  escribirTabla(HOJAS.entradas, CAB_ENTRADAS, entradas, ['dd/mm/yyyy', null, null, '#,##0.###', '#,##0.00####', '#,##0.00']);
  escribirTabla(HOJAS.stock, CAB_STOCK, stock, [null, null, '#,##0.###', '#,##0.00####', '#,##0.00']);
  guardarCopia(String(req.estado || ''), new Date().toISOString());

  // La pestaña «Salidas» era el espejo antiguo: la sustituye «Tabla principal».
  const vieja = libro().getSheetByName(HOJAS.antigua);
  if (vieja) libro().deleteSheet(vieja);

  return { ok: true, lineas: tabla.length, entradas: entradas.length, productos: stock.length - 1, fecha: new Date().toISOString() };
}

function guardarCopia(estado, fecha) {
  const sh = hoja(HOJAS.copia);
  sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['Copia automática de Gestión fincas (no editar ni borrar)', fecha]]);
  const trozos = [];
  for (let i = 0; i < estado.length; i += 40000) trozos.push([estado.substr(i, 40000)]);
  if (trozos.length) {
    const rng = sh.getRange(2, 1, trozos.length, 1);
    rng.setNumberFormat('@'); // texto plano: que Sheets no interprete los trozos como números o fórmulas
    rng.setValues(trozos);
  }
  sh.hideSheet();
}

function leerEstado() {
  const sh = libro().getSheetByName(HOJAS.copia);
  if (!sh || sh.getLastRow() < 2) return { ok: false, error: 'sin copia' };
  const n = sh.getLastRow() - 1;
  const trozos = sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); });
  const f = sh.getRange(1, 2).getValue();
  return { ok: true, estado: trozos.join(''), fecha: f instanceof Date ? f.toISOString() : String(f) };
}

/* ---------- Para la app Cuentas fincas ---------- */
function filas(nombre) {
  const sh = libro().getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

function leerCuentas() {
  const tabla = filas(HOJAS.tabla).filter(function (r) { return r[0]; }).map(function (r) {
    return [aIso(r[0]), String(r[1]), Number(r[2]), String(r[3]), String(r[4]), String(r[5]), String(r[6]), Number(r[7]) || 0, Number(r[8]) || 0, Number(r[9]) || 0];
  });
  const copia = libro().getSheetByName(HOJAS.copia);
  const f = copia ? copia.getRange(1, 2).getValue() : '';
  const m = fincasMaestro();
  return { ok: true, tabla: tabla, fincas: m.fincas, avisoFincas: m.aviso, presupuestos: leerPresupuestos(), parametros: leerParametros(), fecha: f instanceof Date ? f.toISOString() : String(f || '') };
}

/* Fincas propias del «Maestro de fincas», con superficie y árboles. */
function fincasMaestro() {
  try {
    const it = DriveApp.getFilesByName('Maestro de fincas');
    while (it.hasNext()) {
      const file = it.next();
      if (file.getMimeType() !== MimeType.GOOGLE_SHEETS || file.isTrashed()) continue;
      const sh = SpreadsheetApp.open(file).getSheetByName('Fincas');
      if (!sh) continue;
      const v = sh.getDataRange().getValues();
      const cab = v[0].map(function (c) { return String(c).trim(); });
      const col = function (n) { return cab.indexOf(n); };
      const num = function (x) { const n = typeof x === 'number' ? x : parseFloat(String(x || '').replace(',', '.')); return isFinite(n) ? n : null; };
      const out = [];
      for (let i = 1; i < v.length; i++) {
        const r = v[i];
        if (!r[col('ID')] || !/^s[ií]/i.test(String(r[col('Propia')]))) continue;
        out.push({ id: String(r[col('ID')]), nombre: String(r[col('Nombre')]), ha: num(r[col('Superficie (ha)')]), arboles: col('Nº árboles') > -1 ? num(r[col('Nº árboles')]) : null });
      }
      return { fincas: out, aviso: '' };
    }
    return { fincas: [], aviso: 'No encuentro la hoja «Maestro de fincas» en tu Drive' };
  } catch (err) {
    return { fincas: [], aviso: 'No se pudo leer el Maestro de fincas: ' + String((err && err.message) || err) };
  }
}

function leerPresupuestos() {
  return filas(HOJAS.presupuestos).filter(function (r) { return r[0] && r[3]; }).map(function (r) {
    return { campana: Number(r[0]), fincaId: String(r[1]), finca: String(r[2]), concepto: String(r[3]), valor: r[5] === '' ? null : Number(r[5]), ts: r[6] instanceof Date ? r[6].toISOString() : String(r[6] || '') };
  });
}

function leerParametros() {
  const out = {};
  filas(HOJAS.parametros).forEach(function (r) { if (r[0]) out[String(r[0])] = r[1]; });
  return out;
}

/* Cambios de presupuesto: { campana, fincaId, finca, concepto, descripcion, valor (null = borrar), ts }.
   Si el mismo dato se cambió en otro aparato después, se queda el más reciente. */
function guardarPresupuesto(req) {
  const sh = hoja(HOJAS.presupuestos);
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, CAB_PRESUP.length).setValues([CAB_PRESUP]).setFontWeight('bold').setBackground('#1f6f43').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  const v = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, CAB_PRESUP.length).getValues() : [];
  const pos = {};
  v.forEach(function (r, i) { pos[r[0] + '|' + r[1] + '|' + r[3]] = i; });
  const borrar = [];
  let cambiados = 0;
  (req.cambios || []).forEach(function (c) {
    const k = c.campana + '|' + c.fincaId + '|' + c.concepto;
    const i = pos[k];
    const ts = String(c.ts || new Date().toISOString());
    if (i !== undefined) {
      const prev = v[i][6] instanceof Date ? v[i][6].toISOString() : String(v[i][6] || '');
      if (prev && prev > ts) return; // ya hay un cambio más reciente
      if (c.valor === null || c.valor === '') { borrar.push(i + 2); cambiados++; return; }
      sh.getRange(i + 2, 1, 1, CAB_PRESUP.length).setValues([[c.campana, c.fincaId, c.finca, c.concepto, c.descripcion || '', c.valor, ts]]);
      cambiados++;
    } else if (c.valor !== null && c.valor !== '') {
      sh.appendRow([c.campana, c.fincaId, c.finca, c.concepto, c.descripcion || '', c.valor, ts]);
      pos[k] = sh.getLastRow() - 2;
      cambiados++;
    }
  });
  borrar.sort(function (a, b) { return b - a; }).forEach(function (n) { sh.deleteRow(n); });
  return { ok: true, cambiados: cambiados, presupuestos: leerPresupuestos() };
}

/* Parámetros: se reescribe la pestaña entera. */
function guardarParametros(req) {
  const sh = hoja(HOJAS.parametros);
  sh.clear();
  sh.getRange(1, 1, 1, CAB_PARAM.length).setValues([CAB_PARAM]).setFontWeight('bold').setBackground('#1f6f43').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  const rows = (req.parametros || []).map(function (p) { return [p.clave, p.valor, p.descripcion || '']; });
  if (rows.length) sh.getRange(2, 1, rows.length, CAB_PARAM.length).setValues(rows);
  sh.autoResizeColumns(1, CAB_PARAM.length);
  return { ok: true, parametros: leerParametros() };
}
