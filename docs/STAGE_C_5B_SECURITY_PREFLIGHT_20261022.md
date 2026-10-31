# CÚBICA 3D — Etapa C, preflight de seguridad de 5B

Fecha: 22 de octubre de 2026  
Alcance: revisión local y consultas de solo lectura sobre producción.  
Resultado: **DETENIDO ANTES DEL DRY-RUN — 5B requiere correcciones.**

## Identidad del bloque

- Archivo: `20261018171302_stage_c_suggestion_protection_private_functions.sql`
- Nombre lógico: `stage_c_20261018171302_suggestion_protection_private_functions`
- SHA-256 comprobado:
  `9D47D8AF0C728234E30FDD8A1889D1C57E7CA34417236B04F4F50BB441732BB1`
- Tamaño: 5.056 bytes.
- Dependencia directa: `private.stage_c_assert_admin()` con centinela
  `cubica_stage_c:20261018171210`.
- El archivo coincide con el hash histórico y no fue modificado.

El bloque crea únicamente estas funciones:

1. `private.consume_suggestion_protection(text,text,uuid)`.
2. `private.submit_public_suggestion(text,text,text,text,uuid,uuid)`.

Ambas son `SECURITY DEFINER`, tienen `search_path=''` y quedan sin `EXECUTE`
para `PUBLIC`, `anon`, `authenticated` y `service_role`. El bloque no crea
tablas, índices, políticas, wrappers públicos ni permisos de API.

Las estructuras que utiliza ya fueron creadas por el bloque 2:

- `private.site_suggestions`, con categoría enumerada, asunto de 3–160
  caracteres, descripción de 10–3.000, contacto opcional de hasta 320,
  `request_id` único y FK opcional a `auth.users`.
- `private.suggestion_token_uses`, con PK sobre `token_hash` y vencimiento.
- `private.suggestion_rate_limits`, con PK sobre `identity_hash`, ventana,
  contador y `blocked_until`.
- Índice administrativo `site_suggestions_admin(status, created_at desc, id)`.

## Estado inicial de producción

La comprobación fresca devolvió:

- Proyecto `cubica-web`: `ACTIVE_HEALTHY`.
- PostgreSQL: 17.11.
- Historial remoto: 38 migraciones.
- Bloques confirmados: 1, 2, 3A, 3B-1 v3, 3B-2 v2, 3C-1, 3C-2,
  4A v2, 4B v2, 4C v2 y 5A v2.
- 5B: ausente del historial y sus dos funciones no existen.
- Dependencia 3A: presente con el centinela correcto.
- Tablas privadas de Etapa C: 12 de 12 presentes y 12 de 12 con RLS.
- Grants directos inesperados para roles API: 0.
- Bucket `site-assets`: privado, límite 8 MiB y sin políticas públicas.
- Registros de sugerencias, tokens y límites: 0 / 0 / 0.

Conciliación comercial:

| Entidad | Línea anterior | Lectura actual |
|---|---:|---:|
| Productos | 16 | 16 |
| Insumos | 36 | 36 |
| Pedidos | 17 | 17 |
| Movimientos de inventario | 11 | 11 |

No se detectó deriva respecto de la línea de base autorizada.

## Auditoría del formulario y privacidad

### Controles correctos

- La Edge Function limita el cuerpo HTTP a 16 KiB, valida JSON, UUID,
  categoría, longitudes y presencia del token Turnstile antes de llamar a SQL.
- La base repite los límites relevantes con `CHECK`, FK, unicidad y
  `stage_c_safe_text`; no depende solamente del frontend.
- Las consultas son parametrizadas y no hay SQL dinámico con contenido del
  usuario.
- Se rechazan cargas evidentes con `script`, `iframe`, `object`, `embed`,
  `style`, atributos `on...`, `javascript:` y `data:text/html`.
- Unicode y caracteres especiales válidos se conservan.
- La identidad autenticada se resuelve consultando Supabase Auth; no se acepta
  un `user_id` enviado en el cuerpo del navegador.
