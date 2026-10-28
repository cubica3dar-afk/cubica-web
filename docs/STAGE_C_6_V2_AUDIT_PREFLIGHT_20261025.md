# CÚBICA 3D — Etapa C · auditoría y preflight del bloque 6 v2

Fecha: 25 de octubre de 2026 (`America/Argentina/Buenos_Aires`)  
Proyecto: `mymrbpwvghxmqqpzzdqk` (`cubica-web`)  
Resultado: `BLOCKED_BEFORE_REMOTE_PREFLIGHT`

## 1. Resultado ejecutivo

El bloque 6 **no está listo para instalar**. La auditoría se detuvo antes del
`db push --dry-run`, tal como exigía la autorización, porque se comprobaron
siete bloqueadores:

1. Busca una firma antigua de `admin_upsert_site_campaign` con 16 argumentos;
   producción tiene la firma vigente de 17 argumentos, con `p_request_id`.
2. Exige el centinela `20261018171256` en `admin_upsert_faq`, pero 5A v2 lo
   colocó en `admin_restore_faq`; el comentario de la primera función es nulo.
3. `ON CONFLICT ... DO UPDATE` reemplaza etiquetas de páginas personalizadas.
4. Una frase predeterminada eliminada lógicamente vuelve a crearse activa al
   reejecutar la migración.
5. Si ya existe una apariencia publicada pero no un borrador, la migración
   aborta en su postcondición.
6. Si existe cualquier versión legítima de contenido, la migración aborta.
7. Las doce frases se insertan con `active=true`; al habilitar 7B,
   `get_site_experience` podría publicarlas sin una acción administrativa de
   publicación separada.

Además, el mecanismo de recuperación existente es una contención segura de
permisos, pero no un rollback específico de los valores sembrados. No puede
retirar selectivamente esos registros después de que un administrador los haya
editado sin riesgo de perder cambios legítimos.

No se modificó el SQL candidato. No se ejecutó una migración, un `dry-run`
remoto, SQL Editor, `migration repair`, Edge Functions, frontend, Storage ni
secretos.

## 2. Candidato identificado

| Concepto | Valor |
|---|---|
| Archivo | `20261018171401_stage_c_safe_defaults_v2.sql` |
| Versión | `20261018171401` |
| Nombre previsto | `stage_c_20261018171401_safe_defaults_v2` |
| SHA-256 | `7359EAF312C72F12A84C1FB607E4FFE1021B3C1C660A94D7900FBA3F43A8E813` |
| Centinela | comentario de `private.site_content_pages`: `cubica_stage_c:20261018171401` |
| Verificador | `supabase/verification/20261018171401_verify.sql` |
| SHA-256 verificador | `19CD856751432DD906290DFE01C30E96D98AA2C570BDDA2F277DAE988354DA2C` |
| Sonda general | `supabase/verification/stage_c_installation_status.sql` |
| SHA-256 sonda | `15B3C1164C13FF31A811AFA33253FBE55353E993D1A3DD155E06BC293BA027FA` |
| Contención | `supabase/rollback/20261018171500_stage_c_partial_safe_state.sql` |
| SHA-256 contención | `40E5858187C75439CEAA8E2553248FAB2CDC1F20848F7ABD90DAAF371EADB636` |

La versión anterior permanece archivada fuera del conjunto aplicable:

- `20261018171400_stage_c_safe_defaults.replaced_by_5b_v3.sql`;
- SHA-256
  `44ECF79C0EC36BD54CA3F3DD95B04ABAD60A75DC87AA16F59A0BFF81A01F8B73`.

### Diferencias frente a la primera versión

La versión v2 cambió el identificador/centinela `171400` a `171401` y actualizó
dependencias para 4A, 4B, 4C, 5A, 5B y 5C. Sustituyó la función antigua de
sugerencias por `submit_protected_suggestion` y la firma antigua de moderación
por la firma v3. No cambió la lógica de siembra: las cuatro páginas, la
apariencia y las doce frases son iguales.

La actualización quedó incompleta en dos puntos: 4B v2 añadió `p_request_id` y
5A v2 usa `admin_restore_faq` como función centinela.

La referencia histórica `20261018171253` no aparece en el candidato vigente.
Solo permanece en archivos archivados, verificadores históricos y documentación
de reemplazo.

## 3. Qué intentaría escribir

### Páginas privadas

Cuatro filas en `private.site_content_pages`:

| `slug` | etiqueta |
|---|---|
| `about` | Sobre Cúbica |
| `contact` | Contacto |
| `terms` | Términos y condiciones |
| `community` | Normas de Comunidad |

No crea versiones publicadas de esas páginas. Sin embargo, ante conflicto de
`slug`, actualiza la etiqueta existente y por eso puede pisar una
personalización administrativa.

### Apariencia privada

