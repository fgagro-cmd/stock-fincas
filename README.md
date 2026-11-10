# Gestión fincas (antes Stock Fincas)

App de las fincas propias: stock, entradas y actividad (registro de campo: gastos, tareas e ingresos), para el móvil Android. Funciona sin conexión.

**El código no lleva datos** (el repositorio es público). En un móvil nuevo la app empieza vacía y se restaura desde la hoja de Google («Restaurar desde la hoja») o desde un fichero de copia (Ajustes → «Restaurar desde fichero»). El stock de partida del Excel está guardado como copia en Drive › Apps › Copia de seguridad.

## Maestros de fincas y productos
Cada producto y finca queda enlazado a su ficha del maestro (P008, F004…), con el nombre y la categoría del maestro. Las categorías con stock son Fertilizantes, Fitosanitarios, Herbicidas y Bioestimulantes.
- El primer enlace, los cambios de categoría y unir productos repetidos se enseñan antes de aplicarse.
- Las fincas propias del maestro (Propia = Sí) aparecen solas al anotar una salida.
- Un producto nuevo que no esté en el maestro se crea aquí y se pide su alta: entra en el maestro con «Revisar = Sí» (amarillo). Sin conexión queda en cola.
- Configuración: Ajustes → Maestros → dirección y clave del script de maestros (el mismo de Ventas).

## Entradas automáticas desde Ventas
Las ventas a tus fincas (cliente propio) de la app Ventas entran solas como entradas, al precio de la venta, desde la fecha que elijas. Lo que ya anotaste a mano (mismo producto y cantidad, ±7 días) se enlaza y no se duplica. Si la venta cambia o se borra en Ventas, la entrada se actualiza o se quita. Configuración: Ajustes → Entradas automáticas desde Ventas → dirección y clave del script de la hoja de Ventas.

## Publicar (GitHub Pages)
Settings → Pages → rama `main`, carpeta `/ (root)`. Después abrir la dirección en Chrome del móvil → ⋮ → «Instalar aplicación».

## Actividad
Cada registro es un gasto, una tarea o un ingreso. Los gastos de productos con stock necesitan producto y cantidad. El resto admite solo el total (por ejemplo, la liquidación de una cosecha, con cantidad 0) o solo la cantidad (por ejemplo, los kilos recogidos, con importe 0), y cantidades negativas para descuentos o ajustes.

## Organización (tareas pendientes)
Pestaña «Organización» (desde la v2.6.0): lo que hay que hacer en las fincas en las próximas semanas. Cada tarea lleva: tarea, tipo (los de Tarea de Actividad), quién la hace (con maquinaria, sin maquinaria o contratado), finca, prioridad (Alta, Media, Baja), fecha límite, horas previstas, estado (Pendiente o Empezada con su %) y nota.
- Lista ordenada: primero las vencidas (en rojo), luego por prioridad y fecha límite. Filtros por finca y prioridad. Arriba: nº de tareas, vencidas, empezadas y horas por delante (horas previstas menos lo ya avanzado).
- Al terminarla: ábrela → «Terminada → pasar a Actividad». Se abre el registro de Actividad ya relleno (hoy, finca, tipo, quién, descripción, horas previstas y el precio por hora del último registro igual); se corrigen las horas reales y se guarda. Solo entonces la tarea desaparece de Organización. Si cierras sin guardar, sigue pendiente.
- Las tareas no cuentan en las cuentas ni en el stock. Viajan con los datos (copia en fichero y pestaña _copia de la hoja), pero no tienen pestaña propia en la hoja.

## Buscar (y Excel de contabilidad)
Pestaña «Buscar» (desde la v2.5.0; sustituye a «Exportar»): busca en todos los registros, del histórico del Excel a hoy. Casilla de texto (descripción, producto, tipo, finca, fecha, campaña o importe; sin tildes ni mayúsculas; tienen que aparecer todas las palabras) y filtros de campaña, mes, finca, tipo y categoría. Cada registro se abre y se corrige como en Actividad. Muestra cuántos hay y la suma de gastos, tareas e ingresos (y la cantidad si filtras por un tipo).

«Excel» y «Compartir» sacan todo lo encontrado con las columnas Fecha, Descripción, Categoría, Tipo 1, Tipo 2, Finca, Cantidad, Importe (precio por unidad) y Total. Para el Excel de una finca y un mes, elige esa finca y ese mes. Las líneas con solo total dejan vacíos Cantidad e Importe. El Excel se genera en el móvil (`xlsx.js`, sin librerías externas), así que funciona sin conexión.

## Histórico del Excel
Las 1.464 líneas del Excel Gestion_de_fincas_3.0 (sept. 2021 – sept. 2026) se cargan una vez desde Ajustes → «Cargar histórico del Excel» con el fichero de Drive › Apps › Copia de seguridad (`gestion-fincas-historico-excel.json`). Entran como registros «histórico»: no mueven el stock, se pueden corregir y salen en la Tabla principal y en la pestaña Actividad. Cargarlo otra vez solo añade lo que falte. Todos los tipos van con tilde (Fumigación, Subvención, Estiércol, Enmienda orgánica).

