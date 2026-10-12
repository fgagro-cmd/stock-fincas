/**
 * Stock Fincas · receptor para Google Sheets
 *
 * Recibe de la app el estado completo y lo refleja en estas pestañas:
 *   Salidas  -> registro de campo, mismas columnas y orden que tu Excel de Gestión de fincas
 *   Entradas -> compras y correcciones de inventario
 *   Stock    -> stock, precio medio y valor por producto
 *   _copia   -> copia completa para poder restaurar la app (oculta; no tocar)
 *
 * IMPORTANTE: la hoja es un espejo. La app reescribe estas pestañas en cada envío,
 * así que no escribas dentro de ellas. Para tus cálculos copia los datos a otra pestaña u otro archivo.
 */

const CLAVE = 'CAMBIA-ESTA-CLAVE'; // debe ser idéntica a la que escribes en la app (Ajustes)

const HOJAS = { salidas: 'Salidas', entradas: 'Entradas', stock: 'Stock', copia: '_copia' };
const CAB_SALIDAS = ['Fecha', 'Descripción', 'Campaña', 'Categoria', 'Tipo', 'Tipo 2', 'Finca', 'Cantidad', 'Precio', 'Importe'];
const CAB_ENTRADAS = ['Fecha', 'Producto', 'Categoría', 'Cantidad', 'Precio unit.', 'Importe'];
const CAB_STOCK = ['Producto', 'Categoría', 'Stock', 'Precio medio', 'Valor'];

function doGet() {
  return salida({ ok: true, mensaje: 'Stock Fincas: receptor activo' });
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

function hoja(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

function aFecha(iso) {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.parseDate(iso, tz, 'yyyy-MM-dd');
}

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

function sincronizar(req) {
  const salidas = (req.salidas || []).map(function (r) { const x = r.slice(); x[0] = aFecha(x[0]); return x; });
  const entradas = (req.entradas || []).map(function (r) { const x = r.slice(); x[0] = aFecha(x[0]); return x; });
  const stock = (req.stock || []).slice();
  stock.push(['TOTAL', '', '', '', req.total]);

  escribirTabla(HOJAS.salidas, CAB_SALIDAS, salidas, ['dd/mm/yyyy', null, '0', null, null, null, null, '#,##0.###', '#,##0.00####', '#,##0.00']);
  escribirTabla(HOJAS.entradas, CAB_ENTRADAS, entradas, ['dd/mm/yyyy', null, null, '#,##0.###', '#,##0.00####', '#,##0.00']);
  escribirTabla(HOJAS.stock, CAB_STOCK, stock, [null, null, '#,##0.###', '#,##0.00####', '#,##0.00']);
  guardarCopia(String(req.estado || ''), new Date().toISOString());

  return { ok: true, salidas: salidas.length, entradas: entradas.length, productos: stock.length - 1, fecha: new Date().toISOString() };
}

function guardarCopia(estado, fecha) {
  const sh = hoja(HOJAS.copia);
  sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['Copia automática de Stock Fincas (no editar ni borrar)', fecha]]);
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
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJAS.copia);
  if (!sh || sh.getLastRow() < 2) return { ok: false, error: 'sin copia' };
  const n = sh.getLastRow() - 1;
  const trozos = sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); });
  const f = sh.getRange(1, 2).getValue();
  return { ok: true, estado: trozos.join(''), fecha: f instanceof Date ? f.toISOString() : String(f) };
}
