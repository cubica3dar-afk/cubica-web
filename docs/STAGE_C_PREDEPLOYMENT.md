# Etapa C — Informe previo al despliegue

> **Documento histórico, reemplazado.** La migración monolítica indicada aquí
> falló dos veces por desconexión y fue retirada del directorio aplicable. No
> usar sus rutas, hashes ni secuencia para un despliegue. La estrategia vigente
> está en `docs/STAGE_C_SPLIT_DEPLOYMENT_PLAN.md`.

Fecha de revisión: 2026-10-18  
Repositorio: `cubica3dar-afk/cubica-web`  
Base verificada de `main`: `27b5d99e44f4071a8420e104efe959a597cc529f` (`Deploy Community moderation Stage B`)

## Estado

La Etapa C quedó implementada y validada en la copia local. No se aplicó la
migración, no se desplegaron Edge Functions, no se modificó `main` y no se
publicó el frontend. La Etapa D no fue iniciada.

Una lectura fresca de producción confirmó que no existen todavía las tablas ni
las RPC de la Etapa C. Los conteos observados antes del despliegue son:

- 17 productos.
- 15 pedidos.
- 9 movimientos de inventario.
- 4 presupuestos.
- 5 comentarios de Comunidad.

Estos valores sirven como línea de base para la conciliación posterior.

## Implementación preparada

### C1 — Configuración y apariencia

- Nueva sección administrativa `Configuración`, protegida por el control MFA
  AAL2 ya existente.
- Colores limitados a propiedades permitidas, validación hexadecimal y
  contraste mínimo WCAG 4.5 en backend.
- Logo, banner y fondo mediante archivos JPEG, PNG o WebP validados por firma,
  dimensiones y tamaño máximo de 8 MiB.
- Bucket `site-assets` privado. Solo los recursos publicados pueden leerse por
  la política pública; los borradores permanecen privados.
- Borrador, vista previa separada para escritorio y móvil, publicación
  explícita, cancelación al estado publicado y restauración de los valores
  originales.

### C2 — Campañas

- Campañas únicas con prioridad, publicación, desactivación, duplicación y
  retiro lógico.
- Programación puntual, anual y mediante ocurrencias personalizadas.
- Resolución pública de una sola campaña mediante el orden:
  `prioridad DESC, inicio efectivo DESC, publicación DESC, id ASC`.
- Horario interpretado explícitamente como
  `America/Argentina/Buenos_Aires`.
- Frases de bienvenida globales o asociadas a una campaña.
- Calendario mensual y navegación por mes/año.
- El navegador vuelve a consultar en el próximo límite de campaña y, como
  respaldo, cada quince minutos como máximo.
- Los campos reservados para apariencia de correos están deshabilitados por
  constraint. No se modificó Resend ni ningún email.

### C3 — Contenidos públicos

- Páginas `Sobre Cúbica`, `Contacto`, `Términos` y `Normas de Comunidad`.
- Borradores privados, publicación explícita, historial inmutable de versiones
  publicadas y recuperación de una versión únicamente hacia borrador.
- No se creó ni publicó texto legal. Las páginas nacen sin versión visible.
- Editor restringido: el contenido se escapa antes de renderizar y solo se
  habilitan enlaces HTTPS o `mailto:`.
- Preguntas frecuentes con orden, búsqueda, paginación, activación,
  desactivación y eliminación lógica.
- Navegación pública compatible con el flujo prioritario de recuperación de
  contraseña.

### C4 — Sugerencias

- Formulario público con categorías controladas, límites de longitud y contacto
  opcional.
- Edge Function `submit-suggestion` con Turnstile independiente
  (`action=suggestion_submit`), validación de hostname, antigüedad, uso único
  y límite de cinco intentos por hora.
- El usuario, cuando existe, se obtiene de su JWT real. El navegador no puede
  indicar un `user_id`.
- El backend inserta mediante RPC exclusiva de `service_role`; no hay acceso
  directo a la tabla.
- Panel administrativo con búsqueda, filtros, orden, paginación, estados y
  notas privadas.