- Un invitado se guarda con `user_id` nulo.
- La interfaz administrativa actual escapa asunto, descripción, contacto y
  notas al mostrarlos.
- Las tablas no tienen lectura directa para visitantes ni clientes. IP, hashes
  y registros de protección permanecen en `private`.
- Los errores públicos se traducen a códigos genéricos y no revelan cuentas,
  SQL ni contenido interno.

### Riesgos y defectos

#### Bloqueador 1 — el bloqueo temporal no se persiste

Cuando el contador llega al límite, la función actualiza `blocked_until` y a
continuación ejecuta `RAISE EXCEPTION`. PostgreSQL revierte toda la sentencia,
incluida esa actualización. La prueba real en PostgreSQL 17.5 confirmó que
`blocked_until` queda en `NULL`.

El sexto intento sí se rechaza mientras la ventana original conserve cinco
intentos, pero no existe el bloqueo persistente o extensible que el diseño
declara. El bloque debe corregirse sin confiar en una escritura seguida de una
excepción en la misma transacción.

#### Bloqueador 2 — carrera al crear el primer límite de una identidad

`SELECT ... FOR UPDATE` no bloquea una fila inexistente. Dos primeras
solicitudes simultáneas pueden entrar en la rama de inicialización. El
`INSERT ... ON CONFLICT DO UPDATE` restablece `attempts=1`, por lo que la
segunda puede borrar el conteo de la primera. Esta carrera permite subcontar
intentos. La prueba multisesión no pudo ejecutarse en PGlite, pero el patrón SQL
es inseguro y debe cambiarse por un único UPSERT atómico que incremente sin
reiniciar una ventana vigente.

#### Bloqueador 3 — la sonda individual no reconoce las funciones

`supabase/verification/20261018171302_verify.sql` llama a `to_regprocedure`
con nombres sin argumentos. En la prueba devolvió `exists=false` para ambas
funciones aunque estaban creadas. Debe usar las firmas completas. En su estado
actual no sirve para verificar inequívocamente una instalación ni una
desconexión.

#### Riesgo alto — consumo y persistencia no son atómicos

La Edge Function llama primero a `consume_suggestion_protection` y luego a
`submit_public_suggestion` en dos RPC y dos transacciones. Si el segundo paso
falla, el token y el intento quedan consumidos sin sugerencia. Un reintento con
el mismo Turnstile se rechaza como replay. Conviene unificar ambos pasos en una
operación privada transaccional o diseñar una recuperación idempotente que
vincule token, `request_id` y resultado.

#### Riesgo alto — no existe límite por usuario autenticado

El hash de identidad de la Edge Function se calcula siempre desde la dirección
de red. No se combina con el usuario verificado. Por lo tanto no hay un límite
independiente por usuario: usuarios detrás de la misma red comparten cupo y una
cuenta puede cambiar de red para obtener otra ventana. La IP aporta una señal
útil, pero no satisface por sí sola el control por usuario requerido.

#### Riesgo medio — primera IP y cabeceras del proxy

Se prioriza `cf-connecting-ip`; como alternativa se toma el último elemento de
`x-forwarded-for`. Antes de activar debe verificarse en el entorno real que la
pasarela elimina o normaliza cabeceras aportadas por el cliente. La sal protege
el valor almacenado, pero una fuente manipulable permitiría rotar identidades.

#### Riesgo medio — contenido repetido

`request_id` ofrece idempotencia para un reintento idéntico. El mismo texto con
un UUID nuevo se guarda otra vez. La prueba creó dos sugerencias distintas con
contenido igual. El rate limit reduce el volumen, pero no detecta repetición de
contenido ni campañas distribuidas.

#### Riesgo medio — HTML no peligroso se almacena