Inserta una versión `draft`, versión `1`, solo si la tabla completa está vacía:

- colores: fondo `#17172b`, panel `#20213a`, panel alternativo `#282a46`, texto
  `#f7f7fb`, texto secundario `#a7a9c0`, acento `#ffffff`;
- título: “Objetos únicos, impresos en 3D.”;
- subtítulo: “Diseños listos para acompañar tus espacios y tus ideas.”;
- logo, banner y fondo: `null`.

El JSON es válido, no contiene secretos, rutas, UUID de recursos ni referencias
a objetos inexistentes. El borrador no se publica durante el bloque 6.

### Frases globales

Inserta doce frases globales con orden `10` a `120`, sin campaña asociada. Son:

1. Hay cosas que comprás porque las necesitás… Bienvenido a Cúbica.
2. Que una impresión salga de una máquina no significa que sea una más…
3. A veces un pequeño objeto puede cambiar un rincón…
4. Elegiste algo hecho en 3D… que se sienta tuyo.
5. Detrás de cada producto de Cúbica hay tiempo, material y decisiones…
6. No imprimimos solamente objetos… Bienvenido a Cúbica.
7. Tu próxima compra puede terminar en un estante…
8. Hay algo especial en recibir algo que fue creado para vos…
9. Cada pieza tiene un origen: una idea…
10. Gracias por elegir un emprendimiento que crea de a una pieza por vez…
11. Lo que hoy ves en pantalla, mañana puede estar en tus manos…
12. Cúbica nace de transformar material en objetos con propósito…

Por los valores predeterminados de la tabla, nacen activas. Actualmente siguen
inaccesibles por API, pero `private.get_site_experience` selecciona frases
activas globales. Cuando 7B conceda la ruta pública, quedarían disponibles sin
otra publicación.

### Datos que no toca

No escribe campañas, ocurrencias, FAQ, sugerencias, assets, productos, insumos,
pedidos, movimientos de inventario, autenticación, RLS, grants ni Storage.

## 4. Producción comprobada por lectura

- Proyecto: `ACTIVE_HEALTHY`.
- PostgreSQL efectivo: `17.11` (`17.11.0.002` en el proyecto).
- Historial remoto: 40 migraciones, sin versiones inesperadas.
- El snapshot CLI de 40 archivos y la lectura fresca del historial remoto
  coinciden por versión y nombre.
- Bloques 1, 2, 3A, 3B-1 v3, 3B-2 v2, 3C-1, 3C-2, 4A v2, 4B v2, 4C v2,
  5A v2, 5B v3 y 5C v3 están presentes.
- Bloque 6: ausente; versión `20261018171401` tiene cero registros y el
  centinela de tabla es nulo.
- Las 13 tablas privadas de Etapa C tienen RLS habilitado; el historial de
  moderación también usa `FORCE RLS`.
- No existen grants directos de las 13 tablas para `PUBLIC`, `anon`,
  `authenticated` ni `service_role`.
- No existen grants `EXECUTE` de funciones privadas de Etapa C para esos roles.
- No hay RPC públicas prematuras de Etapa C.
- `site-assets` es privado, límite 8 MiB, MIME JPEG/PNG/WebP y cero políticas
  sobre el bucket.
- Todas las trece tablas de Etapa C continúan con cero filas.

Las seis dependencias que sí coinciden conservan `SECURITY DEFINER`,
`search_path=''`, centinela correcto y ACL cerrada. Las dos discrepancias son
las de campaña y FAQ detalladas arriba. Por ellas, el candidato actual fallaría
antes de insertar datos aun con la base vacía.

## 5. Pruebas específicas

Se añadió una prueba de auditoría separada, sin alterar el SQL candidato:

`tests/stage-c-6-v2-audit-postgres17.test.mjs`

Motor aislado: PostgreSQL 17.5 embebido mediante PGlite. Producción usa 17.11.

Resultados:

- instalación sobre un esquema vacío compatible: aprobada;
- 4 páginas, 1 borrador, 12 frases y JSON exacto: aprobado;
- segunda ejecución sin cambios: aprobada;
- dependencia incorrecta: rollback completo aprobado;
- RLS, ACL cerradas y cero wrappers: aprobado;
- conservación de etiqueta administrativa: **bloqueada**;
- respeto de soft-delete de frases: **bloqueado**;
- estado con apariencia publicada: **bloqueado**;
- contenido legítimo preexistente: **bloqueado**;
- firma vigente de campañas: **bloqueada**;
- centinela vigente de FAQ: **bloqueado**;
- publicación diferida de frases: **bloqueada**.

Resultado literal:

```text
result=BLOCKED_BEFORE_REMOTE_PREFLIGHT
tests=10
blockers=7
```

