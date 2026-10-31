# Etapa C — Resultado del despliegue dividido

Fecha: 2026-10-18  
Proyecto: `mymrbpwvghxmqqpzzdqk`  
Estado: detenido después de una desconexión inequívocamente revertida en el
bloque 3.

## Resultado por bloque

| Bloque | Nombre registrado | Versión efectiva | SHA-256 | Resultado |
|---:|---|---|---|---|
| 1 | `stage_c_20261018171000_visual_schema` | `20261018213838` | `EB2067BBE20589BA0C35602804817ADA95C8B705804972B3C744AE09BBAD61A2` | Aplicado y verificado |
| 2 | `stage_c_20261018171100_content_suggestion_schema` | `20261018213927` | `D58EBD92E0A903E01273C7BC55721223456822A0B40A16A77A85597BC1BA5C9C` | Aplicado y verificado |
| 3 | `stage_c_20261018171200_visual_private_functions` | Sin versión | `99FC5B1230700D32C733461CED3910E64FC65DABC16B3148A867A90F4F770589` | Dos intentos autorizados terminaron por desconexión; ambas transacciones se revirtieron completamente |
| 4 | `stage_c_20261018171250_visual_admin_private_functions` | — | `01EB915083A83F432B63CBEDFE04D1B8E78E3A72B9620E05AD652AF8E4946C0D` | No ejecutado |
| 5 | `stage_c_20261018171300_content_suggestion_private_functions` | — | `4E8A357C8FF8C6FF408FD731C44487BE4CE824B8588B1F01D26A5DEE0DEB5BA0` | No ejecutado |
| 6 | `stage_c_20261018171400_safe_defaults` | — | `216FB23017FF509D2E0993185BBB3DBC93E2D7261312E2EA953B5531CA184EEC` | No ejecutado |
| 7 | `stage_c_20261018171500_api_activation` | — | `55BD1383D48D726D661CAE6694B5904A5663FBDDC5F4FE82B044428F809C3FCC` | No ejecutado |

## Confirmación de los bloques aplicados

Bloque 1:

- Registro y centinela presentes.
- Cinco tablas presentes y cinco con RLS.
- Sin lectura directa para `anon` o `authenticated`.

Bloque 2:

- Registro y centinela presentes.
- Seis tablas presentes y seis con RLS.
- Bucket `site-assets` presente y privado.
- Cero políticas públicas de Storage.
- Sin lectura directa para `anon`, `authenticated` o `service_role` en los
  datos comprobados.

## Resolución de la desconexión del bloque 3

La llamada devolvió `Connection terminated unexpectedly`. No se reintentó.
Las lecturas posteriores confirmaron:

- registro de migración ausente;
- centinela ausente;
- 0 de las 9 funciones del bloque presentes;
- ninguna sesión de migración restante;
- ningún `ERROR` o `FATAL` atribuible al bloque en los logs disponibles.

El estado es inequívoco: el bloque 3 se revirtió por completo. La causa de la
desconexión sigue sin estar demostrada.

## Único reintento autorizado

Antes del reintento se confirmó nuevamente:

- bloques 1 y 2 registrados y con centinelas correctos;
- bloque 3 sin registro, centinela ni funciones;
- 11/11 tablas con RLS y sin acceso directo;
- cero sesiones de administración pendientes;
- SHA-256 exacto del bloque 3.

El reintento único volvió a terminar con `Connection terminated unexpectedly`.
No se realizó otro intento. La resolución posterior confirmó otra vez ausencia
total del registro, centinela y nueve funciones, y cero sesiones pendientes.

Los dos intentos del bloque 3 aparecen en el log como sentencias de 29.802
caracteres, procesos `1488500` y `1489203`, severidad `LOG`, SQLSTATE `00000`.
No hay un error PostgreSQL asociado. El archivo local mide 14.530 bytes; el
mecanismo administrado envuelve el SQL y también lo incorpora al registro de
migraciones, aproximadamente duplicando el texto observado. Esto hace plausible
un límite o fallo del transporte/operación administrativa, pero no lo confirma.

### Nueve funciones y dependencias

