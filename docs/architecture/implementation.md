# HorusDQ — integración backend

**Estado:** código preparado; proyecto Supabase, OAuth, webhooks y correo todavía sin configurar.

## Arquitectura
GitHub workflow_run/deployment_status → receptor firmado → tablas PostgreSQL con RLS → outbox por usuario/canal → despachador Push/Resend. Monitor HTTP cada 5 minutos, 3 fallos para caída, 2 aciertos para recuperación.

## Puesta en marcha (requiere autorización de infraestructura y costes)
1. Crear un proyecto Supabase independiente exclusivamente para HorusDQ. Nunca ejecutar migraciones en Orbit Tasks, TrackVikol ni Identity Lab.
2. Aplicar la migración, revisar políticas RLS y advisories.
3. Configurar GitHub OAuth en Supabase Auth y los redirect URL para GitHub Pages.
4. Variables públicas de build: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_VAPID_PUBLIC_KEY.
5. Secretos exclusivamente en Edge Functions: GITHUB_WEBHOOK_SECRET, HORUSDQ_WORKER_SECRET, RESEND_API_KEY, RESEND_FROM_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, HORUSDQ_HEALTH_HOSTS.
6. Implementar GitHub Webhooks con firma HMAC para workflow_run y deployment_status. Registrar exclusivamente repositorios que el propietario autorice.
7. Programar health-monitor cada cinco minutos y dispatch-notifications periódicamente; autenticar las invocaciones por x-worker-secret almacenado en Vault.
8. Verificar dominio remitente de Resend, cuotas y costos antes de activar el correo.

## Limitaciones antes de producción
- La ingesta inicial de webhook registra delivery ID antes de completar el procesamiento: un fallo a mitad puede causar que el reintento se ignore. Se debe refinar con inbox duradero antes de habilitarlo en producción.
- Los reintentos son best-effort; la aceptación del proveedor no implica entrega visual ni lectura.
- El health check consulta únicamente HTTPS sin redirecciones y nombres de host explícitamente permitidos. No habilitar hostnames arbitrarios ni direcciones internas.
- Un workflow exitoso NO significa que el despliegue haya terminado correctamente.
- No se han activado servicios ni registrado credenciales.
