# Cúbica 3D — Cierre local de integraciones de Etapa C

Fecha: 2026-10-27  
Alcance: código y pruebas locales; **sin conexión ni escritura en producción**

## Resultado ejecutivo

Las integraciones posibles quedaron completas localmente. La tienda conserva
Etapa C apagada por defecto y no llama a los 27 wrappers mientras 7B no esté
instalada. 7B v3 no fue modificada y conserva el hash aprobado.

## Cambios concretos

### Edge Function `site-assets`

- Conserva autenticación de usuario y autorización administrativa AAL2 mediante
  el RPC definitivo antes de tocar Storage.
- Valida tipo real, bytes, dimensiones, tamaño, clase de recurso, etiqueta y un
  `request_id` UUID generado por el navegador.
- Usa una ruta determinista formada por `request_id` y hash del contenido más
  sus metadatos. Un reintento idéntico reutiliza la misma identidad.
- Reconcilia primero el registro administrativo. Una respuesta de red ambigua
  ya no borra un objeto que podría haber sido registrado correctamente.
- Solo elimina el objeto ante un rechazo definitivo conciliado; los fallos
  ambiguos devuelven `registration_pending` y permiten reintentar.

### Edge Function `submit-suggestion`

- La Site Key sigue siendo pública; el secreto solo se lee en servidor.
- Valida hostname, acción `suggestion_submit`, antigüedad, uso único, IP,
  tamaño, categoría, longitudes e idempotencia.
- Admite correctamente visitantes cuyo cliente envía la clave pública de
  Supabase. Un bearer distinto se valida como sesión; no se acepta `user_id`
  del navegador.
- Exige que `SUGGESTION_RATE_LIMIT_SALT` sea base64url sin padding y decodifique
  al menos 32 bytes reales; deriva hashes separados para token, red y actor.
- Acepta los mapas administrados actuales `SUPABASE_PUBLISHABLE_KEYS` y
  `SUPABASE_SECRET_KEYS`, con compatibilidad explícita para los nombres
  heredados del runtime.
- Una falla de Siteverify impide llegar al RPC de escritura.

### Frontend

Se agregó un interruptor cerrado por defecto en `github-config.js`:

| Valor | Comportamiento |
|---|---|
| `off` | Oculta toda Etapa C y no llama ningún RPC nuevo. |
| `admin` | Habilita solo Configuración para administrador AAL2. |
| `full` | Habilita experiencia pública, páginas, FAQ y sugerencias además del panel. |

Un valor ausente o inválido se interpreta como `off`. La navegación directa a
Configuración también se rechaza. La subida visual conserva el mismo
`request_id` durante errores y lo rota si el formulario cambia.

## Matriz local de seguridad

| Identidad | Contrato esperado | Resultado |
|---|---|---|
| Visitante | 3 lectores y sugerencia protegida tras 7B; sin admin | APROBADO local |
| Cliente autenticado | Igual lectura; identidad de sugerencia derivada del JWT | APROBADO local |
| Administrador AAL1 | Sin operaciones administrativas | APROBADO PostgreSQL aislado |
| Administrador AAL2 | 22 operaciones administrativas | APROBADO PostgreSQL aislado |
| `service_role` | Solo las 2 rutas internas; nunca en navegador | APROBADO PostgreSQL aislado |

La validación local de 7A/7B cubre creación, edición, publicación,
restauración, soft-delete, aislamiento de borradores, Storage y ACL. Las suites
de 4A–5C conservan idempotencia y concurrencia ya probadas. No se repitieron
pruebas históricas no afectadas.

## Archivos modificados o añadidos

- `github-config.js`, `index.html`, `js/ui-shell.js` y
  `js/site-experience.js`: interruptor y activación progresiva.
- `supabase/functions/site-assets/worker.js`: identidad determinista,
  idempotencia y conciliación ante respuestas ambiguas.
- `supabase/functions/submit-suggestion/worker.js`: invitado con clave pública
  y requisito mínimo del salt.
- `tests/stage-c-5b-v3-edge-contract.test.mjs`,
  `tests/site-configuration-stage-c.test.mjs` y
  `tests/stage-c-final-integration.test.mjs`: contratos y regresiones.
- `supabase/activation/stage_c_suggestion_protection_cron.sql` y su rollback:
  cron preparado, no aplicado.
- `supabase/verification/stage_c_suggestion_retention_preview.sql`: conteo de
  candidatos, solo lectura.
- este informe y el runbook de activación controlada.

## Pruebas ejecutadas

`pnpm test` terminó con código 0. Incluyó la regresión de presupuestos, UI,
Etapas A/B/C, PostgreSQL 17.5 aislado, contratos Edge, 7A/7B y 31 controles
estáticos/dinámicos de Etapa C. La prueba nueva verificó:

- subida visual exitosa con ruta determinista;
- reintento idempotente sin segunda subida;
- respuesta de registro perdida sin borrado destructivo;
- visitante con clave pública tratado como invitado, no como sesión inválida;
- modo `off` sin una sola llamada RPC;
- separación visual entre `off`, `admin` y `full`.

Además aprobaron los cuatro chequeos de sintaxis JavaScript y el hash de 7B.
No hubo llamadas a producción ni residuos QA.

Limitaciones declaradas:

- PostgreSQL local es 17.5 y producción informada es 17.11;
- las pruebas multisesión históricas que PGlite no puede representar siguen
  identificadas como no ejecutadas, no como aprobadas;
- Turnstile, API Gateway, Storage y Edge Runtime reales requieren el despliegue
  autorizado posterior;
- responsive móvil tiene validación estructural/CSS, pero el smoke visual real
  en ~390 px queda para el frontend desplegado.

## Limpieza y privacidad propuesta

La limpieza no destructiva de protección queda preparada para ejecutarse cada
hora, en el minuto 17:

- hashes de tokens: vencen a las 24 horas y se purgan después del vencimiento;
- hashes de rate limit: se purgan 48 horas después de la última actualización,
  siempre que el bloqueo ya haya vencido.

Política de información personal propuesta —requiere aprobación antes de crear
una migración destructiva—:

- contacto: poner en `NULL` 90 días después de `resolved`/`dismissed`, o a los
  365 días desde la recepción si nunca llegó a estado terminal;
- notas privadas: vaciar 180 días después del estado terminal, o a los 730 días
  desde la recepción;
- sugerencias eliminadas lógicamente: después de 365 días, anonimizar asunto,
  descripción y vínculo de usuario, preservando ID, categoría, estado, fechas,
  revisiones y auditoría mínima;
- historial administrativo: conservar operación, fechas, revisiones y campos
  cambiados por 5 años; prohibir datos personales en `reason`. Antes de vencer,
  retirar contenido libre del motivo y seudonimizar al actor mediante una
  migración específica si Diego aprueba esa política.

Estos plazos son una propuesta operativa de minimización, no asesoramiento
legal. El script de vista previa solo cuenta candidatos; no modifica filas.
La anonimización debe ejecutarse en lotes transaccionales, con exportación
cifrada previa, conteos, muestreo, auditoría y autorización separada. Si falla
antes del commit se usa `ROLLBACK`; después del commit, restaurar datos
personales desde el respaldo requiere aprobación explícita.

## Dependencias externas pendientes

| Requisito | Estado |
|---|---|
| `TURNSTILE_SECRET_KEY` | Confirmar/configurar en Edge Secrets, sin leer su valor |
| `SUGGESTION_RATE_LIMIT_SALT` | Generar al menos 32 bytes aleatorios, codificar base64url sin padding y configurar una sola vez |
| Variables automáticas de Supabase | Confirmar presencia de URL, clave pública y clave servidor |
| Edge Functions | Código listo; no desplegadas |
| Siteverify real | Pendiente; la suite usa simulación controlada |
| Cron | SQL listo; no programado |
| 7B v3 | Listo localmente; no instalado |
| Frontend | Integrado y apagado; no publicado |
| Textos/retención | Requieren aprobación humana |

## 7B v3

- Archivo: `20261025120300_stage_c_api_storage_activation_v3.sql`
- SHA-256: `AD3FE8FDE86F4C3E5B28F9CD3C1220DC2FBB1295811E3D80584F6EE4F57C1AD8`
- Cambio durante esta tarea: ninguno.
- Contrato revalidado: 3 lectores públicos mínimos, 22 operaciones AAL2 y 2
  rutas internas `service_role`; 13 tablas privadas con RLS; bucket privado y
  lectura de objetos solo cuando están publicados.

## Bloqueadores reales para activar Etapa C

1. Aprobar la política de retención.
2. Configurar los dos secretos propios y confirmar variables administradas.
3. Desplegar ambas Edge Functions todavía con frontend `off`.
4. Autorizar el preflight e instalación exclusiva de 7B.
5. Autorizar el cron y una única sugerencia QA para Siteverify real.
6. Aprobar textos públicos y activar progresivamente `admin` → `full`.

El procedimiento exacto está en
`docs/STAGE_C_CONTROLLED_ACTIVATION_RUNBOOK_20261027.md`.

`DATABASE_WRITE=NONE`  
`PRODUCTION_CONNECTIONS=0`  
`DEPLOYMENTS=0`  
`SECRETS_CONFIGURED=0`