Desde la v2.4.0 hay un tipo de gasto «Seguro». Al abrir la versión nueva, los gastos «Seguro Chelo» y «Seguro Francis» pasan solos de «Otros» a «Seguro» (también al cargar el histórico o restaurar una copia antigua).

## Copia automática en Google Sheets
1. Crea una hoja de Google nueva (por ejemplo «Stock Fincas»).
2. Extensiones → Apps Script. Borra lo que haya, pega el contenido de `google-sheets/Codigo.gs` y cambia `CAMBIA-ESTA-CLAVE` por una clave larga propia. Guarda.
3. Implementar → Nueva implementación → tipo «Aplicación web» → Ejecutar como: **Yo** → Quién tiene acceso: **Cualquier usuario** → Implementar. Autoriza los permisos y copia la dirección (termina en `/exec`).
4. En la app: Ajustes → Copia automática en Google Sheets → pega la dirección y la clave → «Probar y activar».

Para **actualizar** el script sin cambiar la dirección: pega el código nuevo → Guardar → Implementar → Gestionar implementaciones → lápiz → Versión: «Nueva versión» → Implementar. Si pide permisos (lee el «Maestro de fincas» de tu Drive), acéptalos.

**Permiso de Drive** (para que Cuentas fincas lea superficie y árboles del «Maestro de fincas»):
1. Apps Script → ⚙ Configuración del proyecto → marca «Mostrar el archivo de manifiesto appsscript.json».
2. En el editor abre `appsscript.json` y deja el contenido de `google-sheets/appsscript.json` → Guardar.
3. Si ejecutar no pide permiso (Google ya dio permisos parciales), pega esta función, ejecútala una vez y acepta el permiso de Drive:
   ```javascript
   function autorizarDrive() {
     ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ['https://www.googleapis.com/auth/drive.readonly']);
     Logger.log(JSON.stringify(fincasMaestro()));
   }
   ```
4. Implementar → Gestionar implementaciones → lápiz → «Nueva versión» → Implementar.

**Semanas (v2.8.0):** al apuntar una tarea, los botones «Esta semana», «La que viene» y «En 2 semanas» ponen como fecha límite el domingo de esa semana (semanas de lunes a domingo); «Otra fecha» abre el calendario. La lista se agrupa en Vencidas, Esta semana, La semana que viene, Dentro de 2 semanas, Más adelante y Sin fecha; dentro de cada grupo, por prioridad.

## Calendario (desde la v2.7.0)
Las tareas de **Organización** con fecha límite se copian solas a un calendario de Google llamado **«Fincas»**: un evento de todo el día por tarea, con aviso la víspera a las 8:00. Título: prioridad (🔴 Alta, 🟠 Media, 🟢 Baja) + tarea + finca (+ % si está empezada). Dentro: tipo, quién la hace, horas, estado y nota. Las tareas sin fecha no salen. Es de un solo sentido: manda la app (si cambias o borras un evento en Calendar, se rehace en el siguiente envío). Al terminar o borrar la tarea, el evento desaparece.

Para activarlo (una sola vez, en el mismo script de la hoja):
1. Apps Script → pega el nuevo `Codigo.gs` (conserva tu clave) → Guardar.
2. ⚙ Configuración del proyecto → marca «Mostrar el archivo de manifiesto appsscript.json» → abre `appsscript.json`, deja el contenido de `google-sheets/appsscript.json` (añade el permiso de Calendar) → Guardar.
3. Arriba, en el selector de funciones, elige `autorizarCalendario` → ▶ Ejecutar → acepta los permisos. Esto crea el calendario «Fincas».
4. Implementar → Gestionar implementaciones → lápiz → Versión: «Nueva versión» → Implementar.
5. En la app: Ajustes → Copia automática → «Sincronizar ahora». Debe poner «📅 Al día».
6. En la app de Calendar del móvil: ☰ → comprueba que «Fincas» está marcado. Ahí puedes ponerle el color que quieras.

En Ajustes se puede desactivar con el interruptor «Tareas de Organización en Google Calendar» (los eventos que ya existan se quedan).

La app reescribe las pestañas Tabla principal (todas las líneas con las 12 columnas de tu Excel, la más reciente arriba), Entradas y Stock en cada envío. La clave nunca se sube a GitHub: se guarda solo en el móvil y en el script de tu hoja.

## Cuentas fincas
La app Cuentas fincas usa esta misma hoja (misma dirección y clave): lee la Tabla principal y guarda los presupuestos y parámetros en las pestañas «Presupuestos» y «Parámetros», que esta app nunca toca.

## Actualizaciones
Al cambiar cualquier fichero, sube `VERSION` en `sw.js` para que los móviles recojan la nueva versión. Los datos del móvil se guardan con el nombre interno `stock-fincas`: no cambiarlo o se perderían.


## Tareas para la Vista única (2.9.0–2.9.1)
Al terminar una tarea de Organización queda un registro (semana prevista, día real y horas reales). La app manda a la hoja las pestañas **«Tareas»** (pendientes) y **«Tareas hechas»** para que la Vista única muestre las tareas de la semana y cómo se cumplen. Necesita el `Codigo.gs` nuevo (pegar, guardar y publicar una nueva versión de la implementación, como siempre).
