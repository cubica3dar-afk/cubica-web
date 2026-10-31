# Etapa C — procedimiento preparado para Supabase CLI

**No ejecutar sin autorización nueva.** Este procedimiento evita mezclar los
timestamps locales con las versiones efectivas que Supabase ya asignó en
producción.

## Método recomendado

Usar Supabase CLI con conexión PostgreSQL directa desde un directorio de
despliegue aislado. No usar el directorio canónico actual como fuente directa:
sus timestamps de los bloques 1, 2 y 3A no coinciden con las versiones
efectivas remotas `20261018213838`, `20261018213927` y `20261019015434`.

1. Instalar y fijar una versión de Supabase CLI solo con autorización futura.
2. Crear un directorio temporal limpio y obtener allí el historial remoto con
   `supabase migration fetch --db-url <URL>`. La URL y la contraseña deben
   suministrarse por variable de entorno y nunca guardarse ni imprimirse.
3. Ejecutar `supabase migration list --db-url <URL>` y exigir coincidencia
   exacta entre local y remoto antes de añadir archivos pendientes.
4. Copiar **una sola** migración aprobada al directorio aislado.
5. Ejecutar `supabase db push --dry-run --include-all --db-url <URL>`. El plan
   debe contener exclusivamente el archivo permitido. Cualquier migración
   adicional obliga a detenerse.
6. Con autorización de escritura futura, ejecutar el mismo `db push` sin
   `--dry-run`. El CLI aplica el SQL y registra su timestamp como una sola
   operación de migración; no se usa `migration repair`.
7. Verificar historial, centinela, firma, `search_path`, modo de seguridad y
   ACL. Recién entonces incorporar el siguiente archivo y repetir desde el
   paso 4.
8. Ante desconexión, no reintentar: consultar historial y centinela. Detenerse
   si el resultado no es inequívoco.

El uso de `--include-all` es necesario porque las nuevas versiones locales son
anteriores a la última versión efectiva remota. El `dry-run` y el directorio
aislado impiden que eso incorpore por accidente migraciones históricas.

## Alternativa: SQL Editor

SQL Editor queda como contingencia. Cada archivo se ejecutaría en una
transacción con `lock_timeout`, `statement_timeout`, preflight y comprobación
posterior. SQL Editor no registra el historial de migraciones.

Después de una aplicación manual confirmada, una autorización separada tendría
que permitir la reconciliación oficial:

1. capturar `supabase migration list`;
2. comprobar archivo, hash, objeto y centinela;
3. ejecutar `supabase migration repair <version_exacta> --status applied`;
4. volver a ejecutar `migration list` y `db push --dry-run`;
5. detenerse si la versión reparada no es exactamente la del archivo aplicado.

`migration repair` solo corrige el historial: no ejecuta el SQL. Nunca se debe
insertar ni editar directamente `supabase_migrations.schema_migrations`.

## Riesgos y controles

- **Doble aplicación:** historial remoto importado, una migración por vez y
  `dry-run` obligatorio.
- **Versión equivocada:** directorio aislado y lista de versiones autorizadas.
- **Permisos prematuros:** verificador de cada bloque y wrappers 7A cerrados
  hasta 7B.
- **Conexión interrumpida:** no reintentar hasta conciliar registro, centinela y
  objeto.
- **Credenciales:** usar variable de entorno efímera; no guardar URL, password
  ni tokens en archivos o logs.

La CLI no está instalada ni fue conectada a producción durante esta preparación.

