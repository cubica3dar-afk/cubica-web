# Etapa C — Aplicación autorizada de 3A, 3B y 3C

Fecha local: 2026-10-18  
Proyecto: `mymrbpwvghxmqqpzzdqk`  
Resultado: 3A confirmado; 3B desconectado y completamente revertido; 3C no
ejecutado.

## Verificación previa

- Bloques 1 y 2 confirmados y seguros.
- Bloque 3 original sin registro, centinela ni funciones.
- 3A, 3B y 3C ausentes.
- Hashes 3A/3B/3C coincidentes con la autorización.
- 11/11 tablas con RLS y cero privilegios directos para `anon`,
  `authenticated` o `service_role`.
- Bucket `site-assets` privado y sin políticas.
- Cero sesiones activas adicionales.

## Bloque 3A

- Nombre: `stage_c_20261018171210_visual_validators_private_functions`.
- SHA-256:
  `1F8149DF7E526BFC471459B4B5A97B4D1EA024F6F238C2C9DF4BF7A46A612FE8`.
- Resultado del mecanismo de migraciones: éxito.
- Versión efectiva: `20261019015434`.
- Registro y centinela presentes.
- Cinco funciones presentes con firmas y retornos esperados.
- `stage_c_assert_admin()` conserva `SECURITY DEFINER`; las otras cuatro
  conservan `SECURITY INVOKER`.
- Las cinco usan `search_path=""`.
- `PUBLIC`, `anon`, `authenticated` y `service_role` no tienen `EXECUTE`.
- No se creó ninguna función pública.
- Pruebas de solo lectura aprobadas: texto seguro, rechazo de `<script>`,
  luminancia negra `0`, luminancia blanca `1`, tema válido, recursos vacíos y
  rechazo del guard administrativo sin identidad/AAL2.

## Bloque 3B

- Nombre: `stage_c_20261018171220_campaign_resolution_private_functions`.
- SHA-256:
  `47AFA8227A314B2D773453736A29F8837E95C0DD0E4816622E4BF297BEAEE14E`.
- Resultado de la llamada: `Connection terminated unexpectedly`.
- No se reintentó.
- Sonda posterior: registro ausente, centinela ausente y 0/2 funciones.
- Cero sesiones pendientes.
- Estado inequívoco: transacción completamente revertida.

El log de PostgreSQL solo contiene una entrada `LOG`, SQLSTATE `00000`,
`command_tag=idle`, sin `ERROR`, `FATAL`, `wait_event` ni evidencia de bloqueo.
Proceso observado: `1509287`; longitud del mensaje administrado: 15.115
caracteres. La causa exacta permanece sin confirmar.

Como comparación, 3A se confirmó con un mensaje administrado de 15.311
caracteres. Por ello el tamaño, aunque sigue siendo un factor operativo útil,
no explica por sí solo la desconexión de 3B.

## Bloque 3C

No fue ejecutado, conforme a la regla de detenerse cuando un bloque falla o
queda sin respuesta.

## Seguridad e integridad posterior

- 3A continúa cerrado y verificado.
- 3B y 3C están ausentes.
- 11/11 tablas mantienen RLS y cero privilegios directos de API.
- Bucket `site-assets` privado y sin políticas.
- Cero filas en las once tablas de Etapa C; no existen registros QA.
- Cero funciones públicas de Etapa C.
- Security Advisor no agregó hallazgos relacionados con Etapa C.
- No hubo pedidos, movimientos, reacciones ni likes creados o actualizados
  durante la ventana de despliegue comprobada.
- Los conteos actuales son 17 productos, 4 categorías, 35 insumos, 2 recetas,
  17 pedidos, 18 artículos, 11 movimientos, 4 presupuestos, 3 versiones,
  5 comentarios, 5 reacciones y 4 likes. Los aumentos respecto de la lectura
  anterior ocurrieron antes de esta instalación y no fueron causados por 3A.

## Recomendación técnica

Antes de otra escritura en producción:

1. Dividir 3B en una migración para `stage_c_active_campaign` y otra para
   `stage_c_next_change`, manteniendo centinelas y revocaciones independientes.
2. Considerar dividir también 3C en una función por migración, porque la causa
   del transporte sigue abierta.
3. Dividir preventivamente el bloque 4 en apariencia/recursos, campañas y
   frases.
4. Dividir el bloque 5 en contenido/FAQ, protección y persistencia de
   sugerencias, y administración/limpieza de sugerencias.
5. Mantener el bloque 6 como unidad pequeña de valores iniciales privados.
6. Dividir el bloque 7 en una fase que cree wrappers sin permisos y una fase
   final, pequeña y atómica, que conceda permisos y active las dos políticas de
   Storage. Así ningún estado intermedio expone la API.

Estas divisiones se recomiendan para reducir la superficie de diagnóstico y
permitir una recuperación precisa. No se atribuye la desconexión únicamente al
tamaño.

No se modificaron los archivos 3B, 3C, 4, 5, 6 o 7; no se configuraron secretos,
no se desplegaron Edge Functions ni frontend, y no se inició la Etapa D.
