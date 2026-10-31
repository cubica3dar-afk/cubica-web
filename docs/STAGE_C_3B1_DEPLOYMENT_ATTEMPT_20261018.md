# Etapa C — Intento autorizado del bloque 3B-1

Fecha de ejecución: 2026-10-18 / 2026-10-19 UTC  
Proyecto: `mymrbpwvghxmqqpzzdqk`  
Resultado: desconexión del mecanismo administrado y rollback completo.

## Migración intentada

- Nombre: `stage_c_20261018171221_active_campaign_private_function`
- Archivo: `20261018171221_stage_c_active_campaign_private_function.sql`
- Tamaño: 4.708 bytes
- SHA-256:
  `A054C2D586CA58562E752BDBE9D91E8CAC36C42DB79F4CCC95FAD300D77024AE`
- Función prevista: `private.stage_c_active_campaign(timestamptz)`
- Cantidad de intentos: uno.

## Verificación previa

- Bloque 1 confirmado como `20261018213838`.
- Bloque 2 confirmado como `20261018213927`.
- Bloque 3A confirmado como `20261019015434`.
- Bloque 3B original y 3B-1 ausentes.
- Todos los bloques posteriores ausentes.
- 11/11 tablas de Etapa C con RLS.
- Cero permisos directos inesperados sobre esas tablas.
- Bucket `site-assets` privado, límite 8 MiB y cero políticas de Etapa C.
- Cero sesiones anteriores activas.
- Las once tablas de Etapa C contenían cero filas.
- Security Advisor coincidía con la línea de base previa.

## Resultado de la ejecución

El mecanismo administrado devolvió:

`Connection terminated unexpectedly`

No se realizó un segundo intento.

La sonda ejecutada inmediatamente después confirmó:

- registro de migración ausente;
- versión efectiva ausente;
- centinela ausente;
- función ausente;
- archivo de verificación individual: objeto inexistente y sin permisos;
- cero sesiones de migración activas.

El estado es inequívoco: la transacción se revirtió completamente. No existe
una instalación parcial ni es necesario aplicar contención o rollback.

## Logs

El log de PostgreSQL registra la sentencia administrada completa a las
`2026-10-19 02:39:39.178 UTC`, proceso `1512537`, aplicación `mgmt-api`.

La entrada observada tiene:

- severidad `LOG`;
- SQLSTATE `00000`;
- `command_tag=idle`;
- sin `ERROR` o `FATAL` asociado;
- sin `wait_event` o evidencia de bloqueo;
- sin sesión posterior pendiente.

El log demuestra que la sentencia llegó al backend, pero no identifica por qué
se terminó la conexión. No permite afirmar timeout, error SQL, límite de tamaño
o fallo de la función como causa.

## Seguridad e integridad posterior

- Security Advisor no agregó hallazgos de Etapa C.
- Permanecen los hallazgos previos: 8 informativos de tablas privadas con RLS
  sin política, 1 advertencia sobre `track_public_event`, 17 advertencias sobre
  wrappers `SECURITY DEFINER` autenticados y protección de contraseñas filtradas
  deshabilitada.
- 11/11 tablas de Etapa C conservan RLS y cero filas.
- No aparecieron permisos inesperados.
- `site-assets` continúa privado y sin políticas.
- Conteos comerciales antes y después: 17 productos, 4 categorías, 35 insumos,
  2 recetas, 17 pedidos, 18 artículos, 11 movimientos, 4 presupuestos,
  3 versiones, 5 comentarios, 5 reacciones y 4 likes.

No se modificaron clientes, pedidos, inventario, presupuestos ni Comunidad.

## Conclusión

Incluso una migración de una sola función y 4.708 bytes sufrió la misma
desconexión y quedó revertida. Seguir dividiendo 3B no aporta nueva información.
Antes de otro intento conviene evaluar un mecanismo alternativo de instalación
o ejecutar el SQL en un PostgreSQL aislado, tal como se definió en la
autorización.

