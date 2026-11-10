/**
 * Gestión fincas · receptor para Google Sheets (también sirve a la app Cuentas fincas)
 *
 * Pestañas que escribe la app Gestión fincas en cada envío (espejo; no escribas dentro):
 *   Tabla principal -> todas las líneas (histórico del Excel + lo nuevo), mismas 12 columnas que tu Excel,
 *                      la más reciente arriba. Para tu Excel: copia las columnas A–J y pégalas en su tabla.
 *   Entradas        -> compras y correcciones de inventario
 *   Stock           -> stock, precio medio y valor por producto
 *   Tareas          -> tareas pendientes de Organización (desde la 2.9.1), para la Vista única
 *   Tareas hechas   -> tareas terminadas: semana prevista, día real, en plazo y horas reales
 *   _copia          -> copia completa para poder restaurar la app (oculta; no tocar)
 *
 * Pestañas que escribe la app Cuentas fincas (sí puedes mirarlas; mejor cambiarlas desde la app):
 *   Presupuestos    -> lo que presupuestas por campaña, finca y concepto
 *   Parámetros      -> mano de obra propia (€/h) y reglas de arrendamiento de cada finca
 *
 * La superficie y el número de árboles de cada finca se leen del «Maestro de fincas» (Drive › Apps › Maestros).
 *
 * Calendario (desde la v2.7.0 de la app): las tareas de la pestaña «Organización» que tienen fecha límite se copian
 * a un calendario de Google propio llamado «Fincas» (un evento de todo el día por tarea, con aviso la víspera a las 8:00).
 * Es un espejo de un solo sentido: manda la app; si cambias o borras un evento en Calendar, se rehace en el siguiente envío.
 */

const CLAVE = 'CAMBIA-ESTA-CLAVE'; // debe ser idéntica a la que escribes en las apps (Ajustes)

const HOJAS = { tabla: 'Tabla principal', antigua: 'Salidas', entradas: 'Entradas', stock: 'Stock', copia: '_copia', presupuestos: 'Presupuestos', parametros: 'Parámetros' };
const CAB_TABLA = ['Fecha', 'Descripción', 'Campaña', 'Categoria', 'Tipo', 'Tipo 2', 'Finca', 'Cantidad', 'Precio', 'Importe', 'Mes', 'Año'];
const CAB_ENTRADAS = ['Fecha', 'Producto', 'Categoría', 'Cantidad', 'Precio unit.', 'Importe'];
const CAB_STOCK = ['Producto', 'Categoría', 'Stock', 'Precio medio', 'Valor'];
const CAB_PRESUP = ['Campaña', 'Finca ID', 'Finca', 'Concepto', 'Descripción', 'Valor', 'Actualizado'];
const CAB_PARAM = ['Clave', 'Valor', 'Descripción'];
const CAL_NOMBRE = 'Fincas';
const CAL_AVISO_MIN = 960; // minutos antes de las 00:00 del día límite: 16 h = la víspera a las 8:00
const PRIO_ICONO = { Alta: '🔴', Media: '🟠', Baja: '🟢' };
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
  if (filas.length <= 300) sh.autoResizeColumns(1, cabecera.length); // en tablas grandes es lento
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
  if (Array.isArray(req.tareasTabla)) {
    escribirTabla('Tareas', ['Semana (domingo)', 'Tipo', 'Quién', 'Prioridad', 'Tarea', 'Finca', 'Horas previstas', 'Estado', '% avance', 'Apuntada', 'ID tarea'],
      req.tareasTabla.map(function (r) { const x = r.slice(); if (x[0]) x[0] = aFecha(x[0]); if (x[9]) x[9] = aFecha(x[9]); return x; }),
      ['dd/mm/yyyy', null, null, null, null, null, '#,##0.0', null, '0', 'dd/mm/yyyy', null]);
  }
  if (Array.isArray(req.hechasTabla)) {
    escribirTabla('Tareas hechas', ['Hecha', 'Semana prevista (domingo)', 'En plazo', 'Tipo', 'Quién', 'Prioridad', 'Tarea', 'Finca', 'Horas previstas', 'Horas reales', 'Apuntada', 'ID tarea'],
      req.hechasTabla.map(function (r) { const x = r.slice(); [0, 1, 10].forEach(function (i) { if (x[i]) x[i] = aFecha(x[i]); }); return x; }),
      ['dd/mm/yyyy', 'dd/mm/yyyy', null, null, null, null, null, null, '#,##0.0', '#,##0.0', 'dd/mm/yyyy', null]);
  }
  guardarCopia(String(req.estado || ''), new Date().toISOString());

  // La pestaña «Salidas» era el espejo antiguo: la sustituye «Tabla principal».
  const vieja = libro().getSheetByName(HOJAS.antigua);
  if (vieja) libro().deleteSheet(vieja);

  const res = { ok: true, lineas: tabla.length, entradas: entradas.length, productos: stock.length - 1, fecha: new Date().toISOString() };
  // El calendario va el último y aparte: si falla (por ejemplo, falta el permiso), la hoja ya está guardada.
  if (Array.isArray(req.tareas)) {
    try { res.calendario = sincronizarCalendario(req.tareas); }
    catch (err) { res.calendario = { ok: false, error: String((err && err.message) || err) }; }
  }
  return res;
}

