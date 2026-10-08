# Activar "Continuar con Google" en Cúbica

La interfaz ya está implementada. Para que Google permita el acceso hay que registrar Cúbica como aplicación OAuth y habilitar el proveedor en Supabase.

## 1. Google Auth Platform / Google Cloud

Crear un cliente OAuth de tipo **Web application**.

**Authorized JavaScript origins**
- https://cubica3dar-afk.github.io

**Authorized redirect URI**
- https://mymrbpwvghxmqqpzzdqk.supabase.co/auth/v1/callback

Google entregará:
- Client ID
- Client Secret

El Client Secret es privado. No debe ponerse en GitHub, index.html, JavaScript ni enviarse a clientes.

## 2. Supabase

En Authentication > Providers > Google:
- habilitar Google
- pegar Client ID
- pegar Client Secret
- guardar

En Authentication > URL Configuration:
- Site URL: https://cubica3dar-afk.github.io/cubica-web/
- agregar como Redirect URL: https://cubica3dar-afk.github.io/cubica-web/

## 3. Base de datos

Ejecutar una sola vez en SQL Editor:
- supabase_google_customers_v1.sql

Ese SQL:
- crea/actualiza perfiles de clientes
- permite que cada cliente lea solo sus propios pedidos
- permite vincular pedidos anteriores hechos como invitado si usaron el mismo email verificado por Google

## 4. Prueba

1. Abrir la tienda sin sesión.
2. Tocar el icono de usuario.
3. Elegir "Continuar con Google".
4. Elegir una cuenta Google.
5. Volver a Cúbica.
6. Abrir Perfil > Mis pedidos.

La cuenta del administrador por email/contraseña continúa funcionando.
