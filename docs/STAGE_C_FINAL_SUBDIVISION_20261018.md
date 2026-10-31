# Etapa C — Subdivisión final local

> **Plan histórico.** Los bloques 3B-1 y 3B-2 fueron reemplazados tras la
> validación PostgreSQL 17 y la definición del 29 de febrero. El orden y los
> hashes vigentes están en `STAGE_C_SPLIT_DEPLOYMENT_PLAN.md` y
> `STAGE_C_FINAL_PREPARATION_20261019.md`.
>
> **Actualización 2026-10-22.** La fila histórica de 5A también fue reemplazada
> por 5A v2 (`20261018171256_stage_c_content_faq_private_functions_v2.sql`,
> SHA-256 `17BEF84D211B74F54A9354E0EB7F4887F065F751A3E7E0FE494905BC3772CB66`).
> El archivo original quedó archivado y no es aplicable.

Fecha: 2026-10-18  
Proyecto de referencia: `mymrbpwvghxmqqpzzdqk`  
Alcance: preparación y pruebas locales; producción consultada exclusivamente en modo de solo lectura.

## Resultado

Los bloques pendientes quedaron repartidos en quince pasos futuros: 3B-1, 3B-2,
3C-1, 3C-2, 4A, 4B, 4C, 5A, 5B, 5C, 6, 7A-1, 7A-2, 7A-3 y 7B. Los bloques originales
3B, 3C, 4, 5 y 7 fueron archivados sin alterar sus bytes y ya no están en el
directorio de migraciones aplicables.

Durante la preparación local original no se escribió en Supabase ni se
reintentó 3B. No se configuraron secretos, no se desplegaron Edge Functions o
frontend y no se inició la Etapa D.

## Actualización: intento controlado de 3B-1

Un intento posterior, expresamente autorizado, de 3B-1 terminó con
`Connection terminated unexpectedly`. La sonda confirmó rollback completo:
registro, centinela y función ausentes, sin sesión pendiente. Los conteos,
RLS, permisos, bucket y Security Advisor no cambiaron. No hubo un segundo
intento. El informe específico está en
`docs/STAGE_C_3B1_DEPLOYMENT_ATTEMPT_20261018.md`.

El intento posterior no dejó cambios persistentes.

## Actualización: validación local en PostgreSQL 17

La versión `20261018171221` fue archivada sin modificar porque devolvía un
registro de 27 campos para `private.site_campaigns`, que tiene 26. La migración
de reemplazo `20261018171219` conserva `effective_start` como auxiliar y
proyecta explícitamente las 26 columnas de campaña. PostgreSQL 17.5 reprodujo
el fallo original (`XX000`, dentro de la función), creó la versión corregida y
la ejecutó con datos ficticios.

La prueba de consumidores también encontró dos referencias ambiguas en 3B-2;
se calificaron como `o.starts_at` y `o.ends_at`. No cambia la selección ni el
calendario. Las otras 54 funciones mantienen paridad exacta con el monolito.

## Diagnóstico actualizado de 3B

### Hechos comprobados

- La llamada administrada del bloque 3B terminó con `Connection terminated
  unexpectedly`.
- La transacción quedó completamente revertida: no existe registro, centinela
  ni ninguna de sus dos funciones.
- El log disponible fue de nivel `LOG`, SQLSTATE `00000`, `command_tag=idle`,
  sin `ERROR`, `FATAL`, `wait_event` ni evidencia de bloqueo.
- El mensaje administrado observado para 3B tenía 15.115 caracteres. 3A se
  instaló correctamente con 15.311 caracteres. El tamaño no explica por sí
  solo la desconexión.
- `stage_c_active_campaign` y `stage_c_next_change` son independientes. No se
  llaman entre sí ni forman una referencia circular.
- `stage_c_active_campaign` usa CTE no recursivos y devuelve el tipo compuesto
  `private.site_campaigns`.
- `stage_c_next_change` devuelve `timestamptz`; combina fechas mediante
  `UNION ALL` y un `generate_series(0,1)` acotado a dos años.
- Ambas funciones fijan `America/Argentina/Buenos_Aires` y conservan el
  comportamiento original de fechas anuales.

### Qué valida PostgreSQL al crear estas funciones

