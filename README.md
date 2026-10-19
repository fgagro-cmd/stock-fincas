# Gestión fincas (antes Stock Fincas)

App de las fincas propias: stock, entradas y salidas (registro de campo), para el móvil Android. Funciona sin conexión.

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

## Histórico del Excel
Las 1.464 líneas del Excel Gestion_de_fincas_3.0 (sept. 2021 – sept. 2026) se cargan una vez desde Ajustes → «Cargar histórico del Excel» con el fichero de Drive › Apps › Copia de seguridad (`gestion-fincas-historico-excel.json`). Entran como registros «histórico»: no mueven el stock, se pueden corregir y salen en la Tabla principal. Cargarlo otra vez solo añade lo que falte. Todos los tipos van con tilde (Fumigación, Subvención, Estiércol, Enmienda orgánica).

## Copia automática en Google Sheets
1. Crea una hoja de Google nueva (por ejemplo «Stock Fincas»).
2. Extensiones → Apps Script. Borra lo que haya, pega el contenido de `google-sheets/Codigo.gs` y cambia `CAMBIA-ESTA-CLAVE` por una clave larga propia. Guarda.
3. Implementar → Nueva implementación → tipo «Aplicación web» → Ejecutar como: **Yo** → Quién tiene acceso: **Cualquier usuario** → Implementar. Autoriza los permisos y copia la dirección (termina en `/exec`).
4. En la app: Ajustes → Copia automática en Google Sheets → pega la dirección y la clave → «Probar y activar».

Para **actualizar** el script sin cambiar la dirección: pega el código nuevo → Guardar → Implementar → Gestionar implementaciones → lápiz → Versión: «Nueva versión» → Implementar. Si pide permisos (lee el «Maestro de fincas» de tu Drive), acéptalos.

La app reescribe las pestañas Tabla principal (todas las líneas con las 12 columnas de tu Excel, la más reciente arriba), Entradas y Stock en cada envío. La clave nunca se sube a GitHub: se guarda solo en el móvil y en el script de tu hoja.

## Cuentas fincas
La app Cuentas fincas usa esta misma hoja (misma dirección y clave): lee la Tabla principal y guarda los presupuestos y parámetros en las pestañas «Presupuestos» y «Parámetros», que esta app nunca toca.

## Actualizaciones
Al cambiar cualquier fichero, sube `VERSION` en `sw.js` para que los móviles recojan la nueva versión. Los datos del móvil se guardan con el nombre interno `stock-fincas`: no cambiarlo o se perderían.