- Edge Function `site-assets` que verifica identidad y AAL2 antes de leer el
  archivo o tocar Storage.

## Esquema y seguridad

La migración crea once tablas en `private`:

1. `site_assets`
2. `site_appearance_versions`
3. `site_campaigns`
4. `site_campaign_occurrences`
5. `site_welcome_phrases`
6. `site_content_pages`
7. `site_content_versions`
8. `site_faq_items`
9. `site_suggestions`
10. `suggestion_token_uses`
11. `suggestion_rate_limits`

Todas habilitan RLS, tienen políticas de denegación directa para
`anon`/`authenticated` y revocan acceso de tabla. Las lecturas públicas son
proyecciones acotadas mediante RPC: experiencia publicada, contenido publicado
y FAQ visible.

Las operaciones administrativas pasan por
`private.stage_c_assert_admin()`, que exige sesión, rol administrativo y el
control MFA AAL2 de `private.is_admin()`. Los wrappers públicos administrativos
son `SECURITY INVOKER`; sus implementaciones privilegiadas fijan
`search_path=''` y repiten el control.

La lectura de producción confirmó que `service_role` no posee `USAGE` sobre
`private`. Para evitar ampliar ese permiso, los wrappers públicos de
sugerencias usan `SECURITY DEFINER`, se conceden exclusivamente a
`service_role`, fijan `search_path=''` y la implementación verifica además
`auth.role()='service_role'`. Las funciones privadas no son ejecutables
directamente por ese rol.

## Pruebas ejecutadas

La batería completa finalizó correctamente:

- Fórmulas y privacidad de presupuestos.
- Interfaz general y regresiones visuales existentes.
- Etapa A y corrección de categorías.
- Etapa B y moderación de Comunidad.
- 20 controles específicos de Etapa C.

Los controles de Etapa C cubren:

- tablas privadas, RLS, bucket y política de recursos publicados;
- control AAL2 administrativo;
- desempate, recurrencias, calendario y horario de campañas;
- aislamiento entre borradores y contenido público;
- historial y recuperación de contenido;
- búsqueda, paginación, orden y eliminación lógica de FAQ y frases;
- sugerencias sin suplantación de usuario;
- Turnstile válido, hostname/acción inválidos, replay y límite de uso;
- ausencia de pedidos creados por una sugerencia;
- validación binaria de imágenes y rechazo AAL1 previo a Storage;
- navegación, vistas previas y responsive;
- rollback no destructivo.

La sintaxis JavaScript fue validada para el frontend y ambas Edge Functions.
El escaneo final no encontró patrones de secretos privados fuera de valores
ficticios de los tests.
La comprobación local se realizó a 390 px y 1280 px sin desbordamiento
horizontal. El formulario se renderiza correctamente. Cloudflare devuelve
`110200` en `localhost`, comportamiento esperado porque la Site Key de
producción solo admite `cubica3d.ar`. Se confirmó una sola carga del script de
Turnstile; ya no existe la advertencia por carga duplicada.

No se ejecutó la migración SQL contra producción ni contra una base local real,
porque el entorno disponible no incluye PostgreSQL/Supabase local y esta etapa
no autorizó cambios en producción. La validación real de tipos, RLS, políticas
de Storage y RPC queda incluida en la prueba transaccional posterior a la
autorización.

## Security Advisor previo

El Advisor de producción no muestra objetos de Etapa C porque todavía no fueron
instalados. Mantiene hallazgos anteriores:

- 8 tablas privadas con RLS y sin políticas: configuración legítima de
  denegación total por acceso directo.
- 1 función pública de Analytics ejecutable por anónimos: advertencia existente
  sobre `track_public_event`, fuera del alcance de esta etapa.
- 17 funciones ejecutables por usuarios autenticados: corresponden a wrappers
  existentes que validan propiedad o administración/MFA en backend; deberán
  volver a clasificarse tras la migración.
- Protección de contraseñas filtradas desactivada: hallazgo previo de Auth,
  sujeto a la disponibilidad del plan y fuera del alcance de Etapa C.

