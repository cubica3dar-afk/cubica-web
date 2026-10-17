# Seguridad pendiente de Cúbica 3D

Este documento reúne mejoras recomendadas que quedaron fuera de la etapa de catálogo y administración. No cambia la configuración actual de Turnstile, Auth, Community ni Analytics.

## Prioridad alta — límites de Community

**Riesgo:** una cuenta autenticada puede generar comentarios, respuestas o reacciones con una frecuencia excesiva. Las reglas de identidad y propiedad evitan la suplantación, pero no limitan el volumen.

**Propuesta futura:** aplicar límites por usuario y por producto en RPC/backend, con ventanas cortas para ráfagas y una ventana diaria más amplia. Mantener operaciones idempotentes, registrar rechazos sin contenido personal y probar que la moderación administrativa no quede limitada.

## Prioridad alta — límites de Analytics

**Riesgo:** `track_public_event` puede recibir eventos repetidos o automatizados que distorsionen métricas y aumenten el consumo de base de datos.

**Propuesta futura:** definir frecuencia máxima por sesión, evento y producto; deduplicar eventos equivalentes en una ventana breve; evaluar muestreo para vistas; conservar compras derivadas de pedidos como fuente comercial autoritativa. Evitar identificadores invasivos y documentar cualquier cambio en las fórmulas.

## Prioridad media — protección antibots en Auth

**Riesgo:** el registro y la recuperación de contraseña pueden usarse para automatizar solicitudes de correo o crear cuentas no deseadas.

**Propuesta futura:** revisar primero los límites y controles nativos de Supabase Auth. Si resultan insuficientes, evaluar un desafío administrado compatible con Google, email, confirmación y recuperación. Medir falsos positivos antes de exigirlo a todos los usuarios.

## Prioridad media — contraseñas filtradas

**Riesgo:** un usuario podría elegir una contraseña conocida como comprometida.

**Propuesta futura:** comprobar en el panel de Supabase si la protección contra contraseñas filtradas está disponible en el plan contratado, documentar su costo si requiere un plan pago y solicitar autorización antes de contratar o activar una función con costo. Validar recuperación, cambio de contraseña y creación de cuenta después de habilitarla.

## Criterio para la siguiente etapa

Cada mejora debe implementarse con pruebas de abuso y regresión, sin exponer secretos ni datos personales. Los límites deben devolver mensajes comprensibles y no bloquear el uso normal de clientes ni las tareas administrativas con MFA AAL2.

