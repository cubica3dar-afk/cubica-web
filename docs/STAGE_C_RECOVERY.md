# Recuperación de la Etapa C subdividida

Este procedimiento conserva tablas, datos, versiones, funciones y objetos de
Storage. No elimina campañas, borradores, sugerencias ni recursos que pudieran
crearse legítimamente después de una instalación parcial.

## Si una llamada termina sin respuesta

1. No reintentar el bloque.
2. Ejecutar `supabase/verification/stage_c_installation_status.sql` en modo de
   solo lectura.
3. Ejecutar el archivo `supabase/verification/<versión>_verify.sql` del último
   bloque intentado.
4. Clasificar el resultado:
   - registro, centinela, objetos y permisos coherentes: `confirmed`;
   - registro y centinela ausentes, sin objetos propios: `absent`;
   - cualquier otra combinación: `inconsistent` y detención obligatoria.
5. Revisar logs y sesiones antes de solicitar autorización para continuar.

La ausencia de respuesta del cliente nunca demuestra por sí sola éxito o
rollback.

## Estados seguros antes de 7A

Los pasos 3B-1 v3, 3B-2 v2, 3C-1, 3C-2, 4A, 4B, 4C, 5A v2, 5B v3 y 5C v3 crean funciones
en `private` y revocan `EXECUTE` a `PUBLIC`, `anon`, `authenticated` y
`service_role` dentro de la misma transacción. Es seguro detenerse después de
cualquiera de ellos si la sonda devuelve `confirmed` para todos los pasos
anteriores y `absent` para los siguientes.

5A v2 dispone además de
`supabase/rollback/20261018171256_stage_c_content_faq_private_functions_v2.sql`.
Ese procedimiento es deliberadamente no destructivo: revoca `EXECUTE`, conserva
el historial de páginas y FAQ, mantiene los índices de integridad y no elimina la
columna `source_draft_version`. El candidato 5A v1 está archivado y no debe
aplicarse ni utilizarse para reconciliar el historial.

5B v3 dispone de
`supabase/rollback/20261018171258_stage_c_suggestion_protection_private_functions_v3_safe_state.sql`.
Su contención revoca `EXECUTE` y conserva ledger, contadores y sugerencias. No
retira la columna `was_duplicate`. El candidato 5C v2 no aplicado quedó
archivado. 5C v3 depende del centinela `cubica_stage_c:20261018171258` y dispone
de la contención no destructiva
`supabase/rollback/20261024233029_stage_c_suggestion_admin_private_functions_v3_safe_state.sql`.
Esta contención conserva revisiones e historial, reafirma RLS/`FORCE RLS` y
revoca las funciones privadas y wrappers v3 sin borrar datos.

El bloque 6 v3 inserta únicamente valores iniciales privados; las doce frases
predeterminadas quedan inactivas. Sus datos permanecen protegidos por RLS y no
se publican por instalar 6 v3. La contención específica está en
`supabase/rollback/20261018171402_stage_c_safe_defaults_v3_safe_state.sql`:
invalida el centinela, reafirma RLS/ACL y mantiene el bucket privado. No elimina
semillas porque, sin una marca de procedencia por fila, no es seguro distinguir
una semilla intacta de otra editada legítimamente después de la instalación.

## Estados seguros durante 7A

7A se divide en tres migraciones cerradas: 7A-1 v2 crea 10 wrappers de lectura,
apariencia y recursos; 7A-2 v2 crea 11 wrappers de campañas, frases, contenidos y
FAQ; 7A-3 v2 crea 6 wrappers de sugerencias. Cada bloque revoca todo permiso de
ejecución antes de confirmar. Si 7B no se instaló:

- los wrappers no pueden ejecutarse desde roles de API;
- las funciones privadas continúan cerradas;
- el bucket `site-assets` sigue privado;
- no existen las políticas `site_assets_public_read` ni
  `site_assets_admin_read`.

La sonda comprueba cada grupo bajo el perfil `wrappers_safe`. Es seguro detenerse
después de cualquiera de los tres si los anteriores están confirmados y los
siguientes ausentes.

## Contención después de 7B

Si 7B se confirma y luego aparece una regresión crítica:

1. mantener sin publicar el frontend de Etapa C o volver al frontend estable;
2. con autorización separada, ejecutar
   `supabase/rollback/20261018171500_stage_c_partial_safe_state.sql`, actualizado
   para revocar también las firmas atómicas de 5B v3 y 7A-3 v2;
3. confirmar que todas las funciones públicas y privadas de Etapa C perdieron
   permisos para roles de API;
4. confirmar que se retiraron únicamente las dos políticas de Storage de Etapa
   C y que el bucket permanece privado;
5. verificar RLS, Auth, pedidos, Comunidad, presupuestos e inventario.

El archivo de contención actualizado tiene SHA-256
`40E5858187C75439CEAA8E2553248FAB2CDC1F20848F7ABD90DAAF371EADB636`.

## Estados inconsistentes

Detener el despliegue si aparece cualquiera de estos casos:

- registro sin centinela;
- centinela sin registro;
- cantidad parcial de funciones;
- un bloque posterior confirmado sin sus dependencias;
- permisos efectivos distintos del perfil esperado;
- políticas de Storage activas antes de 7B;
- wrappers ejecutables antes de 7B.

No completar ni retirar objetos manualmente hasta comparar el registro de
migraciones, los centinelas, `pg_proc`, ACL, políticas y logs.

## Retiro completo

No existe un retiro destructivo automático. Borrar tablas o funciones puede
perder contenido creado después de una instalación parcial. Si alguna vez se
requiere retirar físicamente el módulo, primero se debe exportar una copia,
demostrar que no contiene datos legítimos y obtener autorización específica.