Después de aplicar la migración se debe ejecutar otra vez el Advisor y revisar
cada hallazgo nuevo. La Etapa C evita tablas sin RLS y evita funciones
administrativas accesibles por `anon`.

## Archivos principales

- `supabase/migrations/20261018170000_site_configuration_stage_c.sql`
- `supabase/rollback/20261018170000_site_configuration_stage_c_rollback.sql`
- `supabase/functions/site-assets/index.ts`
- `supabase/functions/site-assets/worker.js`
- `supabase/functions/submit-suggestion/index.ts`
- `supabase/functions/submit-suggestion/worker.js`
- `js/site-experience.js`
- `js/ui-shell.js`
- `index.html`
- `styles.css`
- `tests/site-configuration-stage-c.test.mjs`
- `tests/site-configuration-stage-c.sql`
- `docs/STAGE_C_RECOVERY.md`

Hashes SHA-256 finales:

- Migración: `561BC72B285C1AACC56F395100C2D0F0C6D4E1080F935539A6488874B1910795`
- Rollback: `DD6C51632737ABE2FA5512E8D71094905789218B2098BCBFB4DC03CAC515A214`
- `submit-suggestion/worker.js`:
  `BE08D83D5EA869305CBED1C96D46836FD2808ABC4301AD805B9A383E416EE706`
- `site-assets/worker.js`:
  `4FD1FC0B46C32D1DA1829C03B3C127C50B41A214B4179CDEC56DEA108116BFD4`

## Requisitos y secuencia de despliegue propuesta

Antes de desplegar se necesita crear un secreto privado nuevo:
`SUGGESTION_RATE_LIMIT_SALT`, con un valor aleatorio independiente. La clave
`TURNSTILE_SECRET_KEY` existente se reutiliza. Ningún valor debe almacenarse
en GitHub ni en el frontend.

Secuencia:

1. Guardar inventario de definiciones, permisos y conteos de producción.
2. Confirmar el hash de migración y rollback.
3. Aplicar la migración de Etapa C.
4. Ejecutar `tests/site-configuration-stage-c.sql` dentro de transacciones que
   finalizan en `ROLLBACK`, incluyendo AAL1, AAL2, cliente y anónimo.
5. Verificar RLS, permisos efectivos, bucket privado, campañas y ausencia de
   residuos QA.
6. Ejecutar Security Advisor y clasificar cualquier aviso nuevo.
7. Configurar `SUGGESTION_RATE_LIMIT_SALT`.
8. Desplegar `site-assets` con verificación JWT y
   `submit-suggestion` sin verificación automática del gateway; esta última
   valida internamente JWT opcional y Turnstile para admitir visitantes.
9. Publicar el frontend en `main`.
10. Verificar GitHub Pages, escritorio, móvil, Auth, recuperación, Checkout,
    pedidos, presupuestos, Comunidad, Analytics, inventario y MFA.

## Recuperación

La recuperación se documenta en `docs/STAGE_C_RECOVERY.md`:

1. Volver el frontend al commit estable
   `27b5d99e44f4071a8420e104efe959a597cc529f`.
2. Ejecutar el rollback de Etapa C.
3. El rollback revoca las rutas nuevas y la lectura pública de recursos, pero
   conserva tablas, versiones, sugerencias y archivos para no perder datos.
4. Revalidar los flujos críticos con un administrador AAL2.

Si la migración, RLS, Storage o una regresión crítica fallan, no se publica el
frontend. Si el problema aparece después de publicarlo, se vuelve primero al
frontend estable y luego se aplica el rollback no destructivo.

## Pendientes que requieren autorización

- Aplicar la migración de Etapa C en producción.
- Crear el secreto `SUGGESTION_RATE_LIMIT_SALT`.
- Desplegar las dos Edge Functions.
- Ejecutar las pruebas SQL transaccionales reales.
- Publicar el frontend y confirmar GitHub Pages.

No se requiere publicar textos legales, enviar emails, crear pedidos ni tocar
datos comerciales para completar ese despliegue.
