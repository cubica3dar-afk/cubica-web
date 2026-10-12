# Community + rendimiento por producto v1

## Uso

En el detalle de cada producto se leen opiniones y respuestas sin sesión. Los likes del producto y de cada comentario son públicos. Comentar, responder y reaccionar requiere una cuenta; se utiliza el acceso existente y se vuelve al producto. El enlace directo es `?product=ID`. Se conserva la prioridad de recuperación de contraseña y de `?view=orders`, incluido el retorno guardado del login.

Producto: una reacción por usuario, like/dislike/sin reacción. El cliente envía el estado deseado; repetir la petición no alterna nuevamente la reacción. El número de dislikes solo se consulta desde Análisis mediante validación administrativa. El público únicamente recibe los likes y su propia reacción.

Comentarios: texto plano de 1 a 2000 caracteres, publicación automática, un nivel de respuestas, likes sin dislikes. Edición propia solo mientras no haya existido ninguna respuesta, incluso si esa respuesta fue ocultada/eliminada. Borrar hace soft-delete; un comentario raíz eliminado conserva el hilo y las respuestas existentes, pero no admite respuestas nuevas. Una raíz oculta oculta también sus respuestas; restaurar la raíz conserva la moderación individual de cada respuesta.

La eliminación conserva el contenido privado para moderación. El público recibe un marcador sin contenido ni identidad de la raíz eliminada si tiene respuestas visibles; si no, se omite. Ocultar/restaurar cambia la visibilidad, no revierte el soft-delete. Comunidad, en el panel lateral administrativo, muestra producto, autor público, fecha, contenido, estado y marca de eliminación.

La identidad pública usa display_name; si falta o contiene un email, muestra Cliente de Cúbica. No incluye user_id, email ni datos del pedido. Avatares HTTPS solo de Googleusercontent o del Storage público de este proyecto; el cliente escapa el texto y las URLs. Si no hay avatar apropiado se muestra el nombre. La insignia Compra verificada se calcula con pedidos del autor que actualmente estén Entregado y contengan el ID del producto, incluidos pedidos históricos reclamados. No basta un pedido pendiente, preparado o cancelado.

Paginación: raíces de a 10, máximo 20 por RPC; respuestas con su propia paginación; moderación de a 20, máximo 50. Cursores descendentes por ID, sin descargar todo el historial. Los perfiles, compras verificadas y conteos se resuelven en una consulta del backend por página.

## Esquema, RPC y seguridad

Tablas en private: community_comments, product_reactions y comment_likes. Todas tienen RLS, políticas deny para anon/authenticated y ningún privilegio de tabla para esos roles. Los likes/reacciones tienen claves primarias por recurso/usuario. Los comentarios tienen una referencia única usuario/request_id para reintentos. La autoría, producto y padre son inmutables; un trigger exige raíz del mismo producto y bloquea reply-to-reply. Existe además un constraint que impide que un comentario sea su propio padre.

RPC públicos SECURITY INVOKER, con implementaciones SECURITY DEFINER en private, search_path vacío y parámetros fijos:

- get_product_community: lectura pública acotada; sin total de dislikes, emails o pedidos.
- set_product_reaction: usuario autenticado, reacción propia deseada -1/0/1.
- create_community_comment: autor derivado de auth.uid(), request_id y publicación automática.
- edit_community_comment y delete_community_comment: propiedad validada; el administrador también puede eliminar.
- set_comment_like: estado deseado booleano, comentario visible, usuario derivado de auth.uid().
- get_community_moderation y moderate_community_comment: auth.uid() + private.is_admin().
- get_product_performance: misma validación administrativa; ninguna lectura pública de dislikes o ratio positivo.

Solo get_product_community es ejecutable por anon. El resto requiere authenticated y comprueba propiedad o rol en backend. No se modificaron las políticas RLS anteriores. No se añadieron secretos, cambios a Auth, nuevos correos ni Edge Functions sociales. order-emails v14, outbox, leases, Vault, reintentos e idempotencia permanecen intactos.

Migraciones aplicadas:

1. 20261012041951_community_and_product_performance.sql.
2. 20261012043316_community_immutable_relationships.sql.
3. 20261012044626_community_nonblank_content.sql: rechaza contenido formado solo por espacios/saltos/tabs y acota URLs de avatar.

Índices para páginas, padres, autores, reacciones/likes y order_items(product_id,order_id).

## Definición de métricas

Análisis → Productos agrega la tabla de rendimiento, ordenable por métricas, manteniendo los KPI y la tabla de ventas/margen existentes. El período propio ofrece 7/30/90 días o Todo. Son días calendario desde medianoche de Argentina, incluido hoy, hasta now(). Reacciones y comentarios son una fotografía ACTUAL, independiente del período; esto se indica en pantalla. No se infiere un historial de votos retirados u ocultamientos que el esquema no conserva.

