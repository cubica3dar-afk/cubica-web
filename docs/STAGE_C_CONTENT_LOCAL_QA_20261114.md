# Contenidos, FAQ y Frases: correcciones locales

Actualización final 15/11/2026: QA manual funcional y responsive aprobada por el usuario, incluida recuperación histórica. Regresión final de 23 scripts aprobada. Concurrencia real ejecutada por separado: ver STAGE_C_CONTENT_CONCURRENCY_20261115.md. Las menciones de pendientes en el informe inicial de abajo describen el estado anterior a esta actualización.

Base: main 9006abbaf3b3cf5a088b2951d5b0b2fffc8e5392.
Rama: fix/stage-c-content-local-controls. Sin cambios de backend.

## Contratos y correcciones

- FAQ y Frases envían siempre p_active booleano explícito. Nuevas: false. El SQL de FAQ usa false para null; Frases usa true para null en creación. No se omite este argumento ni se depende del default del servidor.
- Activar o guardar contenido activo requiere confirmación sobre exposición por RPC públicas; cancelar no envía RPC. Guardar inactivo no activa. Los botones de lista conservan versiones esperadas.
- Publicar páginas requiere coincidencia de formulario, versión y borrador persistido; la confirmación identifica título y versión. No publica los cambios locales sin guardar.
- Formularios conservados en memoria por página y por tipo de registro, incluso ante recargas administrativas. Reemplazar el formulario mediante Editar o Nuevo registro requiere confirmación cuando contiene texto.
- Exclusión de envíos simultáneos compartida entre estos tres módulos; campos bloqueados durante operaciones o incertidumbre. No se añaden parámetros RPC.
- Respuesta ambigua: la siguiente acción realiza solo admin_get_site_configuration. Si hay una coincidencia exacta única, adopta ID/versión; no vuelve a escribir. Si no puede conciliar, permanece bloqueada. Esto no es idempotencia transaccional ni prueba de autoría del registro coincidente.
- Conflictos 40001 no avanzan versiones ni se reintentan automáticamente. FAQ y Frases mantienen las validaciones y restricciones SQL existentes.
- Paginación acotada a resultados actuales. Recursos HTML apuntan a site-stage-c5 para una eventual publicación futura; el único cambio en el test de Estética es esa referencia.

## Validación

pnpm test aprobado: 23 scripts, incluidos los 21 existentes y content-local-controls / stage-c-5a-v2-postgres17. Tests aislados, sin conexiones productivas. Sintaxis JS y git diff --check aprobados.

La cobertura nueva usa handlers reales y DOM/RPC simulados: creación inactiva, confirmaciones, cancelación, edición pública, borradores por página, recarga, filtros, descarte cancelado, paginación, doble envío, respuesta perdida, conciliación FAQ/Frases, duplicados y AAL1. Pruebas SQL existentes cubren validaciones, versiones y Markdown. No se ejecutó concurrencia real multisesión para estos módulos.

## Límites y QA manual pendiente

- No hay recuperación durable tras cerrar pestaña o perder autenticación; se advierte antes de salir con una operación pendiente. Releer registros antes de crear otra vez.
- Una creación incierta sin coincidencia exacta permanece bloqueada: no se puede demostrar que una petición original tardía no vaya a terminar. Requiere revisión antes de reiniciar. Publicación/restauración/retiro ambiguos tampoco se reenvían automáticamente.
- No se incorpora interfaz de restauración de FAQ ni retiro de páginas; no se amplía el contrato backend.
- Proponer servidor local aislado con los JS/CSS de esta rama y datos sintéticos: cuatro páginas, FAQ/frases activas e inactivas, suficientes filas para paginación. Bloquear conexiones externas. Probar escritorio y 390 px, Contacto, navegación entre pestañas/páginas, activación cancelada, publicación sucia bloqueada, respuesta perdida y conflicto. La aprobación visual sigue pendiente.
- Ningún cambio a las frases legítimas 12–23, bienvenida, apariencia, campañas, datos comerciales, Supabase, SQL o Edge Functions. Sin push, PR o despliegue. Publicar la rama y cualquier QA productiva requieren autorización independiente.