No se ejecutó una prueba multisesión real. El bloque está detenido por defectos
deterministas anteriores a una evaluación de carreras; PGlite ofrece una sola
sesión. Los índices únicos evitarían duplicados concurrentes, pero una carrera
podría convertir el segundo intento en error/rollback, no en una operación
idempotente garantizada.

## 6. Regresión general

`pnpm test`: aprobado, código de salida `0`.

- Presupuestos, experiencia visual, Etapa A y Etapa B: aprobados.
- Calendario y 29 de febrero: aprobados.
- 4A, 4B, 4C, 5B y 5C: aprobados.
- Contrato de Edge 5B v3: 14 escenarios aprobados.
- Integración estática de Etapa C: 31 comprobaciones aprobadas.
- Wrappers futuros 7A-1/2/3 y activación 7B mantienen el contrato preparado.

Las pruebas multisesión y la integración real con Cloudflare/Edge siguen
pendientes según informes anteriores y no se presentaron como ejecutadas.

## 7. Bloques posteriores y recuperación

Hashes actuales comprobados:

- 7A-1 v2:
  `65202B55CA0CBF2B0C0C9E0DD38965D628C10ABD26BBCD1B3ACD2ED40F65BC49`;
- 7A-2 v2:
  `885C94030C32D7C1FB12406A0BE2CF3573C85830898408AE69ABC82856B2E1F5`;
- 7A-3 v2:
  `58B157B66C6878329A839BE1941E1C46616CF83F163D88DB7403F6280D621EE6`;
- 7B v2:
  `3BCBDBB6488C9230B8969AED93497F7523411CC9C37B5EC5673E6CA1077FD47B`.

7A-1 exige el centinela `171401` y usa la firma actual de campañas de 17
argumentos. Los wrappers permanecen cerrados hasta 7B. El frontend y las Edge
Functions pasan la regresión estática, pero no se desplegaron.

El script de contención conserva datos y revoca rutas, vuelve privado el bucket
y reafirma RLS. Es útil ante una instalación parcial, pero no revierte de forma
selectiva las semillas de 6. Antes de instalar una versión corregida se necesita
un procedimiento de recuperación con procedencia inequívoca o condiciones que
eliminen solo valores todavía idénticos y nunca contenido editado.

## 8. Integridad comercial

| Entidad | Línea anterior | Lectura actual |
|---|---:|---:|
| Productos | 16 | 16 |
| Insumos | 36 | 36 |
| Pedidos | 17 | 17 |
| Movimientos de inventario | 11 | 11 |

Sugerencias, historial de moderación, tokens y rate limits: `0`. No existen
fixtures ni residuos QA persistentes.

## 9. Security Advisor y logs

No hay hallazgos nuevos atribuibles al bloque 6, porque no fue aplicado.
Persisten los avisos ya documentados:

- 8 informativos `rls_enabled_no_policy` en tablas privadas anteriores;
- 1 advertencia por `public.track_public_event` ejecutable por `anon`;
- 17 advertencias por funciones públicas `SECURITY DEFINER` ejecutables por
  usuarios autenticados;
- protección de contraseñas filtradas deshabilitada.

Los eventos PostgreSQL críticos de la ventana revisada pertenecen a `mgmt-api`.
Cinco fueron consultas de auditoría de solo lectura que usaron inicialmente un
nombre de tabla, alias o forma de comprobar `PUBLIC` incorrectos y luego se
corrigieron. Los demás eventos del día corresponden a comprobaciones QA previas.
No se observó una escritura del bloque 6 ni un error de aplicación asociado a
él.

## 10. Dry-run

No corresponde una salida literal de Supabase CLI:

```text
DRY_RUN_RESULT=NOT_EXECUTED_BLOCKED
```

La autorización condicionaba el dry-run a una auditoría sin bloqueadores. Al
existir operaciones capaces de sobrescribir configuraciones y dependencias que
no coinciden con producción, ejecutar el dry-run habría contradicho esa
condición.

## 11. Recomendación

Corregir primero y preparar un bloque 6 v3 con versión y SHA-256 nuevos:

1. usar la firma de campañas de 17 argumentos;
2. comprobar el centinela de 5A v2 en `admin_restore_faq`;
3. cambiar las páginas a una inserción que no actualice etiquetas existentes;
4. no reactivar frases con soft-delete;
5. decidir expresamente si las frases iniciales nacen inactivas o requieren un
   acto de publicación;
6. hacer que las postcondiciones toleren contenido legítimo preexistente y
   verifiquen solo invariantes de seguridad;
7. mantener cualquier apariencia existente sin exigir una tabla vacía;
8. preparar verificador, sonda y recuperación específicos;
9. repetir PostgreSQL 17, regresión completa y recién entonces el preflight CLI.

Producción continúa segura e intacta. No se autoriza ni recomienda instalar el
candidato v2 actual.