- Vistas: filas existentes analytics_events con event_name=product_view y product_id.
- Sesiones de vistas: session_id no vacío distinto entre esas vistas. Son sesiones del navegador, no personas o usuarios únicos; no se añade identificación ni fingerprinting.
- Carritos: filas add_to_cart del producto; cuenta acciones de agregar, no unidades ni carritos únicos.
- Pedidos: COUNT(DISTINCT orders.id) que incluyan el producto, por fecha de creación del pedido y excluyendo Cancelado, igual que las reglas comerciales de Analytics actual.
- Unidades: suma de order_items.qty de esos pedidos. Se agregan las líneas del mismo producto y sus colores/variantes.
- Facturación: suma de order_items.line_total de esas líneas, precios realmente guardados. Es importe de pedidos válidos, no prueba de pago ni solo pedidos entregados; se conserva la definición existente.
- Likes y dislikes: reacciones activas actuales. Dislikes exclusivamente administrativos.
- Comentarios: contenido publicado no eliminado, incluidas respuestas con raíz publicada. No cuenta marcadores eliminados ni hilos ocultos.
- Vista → carrito: acciones add_to_cart / vistas × 100.
- Vista → pedido: pedidos distintos válidos / vistas × 100.
- Positivas: likes / (likes + dislikes) × 100, exclusivamente administrativo.

Si el denominador es cero, se muestra —. Las conversiones son razones de actividad del período y pueden superar 100%; no atribuyen un pedido a una persona ni a una vista concreta. Purchase no se utiliza para contar ventas por producto: los eventos históricos no tienen product_id y pueden repetirse. El registro de product_view/add_to_cart/purchase no se rehizo ni se añadió un segundo emisor. La nueva tabla agrega en SQL los eventos existentes, sin el límite de 5000 eventos del dashboard anterior y sin recorrerlos en frontend. Productos retirados físicamente y líneas históricas sin product_id no pueden atribuirse con fiabilidad a un producto actual.

## QA y resultados

- tests/community-rollback.sql ejecutado contra la base real en BEGIN/ROLLBACK: lectura pública, propiedad, publicación idempotente, edición, respuestas, rechazo de segundo nivel, soft-delete con hilo, moderación, like/dislike/cambio/quitar, like de comentario idempotente/quitar, badge sin compra/preparado/entregado, reclamo real de pedidos históricos, ausencia de email/ID de pedido público, privilegios privados, author inmutable, paginación sin solapamiento, conservación del borrado de catálogo, métricas 7/30/90/todo, variantes/múltiples productos, cancelaciones excluidas, eventos purchase duplicados sin duplicar ventas y razones sin división por cero.
- tests/community-navigation.test.cjs: enlace público, destino guardado para email/Google, apertura única, producto no disponible y prioridad de recuperación/orders, incluido el retorno guardado.
- Regresiones: tests/order-lifecycle.sql en rollback, 20 tests de correos/worker, navegación de Mis pedidos, KPI de Analytics y tests de recuperación temprana/recarga/logout/formulario asíncrono.
- Verificación visual con fixtures locales en ~390 y ~1280 px: lectura, acceso y retorno Google simulado, reacciones, crear/editar/responder, bloqueo de edición con respuestas, moderación y rendimiento ordenable; sin errores de consola ni desbordamiento del documento. Las tablas administrativas usan scroll horizontal.
- create_public_order, claim_my_guest_orders y track_public_event: definiciones idénticas a las anteriores.
- No se dejaron usuarios, comentarios, reacciones, pedidos o correos de QA comprometidos en Supabase.
- Revisión de seguridad: las tres tablas nuevas tienen RLS y no son legibles por anon/authenticated. Ningún aviso de seguridad nuevo. Permanecen los avisos preexistentes de RPC SECURITY DEFINER intencionales y protección de contraseñas filtradas. Referencias: https://supabase.com/docs/guides/database/database-linter y https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
- Performance: ningún FK nuevo sin índice; los índices nuevos figuran sin uso acumulado por ser recientes. Se mantienen los índices para acceso y mantenimiento de FK; no se eliminan por ese aviso inicial.

Limitación de QA: el retorno Google/email se verifica con pruebas y fixtures de interfaz, conservando los proveedores existentes; no se abrió una sesión real nueva ni se enviaron correos/contraseñas durante QA. Las reacciones son actuales y las conversiones no son atribución de marketing. No hay perfiles públicos, seguidores, mensajes privados, notificaciones sociales ni estrellas.
