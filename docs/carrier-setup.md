# Cotización de transportistas: habilitación pendiente

Estado al 12 de octubre de 2026: Diego confirmó que todavía no tiene contratos ni credenciales de Correo Argentino, Andreani u OCA. La función `shipping-quotes` no devuelve tarifas inventadas. Los tres adaptadores de producción devuelven `not_configured`; activarlos en Administración por sí solo no habilita acceso comercial. El retiro coordinado sigue disponible.

## Arquitectura implementada

`shipping-quotes/index.ts` inicia el handler sin dependencias externas. `worker.js` valida la solicitud, consulta Auth para un JWT de usuario, genera una capacidad aleatoria de 256 bits para la cotización y llama a los RPC de preparación/finalización restringidos a `service_role`. Invitados y usuarios autenticados están soportados. No se confía en precios, medidas, márgenes, existencias ni `user_id` del navegador.

`providers.js` contiene un registro extensible. Cada adaptador define `configuration(env)` y `quote(snapshot, {fetchImpl, signal})`; devuelve tarifas normalizadas `{code, service_code, label, base_price_ars, valid_until}`. Cada proveedor tiene un timeout independiente. Una falla no elimina respuestas válidas de otros. La selección y los importes finales se recalculan en SQL con la configuración privada almacenada. Las respuestas al cliente incluyen únicamente ID/capacidad, estado, vigencia, precio final y etiqueta pública del servicio.

No se crean etiquetas, se pagan envíos, se consume inventario ni se consultan páginas comerciales mediante scraping. Los adaptadores con respuestas simuladas se inyectan exclusivamente en `tests/shipping-quotes.test.mjs`; no existen tarifas de respaldo en producción.

## Correo Argentino

La documentación oficial MiCorreo describe credenciales API independientes por ambiente, autenticación Basic mediante `POST /token` y cotización autenticada mediante `POST /rates`. El request utiliza `customerId`, códigos postales, entrega a domicilio `D` y peso/dimensiones. La respuesta contiene tarifas, servicio y vigencia. Deben solicitarse acceso API, credenciales y el identificador de la cuenta; no se usa automáticamente la contraseña personal del cliente. [API MiCorreo oficial](https://www.correoargentino.com.ar/MiCorreo/public/img/pag/apiMiCorreo.pdf).

Falta habilitar el acceso comercial, verificar con Correo el contrato actual (el documento público abierto conserva una fecha anterior), recibir las credenciales de QA/producción y `customerId`, implementar el adaptador contra esa versión confirmada y probar peso, dimensiones, domicilio, cobertura, impuestos y expiración con la cuenta de Cúbica. Las bases publicadas son `https://apitest.correoargentino.com.ar/micorreo/v1` y `https://api.correoargentino.com.ar/micorreo/v1`. No se efectuaron requests autenticados.

## Andreani

Andreani publica que para obtener credenciales de QA es necesario ser cliente y contactar al área comercial o al ejecutivo de cuenta. Su portal anuncia APIs de cotización, creación y seguimiento. [Portal oficial Andreani Developers](https://developers.andreani.com/).

El acceso a `/document` devolvió HTTP 403 en esta revisión; no se pudo verificar el contrato completo de autenticación, parámetros o respuesta. Falta la cuenta comercial, contratos habilitados para entrega a domicilio, credenciales QA/producción y documentación vigente facilitada por Andreani. El adaptador seguirá desactivado hasta validar ese contrato e implementar/probar su respuesta real. No se tomó un endpoint ni un esquema de terceros como fuente de verdad.

## OCA

OCA documenta `Tarifar_Envio_Corporativo` en e-Pak mediante GET/POST/SOAP, con CUIT, operativa, peso en kg, volumen en m³, códigos postales, cantidad de paquetes y valor declarado. Publica ambientes QA y producción; para ciertas operaciones hace falta usuario e-Pak. [Guía oficial e-Pak](https://developers.oca.com.ar/epak.html), [contrato oficial de cotización](https://webservice.oca.com.ar/epak_tracking/Oep_TrackEPak.asmx?op=Tarifar_Envio_Corporativo).

Falta contratar/habilitar una operativa de entrega a domicilio para Cúbica, validar el CUIT/cuenta y obtener una respuesta XML de QA respaldada por OCA para confirmar cómo identificar tarifa, impuestos, vigencia, errores y cobertura. El WSDL público describe un `DataSet` genérico; no alcanza para adivinar los nombres o la semántica de sus campos de precios. No se cotizó usando cuentas o CUIT de ejemplos. Producción publicada: `https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx/Tarifar_Envio_Corporativo`.

## Configuración segura y activación futura

1. Configurar privadamente origen operativo, medidas/peso reales de los productos, cajas y componentes de embalaje. Una cotización incompleta queda `needs_configuration`.
2. Obtener accesos de cada transportista y confirmar por escrito el servicio a domicilio y la interpretación de impuestos/precios. No pegar claves en chat ni incorporarlas al repositorio.
3. Guardar credenciales únicamente como secretos de Edge Functions/Vault; agregar el adaptador oficial y probarlo primero en QA. Los secretos exactos dependerán del contrato verificado, por eso no se crean nombres ficticios de claves como si fueran requerimientos comerciales confirmados.
4. Probar respuestas válidas, cobertura ausente, errores, timeout, expiración y comparación final con márgenes y embalaje; recién entonces habilitar el adaptador en producción. Nunca activar automáticamente por la mera presencia de una variable de entorno.
5. Mantener `verify_jwt=false` para invitados y la validación de JWT en el handler; la clave publicable se envía en `apikey`, el JWT del usuario en `Authorization`. [Autorización oficial de Edge Functions](https://supabase.com/docs/guides/functions/auth-headers).

La función usa `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` internos del runtime. Opcionales: `SHIPPING_ALLOWED_ORIGINS` para orígenes de desarrollo explícitos y `SHIPPING_RATE_LIMIT_SALT` para rotar el hash del identificador de red sin revelar IPs. El rate limiting persistente de SQL debe validarse detrás del gateway antes de habilitar consultas con costos externos; los encabezados de proxy requieren una fuente confiable. CORS no reemplaza autorización ni limita clientes ajenos al navegador.

Las condiciones almacenadas al confirmar el pedido quedan inmutables: diferencias posteriores se registran como costo real/logística, sin aumentar el total aceptado por el cliente.

