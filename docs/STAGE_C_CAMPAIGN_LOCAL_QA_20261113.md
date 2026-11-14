# Campañas — corrección local y QA, 2026-11-13

Base: main 951d49ee1df76f4abc2e5681cbe11dca73e2a98a (PR #4 integrado).
Rama local: fix/stage-c-campaign-local-controls.

## Comportamiento corregido

- Crear usa UUID; editar envía p_request_id=null, conserva ID/versión y tema no expuesto en el formulario. El backend sigue controlando el estado; la interfaz impide editar publicadas.
- Un guardado en curso bloquea otro envío. Si la respuesta es ambigua, el formulario conserva el payload completo y UUID: sólo puede reintentarse esa misma solicitud. Una nueva creación requiere el botón explícito, habilitado después de resolver el intento anterior.
- Un rechazo transaccional conocido permite corregir el formulario sin avanzar la versión esperada. Un conflicto 40001 nunca se reintenta automáticamente.
- Calendario/lista se actualizan sin reconstruir el formulario. Las pestañas conservan una copia en memoria. Renovar AAL2 para el mismo administrador conserva el intento; cambiar identidad/perder acceso limpia datos y descarta respuestas tardías.
- Publicar/programar requiere confirmación que explica exposición mediante RPC públicas incluso en admin. Cancelar no llama RPC.
- Custom requiere ocurrencias válidas y no exige Inicio/Fin. Anual usa mes/día/hora; un fin anterior o igual implica cruce de año. Se rechazan rangos únicos/custom invertidos, fechas inexistentes y ocurrencias idénticas.
- Calendario único/anual/custom en America/Argentina/Buenos_Aires, con fin exclusivo, cruces de mes/año y omisión completa de ocurrencias cuyo 29/02 no existe. No usa getDate/getMonth del huso del navegador.
- El calendario administrativo incluye estados identificados; no es un selector del ganador público. El ganador continúa resuelto exclusivamente por el backend.
- Las advertencias comparan el formulario actual con otras campañas publicadas en el mes visible; excluyen borradores, desactivadas y retiradas.
- Vista previa privada de logo/banner/fondo mediante URLs firmadas, sin publicar recursos. Respuestas obsoletas no reemplazan selecciones posteriores.
- Recursos JS/CSS pasan a site-stage-c4 en el HTML local para una futura publicación sin caché vieja.

## Verificación local

Pruebas focalizadas incorporadas a pnpm test:

- campaign-local-controls.test.mjs: 11 grupos de controles con DOM simulado y handlers reales; creación, edición, doble clic, reintentos, versiones, navegación, publicación cancelada, AAL, recursos, fechas y conservación de timestamps.
- campaign-calendar-timezone.test.mjs: mismo calendario/conversión en cuatro procesos TZ (UTC, Los Ángeles, Tokio, Buenos Aires), incluido un caso histórico DST de Buenos Aires.
- campaign-frontend-postgres17.test.mjs: handlers → funciones SQL existentes en PGlite PostgreSQL 17 aislado. Una creación confirmada cuya respuesta se pierde deja una sola fila después del replay. Edición custom, revisión obsoleta y AAL1. Calendario comparado con stage_c_active_campaign en 7 escenarios / 31 instantes.
- Suite completa pnpm test (21 scripts), incluidas regresiones existentes de Estética, bienvenida, autorización y componentes comerciales.
- node --check js/site-experience.js y revisión del diff.

No se instalaron dependencias ni se cambió el lockfile. Los SQL de fixtures se ejecutan exclusivamente en memoria, nunca con una conexión al proyecto Supabase.

## Límites y pendientes independientes

- Concurrencia real entre conexiones PostgreSQL: NO ejecutada. Sí se probaron doble clic del frontend, replay idempotente y conflicto de versiones secuencial.
- Responsive: contratos CSS y estructura accesible comprobados automáticamente. Queda pendiente QA visual manual en Chrome (escritorio/móvil), sin repetir automatizaciones fallidas.
- Los intentos pendientes se conservan en memoria de la pestaña, no en almacenamiento permanente. Se advierte al salir/recargar. Si se fuerza un cierre o el navegador falla, releer las campañas antes de iniciar otra creación; no recrear a ciegas. Recuperación durable entre reinicios sería una tarea adicional.
- Solapamientos: diagnóstico acotado al mes visible, expresamente indicado. No calcula un informe global infinito para recurrencias anuales.
- La vista previa muestra recursos seleccionados; no pretende reproducir íntegramente el sitio público ni resolver todos los recursos heredados.
- El calendario depende de la base IANA del navegador. Las reglas anuales se contrastan con SQL existente; una futura modificación del backend requiere actualizar estas pruebas. La visualización usa precisión de milisegundos de Date; timestamps originales no editados se preservan al guardar.
- Prueba productiva de crear/editar/retirar: pendiente de autorización independiente, siempre sin publicación.

## Alcance protegido y continuidad

No hubo llamadas productivas a Supabase, cambios de SQL/migraciones/Edge Functions/cron/secretos, ni modificaciones comerciales. github-config.js mantiene stageCMode admin. No se tocó bienvenida, borrador visual ID 7 v5 ni publicaciones visuales; esos valores son la línea base informada, no una nueva lectura productiva de esta tarea.

No hay push, PR, merge ni despliegue. Tras revisión y autorización, el siguiente paso recomendado es publicar esta rama y crear un Draft PR contra main, verificar nuevamente su base y mantener pendientes las pruebas manuales/productivas. No fusionar automáticamente.