| Función | Tamaño aproximado | Dependencias principales |
|---|---:|---|
| `stage_c_assert_admin` | 295 caracteres | `auth.uid()`, `private.is_admin()` |
| `stage_c_safe_text` | 572 | Funciones integradas de texto y regex |
| `stage_c_luminance` | 748 | `decode`, `get_byte`, `power` |
| `stage_c_validate_theme` | 2.027 | Tres helpers anteriores y `site_assets` |
| `stage_c_asset_paths` | 392 | `site_assets` |
| `stage_c_active_campaign` | 2.361 | `site_campaigns`, `site_campaign_occurrences`, zona horaria |
| `stage_c_next_change` | 2.041 | Tablas de campañas y `generate_series` |
| `get_site_experience` | 2.167 | Apariencia, campañas, frases y helpers visuales |
| `admin_get_site_configuration` | 2.396 | Todas las tablas de configuración y guard AAL2 |

Las dependencias estructurales están presentes: 11 tablas, `private.is_admin()`,
`pgcrypto` y `storage.objects`. No existe evidencia de una dependencia faltante
ni de un error SQL de compilación.

### Alternativas para una autorización posterior

1. Dividir el bloque 3 en tres migraciones más pequeñas: validadores base;
   cálculo de campañas; resolutores de experiencia/configuración. Cada una debe
   revocar `EXECUTE` en su propia transacción y tener centinela independiente.
2. Ejecutar el bloque exacto mediante SQL Editor, en una sola transacción, y
   reconciliar después el registro de migraciones.
3. Validarlo primero en una rama aislada de Supabase; puede generar costo.

Ninguna alternativa fue ejecutada ni preparada como migración aplicable después
del segundo fallo.

## Estado seguro parcial

A las `2026-10-18 21:41:08 UTC`:

- 11 tablas de Etapa C presentes, todas con RLS.
- Cero filas en las 11 tablas.
- Bucket `site-assets` privado y sin políticas públicas.
- Cero funciones o RPC de Etapa C.
- Los bloques 3–7 no están registrados.
- No existe superficie pública o administrativa de Etapa C.
- No fue necesario ejecutar la contención adicional porque el estado ya está
  cerrado y coincide con el diseño intermedio del plan.

## Integridad comercial

Los conteos coinciden con la línea de base:

- 17 productos y 4 categorías.
- 35 insumos y 2 recetas.
- 15 pedidos, 16 artículos y 9 movimientos de inventario.
- 4 presupuestos y 3 versiones.
- 5 comentarios, 4 reacciones y 3 likes.

No se crearon registros QA ni se modificaron datos comerciales.

## Security Advisor parcial

No apareció ningún hallazgo nuevo asociado con las tablas de Etapa C. Se
mantienen los hallazgos previos: 8 informativos de tablas privadas existentes,
1 advertencia por `track_public_event`, 17 wrappers autenticados existentes y
la protección de contraseñas filtradas desactivada.

## Acciones no realizadas

- No se ejecutaron los bloques 4–7.
- No se configuraron secretos.
- No se desplegaron Edge Functions.
- No se publicó frontend.
- No se activaron campañas ni contenidos.
- No se inició la Etapa D.

## Preparación posterior autorizada: reemplazo 3A/3B/3C

Después de detener el despliegue se autorizó únicamente una subdivisión local.
El bloque 3 original quedó archivado intacto y fuera de `supabase/migrations`.
Fue reemplazado por:

- 3A `stage_c_20261018171210_visual_validators_private_functions`;
- 3B `stage_c_20261018171220_campaign_resolution_private_functions`;
- 3C `stage_c_20261018171230_configuration_resolution_private_functions`.

Las nueve definiciones funcionales coinciden exactamente con el bloque
reemplazado. Cada archivo tiene centinela, revocación independiente y
verificación de ACL, roles de API, `search_path` y modo de seguridad. La sonda y
el plan de recuperación fueron actualizados. Ninguno de los tres bloques fue
aplicado en producción.

La lectura de producción de `2026-10-18 22:12:06 UTC` confirmó el mismo estado
seguro: bloques 1 y 2 aplicados, 3 original ausente, 3A–7 ausentes, 11 tablas
vacías con RLS, bucket privado sin políticas y cero funciones de Etapa C.

