# Etapa C — preparación final y validación PostgreSQL 17

> Documento histórico. Para versiones y hashes vigentes usar
> `STAGE_C_SPLIT_DEPLOYMENT_PLAN.md`. En particular, 5A fue reemplazada el
> 2026-10-22 por 5A v2 (`20261018171256`).

Fecha: 2026-10-19. Alcance: correcciones y pruebas locales; producción en solo
lectura.

## Resultado

La preparación queda lista para una autorización posterior de despliegue. La
función `private.stage_c_active_campaign(timestamptz)` devuelve exactamente los
26 atributos de `private.site_campaigns`; `effective_start` se usa solo para el
orden. `private.stage_c_next_change(timestamptz)` califica las referencias
ambiguas y calcula próximas ocurrencias sin construir fechas inválidas.

La regla definitiva para una campaña anual con 29 de febrero es:

- se ejecuta únicamente en años bisiestos;
- en otros años se omite la ocurrencia completa que dependa de esa fecha;
- no se desplaza al 28 de febrero ni al 1 de marzo;
- no se llama `make_date` con una fecha inexistente;
- el próximo cambio busca el siguiente año válido, incluso en el salto
  gregoriano 2100–2104.

La administración acepta 29/02 usando un año bisiesto exclusivamente para
validar la configuración. La interfaz muestra una advertencia informativa al
seleccionar 29/02 como inicio o fin anual.

## Validación aislada

Las pruebas se ejecutaron en PGlite 0.3.16, basado en PostgreSQL 17.5, con
esquema mínimo y datos ficticios. Producción usa PostgreSQL 17.11.

Resultados comprobados por invocación real:

- reproducción del SQL original defectuoso: SQLSTATE `XX000`, `nsitem not
  found (internal error)`;
- creación de las funciones corregidas;
- retorno compuesto de 26 campos y tipos exactos;
- ausencia de campaña;
- campaña única y límites `[inicio, fin)`;
- superposiciones y desempates por prioridad, inicio efectivo, publicación e
  ID;
- recurrencia anual y cruce diciembre–enero;
- ocurrencias personalizadas;
- 29/02 activo en 2028 y omitido sin error en 2027;
- próximo cambio correcto en 2028 y 2104;
- ocurrencia cuyo fin 29/02 no existe omitida por completo;
- compatibilidad real con `stage_c_next_change`, `get_site_experience` y las
  funciones administrativas posteriores;
- `SECURITY DEFINER`, `search_path=''`, retorno, volatilidad y ausencia de
  `EXECUTE` para `PUBLIC`, `anon`, `authenticated` y `service_role`.

La suite completa aprobó presupuestos, experiencia, Etapa A, categorías,
Comunidad/Etapa B y las 28 comprobaciones de Etapa C.

## Archivos y hashes definitivos afectados

| Archivo | SHA-256 |
|---|---|
| `20261018171218_stage_c_active_campaign_private_function_v3.sql` | `D8A1556A05387F6ACF674D3E3BBCFC1B313D9F5E044E64CC8059EBB6DF64184B` |
| `20261018171223_stage_c_next_change_private_function_v2.sql` | `175A658DE73E7650EDA8084F1374F0C0A323728C94F922ACB30173D7862786C7` |
| `20261018171231_stage_c_site_experience_private_function.sql` | `3980FA2AE7A570559B2ACD2A3AEF0CD5B4FD2F9BF53DACE311B5A90D0D1FA29A` |
| `20261018171252_stage_c_campaign_admin_private_functions.sql` | `CB1421D6F6F4CD8566B85974860B9E5AC1C6F54CBB10CFA2ADC50EA1AAEFB0EB` |
| `20261018171218_verify.sql` | `A1A6431D5F903888121043C13A924D592D40478DBE076D54358C3BF148016D98` |
| `20261018171223_verify.sql` | `5F341725B313B1878017AA7CB2247B9232CD17303B8E484186B728B6CC2C2037` |
| `stage_c_installation_status.sql` | `578761415D8566A1EB61940B8001F2253603BF6398DA045200AE491B9A1C1693` |
| `20261018171500_stage_c_partial_safe_state.sql` | `8E9DF23C90F589AFE1A1C32CE13F00F33D098C03D98C0E8DE101B1F10AAC2E48` |
| `js/site-experience.js` | `A262B4964DE1BBD8AE765BA8090A369F61ECD99D7D54C8626892A170358EAFB2` |

Las versiones previas `20261018171219`, `20261018171221` y `20261018171222`
quedaron archivadas y no forman parte del orden activo.

## Orden pendiente

1. 3B-1 v3 (`20261018171218`).
2. 3B-2 v2 (`20261018171223`).
3. 3C-1 (`20261018171231`).
4. 3C-2 (`20261018171232`).
5. 4A (`20261018171251`).
6. 4B (`20261018171252`).
7. 4C (`20261018171253`).
8. 5A v2 (`20261018171256`; reemplaza a `20261018171301`).
9. 5B (`20261018171302`).
10. 5C (`20261018171303`).
11. 6 (`20261018171400`).
12. 7A-1 (`20261018171511`, 10 wrappers cerrados).
13. 7A-2 (`20261018171512`, 9 wrappers cerrados).
14. 7A-3 (`20261018171513`, 5 wrappers cerrados).
15. 7B (`20261018171514`, activación final).

El orden completo con todos los hashes está en
`docs/STAGE_C_SPLIT_DEPLOYMENT_PLAN.md`.

## Despliegue recomendado e historial

Se recomienda Supabase CLI con conexión directa desde un directorio aislado,
historial remoto obtenido primero, una migración por vez y `db push --dry-run
--include-all` obligatorio. Este método conserva el historial sin usar
`migration repair`. El procedimiento exacto está en
`docs/STAGE_C_CLI_DEPLOYMENT_RUNBOOK.md`.

SQL Editor queda como contingencia. Si se usa, requiere reconciliación posterior
mediante el comando oficial `migration repair` y autorización específica. No se
debe modificar directamente `supabase_migrations.schema_migrations`.

## Producción

La última lectura confirma que producción conserva únicamente los bloques 1,
2 y 3A de Etapa C. La función activa corregida y los bloques posteriores siguen
ausentes; las 11 tablas conservan RLS, `site-assets` permanece privado y los
datos comerciales no cambiaron. No se ejecutaron migraciones, SQL Editor,
`migration repair`, secretos, Edge Functions ni publicación de frontend.

Riesgos pendientes: la conexión directa futura requiere credencial de base y
una ruta compatible con la red; el salto PostgreSQL 17.5→17.11 debe cerrarse con
verificadores posteriores en producción; una interrupción exige conciliación
antes de reintentar; la activación 7B debe seguir separada de los wrappers 7A.