/* ---------- Calendario «Fincas» ---------- */
function calendarioFincas() {
  const propios = CalendarApp.getCalendarsByName(CAL_NOMBRE).filter(function (c) { return c.isOwnedByMe(); });
  if (propios.length) return propios[0];
  return CalendarApp.createCalendar(CAL_NOMBRE, { timeZone: Session.getScriptTimeZone(), summary: 'Tareas pendientes de Gestión fincas (las escribe la app; no edites aquí)' });
}

function textoTarea(t) {
  const l = [];
  l.push('Tarea: ' + t.titulo);
  l.push('Tipo: ' + t.tipo + (t.quien ? ' · ' + t.quien : ''));
  l.push('Finca: ' + t.finca);
  l.push('Prioridad: ' + t.prioridad);
  if (t.horas > 0) l.push('Horas previstas: ' + t.horas + ' h');
  l.push('Estado: ' + (t.estado === 'Empezada' ? 'Empezada ' + (t.pct || 0) + ' %' : 'Pendiente'));
  if (t.nota) l.push('Nota: ' + t.nota);
  l.push('');
  l.push('Escrito por Gestión fincas. No lo cambies aquí: manda la app.');
  l.push('[gf:' + t.id + ']');
  return l.join('\n');
}

function sincronizarCalendario(tareas) {
  const cal = calendarioFincas();
  const zona = Session.getScriptTimeZone();
  const ahora = Date.now();
  const existentes = {};
  cal.getEvents(new Date(ahora - 730 * 864e5), new Date(ahora + 730 * 864e5)).forEach(function (ev) {
    const m = /\[gf:([^\]]+)\]/.exec(ev.getDescription() || '');
    if (m) (existentes[m[1]] = existentes[m[1]] || []).push(ev);
  });

  const quiero = {};
  let creados = 0, cambiados = 0, borrados = 0;
  tareas.forEach(function (t) {
    if (!t || !t.id || !t.limite) return; // sin fecha límite no hay evento
    quiero[t.id] = true;
    const titulo = (PRIO_ICONO[t.prioridad] || '') + ' ' + t.titulo + ' · ' + t.finca + (t.estado === 'Empezada' && t.pct > 0 ? ' · ' + t.pct + ' %' : '');
    const desc = textoTarea(t);
    const dia = Utilities.parseDate(String(t.limite), zona, 'yyyy-MM-dd');
    const evs = existentes[t.id] || [];
    evs.slice(1).forEach(function (x) { x.deleteEvent(); borrados++; }); // duplicados (por si acaso)
    if (!evs.length) {
      const ev = cal.createAllDayEvent(titulo, dia, { description: desc });
      ev.removeAllReminders();
      ev.addPopupReminder(CAL_AVISO_MIN);
      creados++;
      return;
    }
    const ev = evs[0];
    let tocado = false;
    if (ev.getTitle() !== titulo) { ev.setTitle(titulo); tocado = true; }
    if (ev.getDescription() !== desc) { ev.setDescription(desc); tocado = true; }
    const mismoDia = ev.isAllDayEvent() && Utilities.formatDate(ev.getAllDayStartDate(), zona, 'yyyy-MM-dd') === t.limite;
    if (!mismoDia) {
      if (ev.isAllDayEvent()) ev.setAllDayDate(dia);
      else { ev.deleteEvent(); const nuevo = cal.createAllDayEvent(titulo, dia, { description: desc }); nuevo.removeAllReminders(); nuevo.addPopupReminder(CAL_AVISO_MIN); }
      tocado = true;
    }
    if (tocado) cambiados++;
  });

  Object.keys(existentes).forEach(function (id) {
    if (!quiero[id]) existentes[id].forEach(function (ev) { ev.deleteEvent(); borrados++; });
  });
  return { ok: true, eventos: Object.keys(quiero).length, creados: creados, cambiados: cambiados, borrados: borrados };
}

/* Ejecútala una vez desde el editor (▶) para dar el permiso de Calendar y crear el calendario «Fincas». */
function autorizarCalendario() {
  const c = calendarioFincas();
  Logger.log('Calendario listo: ' + c.getName());
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