La definición obliga a resolver la firma, el tipo compuesto de retorno, tablas,
columnas y sintaxis del cuerpo cuando el validador de funciones está activo. No
hay instrucciones que ejecuten el cuerpo, recorran campañas o materialicen
`generate_series` durante `CREATE FUNCTION`. Los cálculos de calendario se
ejecutan al invocar las funciones, no durante la migración.

### Hipótesis que permanecen abiertas

La evidencia es compatible con una interrupción del transporte o del mecanismo
administrado, o con una terminación de la sesión no registrada como error SQL.
Un problema durante la validación del cuerpo es menos probable, pero no puede
descartarse sin ejecutar cada definición contra PostgreSQL. No hay evidencia
para afirmar timeout, bloqueo, consulta pesada o tamaño máximo como causa.

La separación 3B-1/3B-2 no pretende corregir lógica: reduce la superficie de
diagnóstico y permite saber qué función alcanzó a confirmarse.

## Orden futuro exacto

Los tres primeros pasos ya están instalados. Los quince restantes requieren una
nueva autorización de producción.

| Orden | Bloque | Nombre administrado | Bytes | SHA-256 | Estado |
|---:|---|---|---:|---|---|
| 1 | 1 | `stage_c_20261018171000_visual_schema` | 6.894 | `EB2067BBE20589BA0C35602804817ADA95C8B705804972B3C744AE09BBAD61A2` | Confirmado como `20261018213838` |
| 2 | 2 | `stage_c_20261018171100_content_suggestion_schema` | 5.409 | `D58EBD92E0A903E01273C7BC55721223456822A0B40A16A77A85597BC1BA5C9C` | Confirmado como `20261018213927` |
| 3 | 3A | `stage_c_20261018171210_visual_validators_private_functions` | 7.279 | `1F8149DF7E526BFC471459B4B5A97B4D1EA024F6F238C2C9DF4BF7A46A612FE8` | Confirmado como `20261019015434` |
| 4 | 3B-1 v2 | `stage_c_20261018171219_active_campaign_private_function_v2` | 5.903 | `3CA84542E1DFB1B2AEBF04074B2D3A364EF0540874DB5763A999CAC5B2F50756` | Validado en PostgreSQL 17.5 |
| 5 | 3B-2 | `stage_c_20261018171222_next_change_private_function` | 4.420 | `8F8461EBA5BF36C979175358CCC317869FB1D6033947414B8803280D652F7E91` | Validado en PostgreSQL 17.5 |
| 6 | 3C-1 | `stage_c_20261018171231_site_experience_private_function` | 5.051 | `12CE50CE0E4682BD5ACBC0DFAA1BE2E5355337F60B9889A4B0AFA9B83DAFCE82` | Preparado |
| 7 | 3C-2 | `stage_c_20261018171232_admin_configuration_private_function` | 4.744 | `E2DC0ED8BC58A90028A11E55794A7D01AB01023659CD01F8CEFF19DC16E6F3DA` | Preparado |
| 8 | 4A | `stage_c_20261018171251_appearance_asset_admin_private_functions` | 8.956 | `5FA98396577D575CE9D8AAAABD91E96F484944BE7B6E04629D326B0CD7158E6C` | Preparado |
| 9 | 4B | `stage_c_20261018171252_campaign_admin_private_functions` | 10.401 | `72D8DAE1ACB3BCCBDA8AC9796CD6ADE1A2B0A2E296FA9D11A0CD14A86549F29E` | Preparado |
| 10 | 4C | `stage_c_20261018171253_phrase_admin_private_function` | 3.963 | `A9650C07D4927C5D55457A86C1CF30851B1CBBD78B187069507EF9353B4B8768` | Preparado |
| 11 | 5A | `stage_c_20261018171301_content_faq_private_functions` | 9.994 | `5351734526A909BACDE0A822258B811365C680B2D046AB11E9B40EBD08D99F50` | Preparado |
| 12 | 5B | `stage_c_20261018171302_suggestion_protection_private_functions` | 5.056 | `9D47D8AF0C728234E30FDD8A1889D1C57E7CA34417236B04F4F50BB441732BB1` | Preparado |
| 13 | 5C | `stage_c_20261018171303_suggestion_admin_private_functions` | 6.093 | `145173F75D5251B448391688D9B42BCEEFE4BBFE4233D346551C6B973645432C` | Preparado |
| 14 | 6 | `stage_c_20261018171400_safe_defaults` | 6.251 | `44ECF79C0EC36BD54CA3F3DD95B04ABAD60A75DC87AA16F59A0BFF81A01F8B73` | Preparado |
| 15 | 7A-1 | `stage_c_20261018171511_public_appearance_wrappers_closed` | 8.292 | `3C2AA7CE01660504B3CF67A374DD9B31AEC09DD551330AF80A0260DE81614A8F` | Preparado |
| 16 | 7A-2 | `stage_c_20261018171512_campaign_content_wrappers_closed` | 6.956 | `AD564882527BB812BDF5CF34825AF5687D959660CD169C83D9782C6DDF6C4DE9` | Preparado |
| 17 | 7A-3 | `stage_c_20261018171513_suggestion_wrappers_closed` | 4.827 | `C02EF2B9EBFC902FBA63E6FF529274534EDA8DF8A63D46205EDA6E8C0354DF7A` | Preparado |
| 18 | 7B | `stage_c_20261018171514_api_storage_activation` | 6.765 | `10761E6C1315DF9142D0100CDACBEDCE0F7B079A809243B9BE14B7798F548B79` | Preparado |

