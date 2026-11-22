# FAQ y Frases: ajuste responsive local

Rama: fix/stage-c-content-local-controls. Base: 531129f3a8305908f0490a13f70924a1d0d83d3d.

El título y las herramientas competían por ancho dentro de una cabecera flex horizontal. Se añade una regla hasta 600 px, limitada a las cabeceras que contienen #faq-search o #phrase-search: título en una fila, herramientas debajo y columnas minmax(0,1fr) / 90px. No se cambian JavaScript, RPC, CSS de escritorio ni selectores de Estética/Campañas/Contenidos.

Verificación local el 15/11/2026: Chrome headless con perfil independiente, datos sintéticos y CSP connect-src none. Se inspeccionaron cuatro capturas (FAQ/Frases, 390/1280 px) y medidas DOM:

- 390 px: ambos buscadores 244 px, selector 90 px, cabecera column, sin desbordamiento horizontal del documento.
- 1280 px: buscadores 180 px, selector 95 px, cabecera row, sin desbordamiento horizontal.
- El alcance de selectores excluye el formulario de páginas de Contenidos y demás controles administrativos; no se realizó una nueva QA integral de esos módulos.
- git diff --check aprobado. No se repite la suite funcional porque no cambió lógica.

Capturas y medidas en outputs/content-{faq,phrase}-{390,1280}.png y outputs/content-responsive-measurements.json (ignorados por Git).

Servidor QA http://127.0.0.1:4176: JavaScript del commit base, CSS del working tree para revisar este ajuste. La etiqueta del commit en la portada identifica el JS base, no un commit del CSS nuevo. Recargar antes de revisar; restablece los datos sintéticos.

QA manual aceptada por el usuario el 15/11/2026, incluidos los buscadores a 390 px. Ajuste incorporado al commit local por autorización posterior. Sin push, PR, merge, despliegue o acceso a Supabase.