La lista de patrones rechaza vectores directos conocidos, pero no transforma el
campo en texto plano ni bloquea todo HTML. La UI actual lo escapa correctamente.
Se debe conservar ese escape en todo consumidor futuro y conviene validar como
texto plano en backend para reducir el riesgo de XSS almacenado ante nuevas
interfaces.

#### Observaciones menores

- `p_request_id` se exige en `consume_suggestion_protection`, pero no se guarda
  ni se vincula al token o al contador.
- La limpieza existe recién en 5C y se habilita a `service_role` en 7B. Es
  correcto mantenerla cerrada ahora, pero antes de activar debe existir y
  programarse su ejecución.
- No hay borrado automático de sugerencias ni de datos de contacto. Debe
  definirse una retención antes de operar el formulario de forma sostenida.

## Turnstile y distribución de responsabilidades

La implementación prevista sí verifica Turnstile en backend mediante
Siteverify. Comprueba `success`, hostname `cubica3d.ar`/`www.cubica3d.ar`,
acción `suggestion_submit`, marca temporal, límite de antigüedad y respuesta
`timeout-or-duplicate`. Envía un `idempotency_key` derivado del `request_id` y
usa un timeout de red.

Responsabilidades observadas:

| Capa | Responsabilidad |
|---|---|
| Frontend | Recolectar datos, token y UUID; validación de experiencia de usuario. |
| Edge Function | Verificar Siteverify, origen permitido, Auth real, hashes con sal y errores públicos. |
| SQL privado | Revalidar datos, aplicar replay/rate limit y persistir. |
| 5C | Lectura/moderación AAL2 y limpieza. |
| 7A-3 / 7B | Crear wrappers cerrados y conceder después solo los permisos explícitos. |

La sal `SUGGESTION_RATE_LIMIT_SALT` no aparece en código ni respuestas y no se
configuró durante este preflight. El token Turnstile real y la Edge Function
desplegada no fueron probados, porque todavía no están autorizados.

## RLS, permisos y MFA

- Las funciones 5B quedan cerradas incluso para `service_role`; esta es la
  postura correcta antes de 7A-3/7B.
- No aparecen RPC públicas de 5B.
- La futura moderación de 5C llama al guard central que exige usuario
  administrador y AAL2. 5B no contiene operaciones administrativas.
- El diseño de 7B concede explícitamente `service_role` solo a los wrappers de
  ingreso y limpieza, y `authenticated` a los wrappers administrativos. Esto
  es coherente con el cambio hacia permisos explícitos; debe volver a auditarse
  con las firmas v2 vigentes antes de aplicar 7B.
- El rollback general disponible es un modo seguro de contención: revoca rutas,
  mantiene RLS y vuelve privado el bucket. No existe todavía un rollback
  quirúrgico específico de 5B.

## Pruebas aisladas

Se añadió y ejecutó
`tests/stage-c-5b-preflight-postgres17.test.mjs` en PGlite PostgreSQL 17.5,
aplicando el SQL exacto y usando una transacción con `ROLLBACK`.

Resultado específico: **13 aprobadas, 3 fallidas, 2 no ejecutadas**.

Aprobadas:

1. Firmas, `SECURITY DEFINER`, `search_path` y ACL cerradas.
2. Rechazo de invocación interna por clientes.
3. Rechazo de hashes e identificadores malformados.
4. Primer consumo y creación de ventana.
5. Rechazo de replay sin aumentar el contador.
6. Idempotencia por `request_id` sin reescribir contenido.
7. Identidad nula o usuario real y rechazo de UUID inexistente por FK.
8. Campos vacíos y demasiado largos.
9. XSS directo y protocolo `javascript:`.
10. Rechazo del sexto intento dentro de la hora.
11. Reinicio después de expirar la ventana.
12. Creación de fixtures dentro de la transacción.
13. `ROLLBACK` sin residuos.

Fallidas:

1. Persistencia de `blocked_until`: queda `NULL`.
2. Detección de contenido repetido con un UUID nuevo: se acepta duplicado.
3. Sonda posterior: informa que las dos funciones no existen por usar firmas
   incompletas.

