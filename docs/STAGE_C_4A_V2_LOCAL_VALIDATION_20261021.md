# Cúbica 3D — Validación local de Etapa C 4A v2

Fecha: 2026-10-21. Alcance: corrección y pruebas locales. Producción no fue
modificada.

## Candidata

- Archivo: `20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql`
- Registro previsto: `stage_c_20261018171249_appearance_asset_admin_private_functions_v2`
- SHA-256: `5B212BC9F45B3A0BEFF5E9D0B14AD413CB4EF85A2472DAE33829639253F454E3`
- Tamaño: 18.712 bytes
- Versión reemplazada y archivada: `20261018171251`, SHA-256
  `5FA98396577D575CE9D8AAAABD91E96F484944BE7B6E04629D326B0CD7158E6C`.

La numeración `171249` es única, posterior a 3C-2 (`171232`) y anterior a 4B
(`171252`). La candidata anterior nunca se aplicó en producción.

## Correcciones

1. **Publicación idempotente.** Se incorpora `source_draft_version` y un índice
   único parcial. La misma revisión devuelve la publicación existente. Un
   bloqueo transaccional serializa las mutaciones de apariencia.
2. **Borradores con revisión esperada.** Guardar, restablecer y recuperar
   comparan atómicamente la versión. Los conflictos devuelven SQLSTATE `40001`
   y conservan el borrador vigente.
3. **Storage real.** El registro exige un objeto no archivado y no eliminado en
   `storage.objects`, bucket `site-assets`, ruta exacta, MIME y tamaño
   coincidentes. La extensión debe corresponder al MIME y se mantienen los
   límites de 8 MiB y 8192×8192.
4. **Contenido binario.** PostgreSQL no inspecciona bytes ni calcula dimensiones.
   La Edge Function existente conserva esa responsabilidad mediante firmas
   PNG/JPEG/WebP, tamaño real y dimensiones antes de subir el objeto.
5. **Referencias estructuradas.** El retiro consulta únicamente
   `assets.logo`, `assets.banner` y `assets.background` en borradores,
   publicaciones y campañas no eliminadas. Un UUID en texto libre ya no bloquea
   el retiro.
6. **Coordinación con retiro.** El validador bloquea los recursos referenciados
   con `FOR SHARE`; el retiro usa `FOR UPDATE`. Los recursos de campaña pueden
   ocupar cualquiera de los tres slots en campañas. La apariencia permanente
   exige el tipo exacto del slot.
7. **Seguridad.** Las seis funciones administrativas siguen como
   `SECURITY DEFINER`, `search_path=''`, guard administrativo AAL2 y sin
   `EXECUTE` para `PUBLIC`, `anon`, `authenticated` o `service_role`. El
   validador continúa como invoker y también cerrado.

## Pruebas aisladas

Entorno: PGlite PostgreSQL 17.5. Producción usa PostgreSQL 17.11.

Resultados de los 18 escenarios obligatorios:

- 16 aprobados.
- 0 fallidos.
- 2 no ejecutados de forma representativa: publicación simultánea desde dos
  sesiones y retiro simultáneo con publicación. PGlite ofrece una sola sesión.
  Se comprobaron el índice único, el bloqueo asesor y los bloqueos de filas,
  pero esto no se presenta como una prueba real de concurrencia multisesión.

También aprobaron la verificación posterior, ACL, `search_path`, modos de
seguridad, rechazo AAL1/cliente, separación borrador/publicación y ROLLBACK sin
residuos en `site_assets`, `site_appearance_versions`, `site_campaigns` ni
`storage.objects`.

La suite estática de Etapa C aprobó 28 comprobaciones después de reconocer la
nueva candidata y su índice de integridad.

La regresión completa se ejecutó mediante los ocho archivos de prueba del
proyecto (presupuestos, interfaz, Etapa A, corrección de categorías, Etapa B,
calendario PostgreSQL 17, 4A v2 y Etapa C). Todos finalizaron con código 0. El
comando agregado del gestor de paquetes no se utilizó porque intentó consultar
el registro externo; se ejecutaron directamente, en el mismo orden, los ocho
comandos Node ya instalados y sin descargar dependencias.

## Compatibilidad y cambios coordinados pendientes

No se modificaron silenciosamente componentes dependientes. Antes de avanzar a
los bloques indicados se necesita autorización para actualizar:

| Componente | Ajuste requerido |
|---|---|
| `20261018171400_stage_c_safe_defaults.sql` | Centinela de 4A `171249` |
| `20261018171511_stage_c_public_appearance_wrappers_closed.sql` | Centinela y wrappers reset/restore con `p_expected_version integer` |
| `20261018171514_stage_c_api_storage_activation.sql` | Firmas privadas y públicas nuevas |
| `20261018171511_verify.sql` | Firmas de wrappers nuevas |
| `20261018171500_stage_c_partial_safe_state.sql` | Revocación de firmas nuevas |
| `js/site-experience.js` | Enviar la versión actual al restablecer/recuperar y usar `null` si no existe borrador |

4B continúa siendo compatible con el validador reforzado: sus recursos del tipo
del slot o `campaign` son válidos y toman bloqueo compartido. 4C y 5A-C no usan
las firmas modificadas.

## Runbook para el próximo preflight

1. Confirmar en solo lectura las 34 migraciones remotas y la ausencia de 4A.
2. Copiar el historial remoto a un directorio aislado.
3. Incorporar solamente `20261018171249...v2`.
4. Verificar el SHA-256 indicado arriba.
5. Ejecutar `db push --dry-run --include-all --skip-vault` con CLI 2.121.0,
   Session Pooler IPv4 y TLS `verify-full`.
6. Exigir que el plan liste exclusivamente 4A v2.
7. No ejecutar el push real sin una autorización nueva.

## Riesgo residual

Falta una prueba multisesión representativa en un PostgreSQL servidor aislado.
La candidata contiene garantías de base de datos para esas carreras, pero el
preflight de producción debería seguir considerándose pendiente hasta que Diego
decida si exige esa prueba adicional o autoriza avanzar con la evidencia actual.