## Responsabilidades y dependencias

- **3B-1 v2:** `stage_c_active_campaign`; depende de 3A y de las tablas de campañas.
- **3B-2:** `stage_c_next_change`; exige el centinela de 3B-1.
- **3C-1:** `get_site_experience`; exige 3A, 3B-1 y 3B-2.
- **3C-2:** `admin_get_site_configuration`; exige 3A y conserva el guard AAL2.
- **4A:** seis funciones de apariencia y recursos; exige 3A.
- **4B:** cuatro funciones de campañas; exige 3A y 3B-1.
- **4C:** una función de frases; exige 3A.
- **5A:** referencia histórica reemplazada. 5A v2 incorpora diez funciones,
  dos índices de integridad y la columna `source_draft_version`; exige 2 y 3A.
- **5B:** dos funciones de protección y persistencia de sugerencias; exige 3A.
- **5C:** tres funciones de administración y limpieza; exige 3A y 5B.
- **6:** conserva todos los valores iniciales en una unidad. Se agregó una
  compuerta que exige los centinelas 3C-1, 3C-2, 4A-C y 5A-C. No publica
  campañas, FAQ, páginas legales ni apariencia.
- **7A-1:** crea 10 wrappers de lectura pública, apariencia y recursos.
- **7A-2:** crea 9 wrappers de campañas, frases, contenidos y FAQ.
- **7A-3:** crea 5 wrappers de sugerencias. Los tres subbloques conservan los
  cuerpos originales y revocan `EXECUTE` a todos los roles de API.
- **7B:** exige 7A-3 y, como último paso atómico, crea las dos políticas de
  Storage y aplica los permisos finales previstos.

## Seguridad de estados parciales

Cada migración privada comprueba sus dependencias antes de crear funciones,
revoca permisos en la misma transacción, verifica el centinela, `search_path`,
modo de seguridad y ACL de `PUBLIC`. Ninguna función privada queda ejecutable
por roles de Data API.

7A-1, 7A-2 y 7A-3 crean wrappers sin habilitarlos. Si la instalación se detiene antes de 7B,
las funciones públicas existen pero no pueden invocarse desde `anon`,
`authenticated` o `service_role`, y el bucket continúa privado sin políticas.
7B es el único punto de activación.

Las funciones administrativas conservan `private.stage_c_assert_admin()`, que
exige identidad administrativa y AAL2. La subdivisión no sustituye ese control
por ocultamiento de interfaz.

## Paridad funcional

La suite extrae cada `CREATE OR REPLACE FUNCTION` del monolito y del conjunto
dividido. El resultado fue 56/56 nombres y 56/56 cuerpos idénticos. Para las
nueve funciones del antiguo bloque 3, la paridad también fue 9/9.

Las únicas diferencias deliberadas son operativas:

1. compuertas de dependencias;
2. centinelas independientes;
3. verificaciones y revocaciones por subbloque;
4. traslado de wrappers a 7A-1/2/3 y de permisos/políticas a 7B;
5. compuerta de dependencias previa a los datos del bloque 6.

