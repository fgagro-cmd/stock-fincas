# Stock Fincas

App de stock, entradas y salidas de las fincas propias (PWA para Android, funciona sin conexión).

## Publicar (GitHub Pages)
Settings → Pages → rama `main`, carpeta `/ (root)`. Después abrir la dirección en Chrome del móvil → ⋮ → «Instalar aplicación».

## Copia automática en Google Sheets (opcional)
1. Crea una hoja de Google nueva (por ejemplo «Stock Fincas»).
2. Extensiones → Apps Script. Borra lo que haya, pega el contenido de `google-sheets/Codigo.gs` y cambia `CAMBIA-ESTA-CLAVE` por una clave larga propia. Guarda.
3. Implementar → Nueva implementación → tipo «Aplicación web» → Ejecutar como: **Yo** → Quién tiene acceso: **Cualquier usuario** → Implementar. Autoriza los permisos y copia la dirección (termina en `/exec`).
4. En la app: Ajustes → Copia automática en Google Sheets → pega la dirección y la clave → «Probar y activar».

La hoja es un espejo de un solo sentido: la app reescribe las pestañas Salidas, Entradas y Stock en cada envío. La clave nunca se sube a GitHub: se guarda solo en el móvil y en el script de tu hoja.

## Actualizaciones
Al cambiar cualquier fichero, sube `VERSION` en `sw.js` para que los móviles recojan la nueva versión.
