# CÚBICA 3D — Etapa C, preflight del bloque 5A

Fecha: 2026-10-22 (America/Argentina/Buenos_Aires)

Resultado: **DETENIDO ANTES DEL DRY-RUN. CORREGIR 5A ANTES DE INSTALAR.**

## Alcance y candidato

- Archivo: `supabase/migrations/20261018171301_stage_c_content_faq_private_functions.sql`
- Identidad prevista: `stage_c_20261018171301_content_faq_private_functions`
- SHA-256 calculado: `5351734526A909BACDE0A822258B811365C680B2D046AB11E9B40EBD08D99F50`
- El hash coincide con el plan y con el valor histórico autorizado.
- El archivo no fue modificado.

5A crea siete funciones privadas:

1. `private.get_public_content_page(text)`: lee solo la versión `published` más reciente de una página.
2. `private.get_public_faq()`: lee solo FAQ activas y no eliminadas.
3. `private.stage_c_validate_content(jsonb)`: valida estructura, longitud y contenido ejecutable.
4. `private.admin_save_content_draft(text,text,jsonb,integer)`: crea o actualiza un borrador con control optimista.
5. `private.admin_publish_content_page(text,integer)`: archiva la publicación anterior y crea una nueva.
6. `private.admin_restore_content_version(text,integer,integer)`: copia una revisión histórica a borrador.
7. `private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)`: crea, edita, ordena, activa, elimina lógicamente o restaura una FAQ.

Las páginas previstas por el esquema son `about`, `contact`, `terms` y `community`. FAQ usa una tabla separada. Los valores iniciales de esas cuatro páginas corresponden al futuro bloque 6; 5A no publica contenido por sí mismo.

## Estado de producción, solo lectura

- Proyecto: `cubica-web`, estado `ACTIVE_HEALTHY`.
- PostgreSQL: `17.11` (`17.11.0.002`).
- Historial remoto: 37 migraciones.
- Se comparó la lista exacta de 37 registros remotos con el snapshot local de 37 archivos recuperado en el preflight anterior; no se detectó diferencia.
- Los centinelas de bloques 1, 2, 3A, 3B-1 v3, 3B-2 v2, 3C-1, 3C-2, 4A v2, 4B v2 y 4C v2 son correctos.
- 5A continúa ausente: 0 funciones privadas de 5A, 0 wrappers públicos y centinela ausente.
- Las 12 tablas actuales de Etapa C tienen RLS habilitado.
- No hay grants directos a `PUBLIC`, `anon`, `authenticated` ni `service_role` sobre esas 12 tablas.
- `site-assets` sigue privado, con límite de 8 MiB, MIME JPEG/PNG/WebP y sin políticas públicas.
- Datos de Etapa C: 0 páginas iniciales, 0 versiones de contenido, 0 FAQ, 0 campañas y 0 frases. Esto es coherente porque el bloque 6 todavía no fue instalado.

Línea de base comercial inicial y final:

| Entidad | Inicial | Final |
|---|---:|---:|
| Productos | 16 | 16 |
| Insumos | 36 | 36 |
| Pedidos | 17 | 17 |
| Movimientos de inventario | 11 | 11 |
| Migraciones | 37 | 37 |

## Seguridad administrativa

- Todas las funciones administrativas llaman a `private.stage_c_assert_admin()`.
- El guard es `SECURITY DEFINER`, usa `search_path=''` y delega en `private.is_admin()`.
- `private.is_admin()` exige rol administrativo y AAL2 cuando la política MFA está activa.
- Las funciones de 5A declaran `search_path=''`.
- Las seis funciones lectoras/administrativas son `SECURITY DEFINER`; el validador es `SECURITY INVOKER`.
- El propio bloque revoca `EXECUTE` a `PUBLIC`, `anon`, `authenticated` y `service_role` antes de terminar.
- 5A no crea RPC en `public`, políticas ni grants sobre tablas.
- Los wrappers futuros de 7A-2 nacen cerrados y 7B contiene grants explícitos. Por ello 5A no depende de los grants automáticos que Supabase retirará para objetos nuevos de `public` el 2026-10-30.

Security Advisor no mostró hallazgos nuevos. Permanecen los hallazgos ya conocidos: 8 INFO por tablas privadas con RLS sin políticas, 1 advertencia de función definer para anónimos, 17 para usuarios autenticados y protección de contraseñas filtradas desactivada. Ninguno fue creado por este preflight.

## Contenido, XSS y separación borrador/publicado

Controles aprobados:

- Los borradores no son leídos por `get_public_content_page`.
- Publicar requiere una función distinta y una llamada administrativa explícita.
- Editar el borrador no cambia la publicación vigente.
- Una revisión obsoleta al guardar el borrador devuelve conflicto `40001`.
- El validador restringe las claves admitidas, email, enlace de Instagram y longitudes.
- Rechaza `script`, `iframe`, `object`, `embed`, `style`, atributos `on*`, `javascript:` y `data:text/html`.
- El frontend escapa HTML antes de interpretar su Markdown limitado. Solo convierte enlaces `https://` y `mailto:`; no admite imágenes Markdown ni HTML ejecutable.
- Preguntas FAQ se escapan como texto y respuestas usan el mismo renderizado seguro.
- La respuesta pública de FAQ contiene solo `id`, `question` y `answer`; no incorpora autor ni datos administrativos.