No se cambió la resolución de campañas, validación visual, contenido, FAQ,
sugerencias, firmas, tipos de retorno ni comportamiento de negocio.

## Sonda y recuperación

`supabase/verification/stage_c_installation_status.sql` ahora reconoce los
dieciocho pasos y los siete bloques reemplazados. Para cada paso informa nombre
local, nombre registrado, versión efectiva, centinela, cantidad de objetos,
permisos y estado `confirmed`, `absent` o `inconsistent`.

- SHA-256 de la sonda:
  `4522ED9F8BBDE3A3A33C96BBB501C4A24377E7C480B291FFF08B315D77EE2F18`.
- Recuperación no destructiva:
  `supabase/rollback/20261018171500_stage_c_partial_safe_state.sql`.
- SHA-256 de recuperación:
  `8E9DF23C90F589AFE1A1C32CE13F00F33D098C03D98C0E8DE101B1F10AAC2E48`.

Ante una desconexión no se reintenta. Primero se consulta registro, centinela,
objetos y permisos. Todo presente y coherente significa confirmado; todo
ausente significa revertido; cualquier combinación distinta exige detenerse.
La recuperación revoca rutas, elimina únicamente las dos políticas de Storage
de Etapa C, mantiene el bucket privado y reafirma RLS. No borra tablas,
funciones ni datos.

## Pruebas realizadas

- Suite completa local: aprobada.
- Etapa C: 28 comprobaciones aprobadas.
- Paridad del monolito: 11/11 tablas, 9/9 índices y 56/56 funciones.
- Paridad del antiguo bloque 3: 9/9 funciones.
- Orden de dependencias, centinelas, cierres `$$`, revocaciones, `search_path`,
  AAL2 y separación 7A-1/2/3/7B: verificados estáticamente.
- Workers de recursos y sugerencias: pruebas unitarias aprobadas, incluidas
  MFA pendiente, Siteverify, hostname/action y rate limit.
- Sonda actualizada ejecutada contra producción en solo lectura: 1, 2 y 3A
  confirmados; todos los pasos nuevos ausentes; bloques sustituidos sin
  registro.

No hay PostgreSQL local, Supabase CLI, Docker ni `psql` en este entorno. La
sintaxis y el comportamiento transaccional real de los nuevos archivos no se
ejecutaron contra PostgreSQL. El análisis estático no se presenta como una
prueba SQL real.

## Estado actual de producción

La lectura fresca confirmó:

- migraciones instaladas: 1 (`20261018213838`), 2 (`20261018213927`) y 3A
  (`20261019015434`);
- 3B original revertido y todos los bloques nuevos ausentes;
- 11/11 tablas de Etapa C con RLS y cero filas;
- bucket `site-assets` privado, límite 8 MiB y cero políticas de Etapa C;
- conteos comerciales: 17 productos, 4 categorías, 35 insumos, 2 recetas,
  17 pedidos, 18 artículos, 11 movimientos, 4 presupuestos, 3 versiones,
  5 comentarios, 5 reacciones y 4 likes.

La preparación local no cambió producción.

## Respaldo local

El paquete `artifacts/stage-c-final-subdivision-local-20261018.zip` conserva las
migraciones, originales archivados, verificaciones, recuperación, el plan
operativo corregido, el informe del intento 3B-1 y la prueba de paridad.
Tamaño: 223.524 bytes. SHA-256:
`B0C3D5D44A04952ACFC8CA951C422EFAEBEE02A234F0DD4760A54EB28D9F6FFC`.

## Riesgos pendientes

1. La causa de las desconexiones continúa sin confirmarse.
2. 7A quedó dividido en archivos de 8.292, 6.956 y 4.827 bytes. Cada estado
   intermedio permanece cerrado, pero una desconexión del transporte todavía
   es posible; la sonda permite distinguir confirmación de rollback.
3. Falta validación real en PostgreSQL de todos los pasos nuevos.
4. Las pruebas funcionales con AAL2, campañas, Storage y sugerencias solo pueden
   ejecutarse después de una instalación autorizada.
5. Los archivos están preparados localmente, pero este directorio no es un
   repositorio Git; no existe commit ni publicación remota en esta etapa.