No ejecutadas:

1. Carrera simultánea con dos sesiones PostgreSQL; PGlite ofrece una sola
   sesión. No se presenta una secuencia simulada como prueba multisesión.
2. Turnstile real y Edge Function desplegada; están fuera del alcance actual.

Además, las 10 suites de regresión existentes finalizaron correctamente,
incluidas presupuestos, UI, Etapas A/B, calendario, 4A, 4B, 4C, 5A y las 28
comprobaciones generales de Etapa C. `npm` no está disponible en el PATH de
esta sesión, por lo que se ejecutaron directamente con Node los mismos diez
archivos definidos por el script `test`.

Permanecen pendientes las pruebas multisesión reales ya documentadas de 4A,
4B, 4C y 5A.

## Supabase CLI

El `db push --dry-run --include-all` **NO SE EJECUTÓ**.

Resultado literal aplicable:

```text
DRY_RUN_RESULT=NOT_EXECUTED_BLOCKING_SECURITY_DEFECTS
```

El alcance autorizaba el dry-run únicamente si la auditoría y las pruebas no
encontraban defectos bloqueantes. Se detuvo el procedimiento antes de solicitar
credenciales y antes de crear un directorio de despliegue.

## Security Advisor y logs

No hay hallazgos nuevos atribuibles a 5B porque no fue instalado. Permanecen:

- 8 avisos informativos de tablas privadas con RLS y sin políticas.
- 1 advertencia sobre `public.track_public_event` ejecutable por `anon`.
- 17 advertencias sobre funciones `SECURITY DEFINER` existentes y ejecutables
  por usuarios autenticados.
- Protección de contraseñas filtradas deshabilitada.

Referencias del Advisor:

- [RLS activado sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Funciones definer ejecutables por anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Funciones definer ejecutables por authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Seguridad de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

La agregación de logs de las últimas 24 horas no encontró entradas cuyo mensaje
contuviera `error` en Auth, API, Postgres, Pooler, Storage, Realtime o Edge. Esta
es una comprobación agregada; no sustituye una inspección por correlación de una
ejecución concreta.

## Compatibilidad posterior

- 5C depende del centinela actual de 5B y deberá apuntar a la identidad y
  centinela de la versión corregida.
- 7A-1 conserva una dependencia histórica con 5B; 7A-3 crea los wrappers de
  sugerencias; 7B activa permisos. Todos deben actualizarse y volver a
  comprobarse después de versionar 5B v2.
- La sonda general ya usa firmas completas, pero la verificación individual de
  5B debe corregirse.
- El rollback general debe incorporar cualquier objeto nuevo que introduzca la
  corrección. Conviene añadir un rollback específico que cierre las rutas sin
  eliminar datos.
- La Edge Function y el frontend no deben publicarse hasta verificar en forma
  conjunta Siteverify, rate limit, atomicidad, permisos y limpieza.

## Recomendación

**No instalar el bloque 5B actual.** Preparar una 5B v2 con nombre, versión,
hash y centinela nuevos que:

1. haga atómico el conteo y cierre la carrera de primera solicitud;
2. implemente un bloqueo persistente que no se revierta al responder 429;
3. aplique límites separados y combinados para usuario e IP;
4. vincule token, identidad y `request_id`, y resuelva la atomicidad entre
   consumo y persistencia;
5. defina el tratamiento de contenido repetido;
6. corrija la sonda con firmas completas;
7. añada pruebas multisesión en un PostgreSQL servidor aislado;
8. actualice 5C, 7A-1, 7A-3, 7B y recuperación sin abrir permisos antes de
   tiempo.

## Confirmación de alcance

**Escrituras en producción: cero.** No se ejecutó migración, SQL Editor,
`migration repair`, dry-run con credenciales, secreto, Edge Function, frontend,
sugerencia real, registro de abuso ni cambio de RLS/Storage.