Riesgo no bloqueante que requiere decisión funcional: `stage_c_validate_content({})` admite contenido vacío. Esto permite una página con título válido pero sin cuerpo ni campos de contacto. Puede ser útil como borrador, pero debería decidirse si una publicación vacía debe rechazarse.

## Defectos bloqueantes reproducidos

### 1. Una misma revisión se publica varias veces

`admin_publish_content_page` bloquea el borrador con `FOR UPDATE`, pero no cambia su `version` ni registra que ya fue publicado. Dos llamadas consecutivas con el mismo `p_expected_version` pasan la misma comprobación. Cada llamada archiva la publicación vigente y crea otra versión con contenido idéntico.

Prueba PostgreSQL 17.5: dos publicaciones del mismo borrador crearon **dos** revisiones históricas donde debía existir una. Esto incumple el requisito de que publicaciones repetidas no creen versiones innecesarias y deja el mismo defecto disponible ante doble clic, reintento o concurrencia.

### 2. FAQ duplicadas aceptadas

No existe índice o comprobación que impida dos FAQ activas con la misma pregunta normalizada. La prueba creó una segunda pregunta idéntica. Esto incumple la prevención de duplicados accidentales.

### 3. Restauración de FAQ no accesible desde administración

La función permite restaurar técnicamente un registro conocido usando `p_delete=false`, pero `private.admin_get_site_configuration()` filtra `deleted_at is null` y el frontend solo ofrece Eliminar. Después de recargar, la FAQ eliminada desaparece de la respuesta administrativa y no existe una acción de restauración. La restauración no es utilizable mediante el flujo previsto.

## Pruebas

PostgreSQL aislado PGlite 17.5, con fixtures dentro de `BEGIN/ROLLBACK`:

- 10 comprobaciones aprobadas: firmas/ACL, borrador privado, publicación explícita, edición sin fuga pública, conflicto de revisión, validación de payloads, ciclo FAQ, rechazo AAL1, rollback sin residuos y verificación del script posterior.
- 2 comprobaciones fallidas: publicación repetida idempotente y FAQ duplicada.
- 1 comprobación adicional aprobada en navegador aislado: escape de HTML y enlaces limitados.
- 1 comprobación no ejecutada: concurrencia multisesión real. PGlite 17.5 ofrece una sola sesión independiente; no se presenta una simulación como prueba de concurrencia.
- Suite estática general de Etapa C: 28/28 comprobaciones aprobadas. Esa suite no detectaba los dos defectos funcionales anteriores.

El test de diagnóstico quedó en `tests/stage-c-5a-preflight-postgres17.test.mjs`.

## Dry-run

Resultado literal:

`NO EJECUTADO — AUDITORÍA LOCAL BLOQUEADA POR DEFECTOS FUNCIONALES DE 5A.`

No se abrió una conexión CLI, no se solicitó contraseña y no se ejecutaron `migration fetch`, `migration list` ni `db push --dry-run` en este preflight. Esta decisión aplica la condición del alcance: el dry-run solo debía ejecutarse si la auditoría y las pruebas locales no encontraban defectos bloqueantes.

## Recuperación y compatibilidad

- La migración es transaccional; un error durante su instalación debería revertir el bloque completo.
- Existe `supabase/rollback/20261018171500_stage_c_partial_safe_state.sql`, que cierra rutas y preserva tablas/datos, pero no existe un rollback dedicado a 5A.
- `private.admin_get_site_configuration()` ya sabe leer páginas, historial y FAQ. Los defectos de restauración descritos requieren coordinar esa función y el frontend, además de 5A.
- Los futuros wrappers 7A-2 conservan las firmas de 5A. Una corrección interna puede mantenerlas; cualquier cambio de firma exigiría actualizar wrapper, activación, sonda y recuperación.

## Recomendación

No instalar el archivo actual. Preparar una versión 5A v2 con identidad y hash nuevos que:

1. haga idempotente la publicación del mismo borrador y sea segura ante doble clic/reintentos;
2. defina y aplique una regla de duplicados de FAQ, incluyendo normalización y registros eliminados;
3. haga visible y operable la restauración de FAQ desde la lectura administrativa y la interfaz;
4. decida explícitamente si una publicación vacía es válida;
5. añada pruebas multisesión reales para publicación concurrente;
6. conserve las firmas públicas futuras cuando sea posible y actualice verificación/recuperación.

Producción permaneció intacta: todas las consultas fueron `SELECT`; no hubo migraciones, escrituras, cambios de permisos, secretos, despliegues ni publicaciones.
