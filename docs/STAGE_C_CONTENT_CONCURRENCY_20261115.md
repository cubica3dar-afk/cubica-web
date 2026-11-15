# QA final y concurrencia real — 15/11/2026

Rama fix/stage-c-content-local-controls. Base funcional 531129f3a8305908f0490a13f70924a1d0d83d3d más ajuste responsive aprobado. No cambió lógica JavaScript durante esta validación final. Evidencia incorporada al commit local final mediante amend autorizado.

## Entorno y evidencia

PostgreSQL portable 17.12, clúster nuevo outputs/pg17-qa/run-iBtX0i/data, puerto 56855, escucha exclusivamente 127.0.0.1. Dos conexiones independientes (PID 27900 y 26480) y una tercera observadora. SCRAM con contraseña aleatoria por ejecución. Servidor apagado al finalizar.

Cada carrera mantiene abierta la primera transacción, inicia la segunda consulta y comprueba wait_event_type=Lock y pg_blocking_pids antes del COMMIT. No son operaciones secuenciales presentadas como simultáneas.

| Carrera | Resultado verificado |
|---|---|
| Ediciones simultáneas de Contenidos | 40001 para la versión obsoleta; título ganador y versión 2 conservados |
| Publicación simultánea del mismo borrador sintético | Ambas respuestas refieren al mismo ID; una sola versión publicada |
| Ediciones simultáneas de FAQ | 40001; permanece la pregunta ganadora |
| Creación de FAQ duplicadas normalizando espacios/mayúsculas | 23505; una sola fila |
| Ediciones simultáneas de Frases | 40001; permanece el texto ganador |
| Creación de Frases duplicadas | 23505; una sola fila |

Resultado global PASS. Publicaciones exclusivamente sintéticas en el clúster local. Funciones SQL existentes cargadas sin modificaciones; bootstrap y tablas auxiliares aisladas, no copia de datos productivos.

Artefactos locales ignorados por Git: outputs/pg17-qa/content-concurrency.mjs, outputs/content-concurrency-result.log, outputs/pg17-qa/run-iBtX0i/result.json. Reproducir desde la raíz del checkout con node outputs/pg17-qa/content-concurrency.mjs si se conserva la distribución portable en outputs/pg17-qa/pgsql. Cada ejecución crea un clúster nuevo.

## Regresión y alcance

pnpm test final: 23 scripts, salida 0 (outputs/content-final-suite.log). Los mensajes NO EJECUTADA de los scripts PGlite corresponden a sus propios escenarios multisesión; esta prueba independiente cubre solo las seis carreras indicadas. QA visual/funcional manual confirmada por el usuario. git diff --check aprobado.

Diff contra main limitado al JS de controles, CSS responsive FAQ/Frases, referencias de caché site-stage-c5, incorporación de pruebas al comando test, pruebas focalizadas y documentación. Sin cambios SQL, lockfile, credenciales, configuración de etapa, datos, Edge Functions ni automatizaciones de despliegue.

## Limitaciones restantes

- Autenticación simulada. No valida JWT/PostgREST/RLS end-to-end ni dos navegadores autenticados reales.
- No prueba carga, restauración contra eliminación concurrente, reasignación de frases contra retiro de campaña ni todos los órdenes posibles de intercalación.
- Recuperación de solicitudes ambiguas no durable entre cierres de pestaña/pérdida de sesión. Sin coincidencia exacta única, el frontend mantiene bloqueo en lugar de reintentar a ciegas. La coincidencia de contenido no demuestra autoría de una creación.
- El CSS utiliza :has, validado en Chrome actual; no se validaron navegadores antiguos.
- No hubo lecturas ni escrituras a Supabase productivo durante esta tarea. Las doce frases reales y las cuatro páginas quedaron fuera de todas las operaciones.

Recomendación: listo para revisión de publicación de rama/Draft PR, sujeta a autorización independiente. No autoriza integración, despliegue o escrituras productivas.
