# HorusDQ — ADR de implementación

Última revisión: 16 de noviembre de 2026. Este documento especifica el sistema destino; no indica que todos los servicios estén activos.

| ADR | Decisión | Motivo | Estado |
| --- | --- | --- | --- |
| 001 | Aplicación independiente | Mantener desacoplados Orbit Tasks, TrackVikol y Korpelyt | Aprobado |
| 002 | PWA con React y TypeScript en GitHub Pages | Experiencia móvil sin distribución en tiendas | Implementado |
| 003 | Supabase PostgreSQL + RLS por proyecto | Aislamiento de datos y permisos | Código listo; infraestructura no creada |
| 004 | Webhooks GitHub por repositorio | Eventos sin polling continuo | Código listo; configuración pendiente |
| 005 | Supabase Auth con GitHub OAuth | Inicio de sesión sin contraseña local | UI lista; proveedor pendiente |
| 006 | Resend + Web Push / VAPID | Alertas multicanal | Workers listos; credenciales pendientes |
| 007 | Health checks cada cinco minutos | Reducir consultas y falsos positivos | Función lista; cron pendiente |
| 008 | Módulos de dominio y adaptadores | Evitar acoplamiento | Adoptado como dirección de evolución |
| 009 | Outbox persistente e idempotencia | Reintentos sin duplicar avisos lógicos | Base implementada; falta endurecimiento |
| 010 | Pipeline ≠ deployment ≠ salud | Evitar falsos éxitos | Implementado en modelo |
| 011 | Reconciliación de GitHub | Recuperar webhooks perdidos | Pendiente |

## Flujo de eventos y persistencia

- Webhook GitHub autenticado por HMAC, repo allowlisted en integración, delivery ID único.
- Pipeline fallido: alerta de fallo; workflow exitoso: **no** alerta de despliegue.
- Deployment con estado success: aviso de despliegue confirmado; failure/error: aviso de fallo.
- Health: tras tres resultados fallidos se abre un incidente; tras dos correctos se resuelve. Monitor cada cinco minutos.
- Outbox por usuario y canal, con clave única por evento-destinatario-canal-dispositivo. El worker tiene límite de reintentos, auditoría e invocación autenticada.

## Riesgos y decisiones antes de producción

1. La escritura de webhook y el cambio de estado no son todavía atómicos; reforzar con inbox duradero y reintento tras interrupciones para evitar pérdida de eventos.
2. La reconciliación de GitHub aún no está implementada. No anunciar garantías de entrega completa.
3. Las URL de salud solo se comprobarán si el hostname HTTPS está expresamente permitido. Revisar DNS, SSRF, caché, protección de origen y cuota.
4. La autenticación y autorización de propietarios de repositorios deben verificarse antes de provisionar nuevas integraciones.
5. Resend necesita dominio remitente verificado; Push necesita claves VAPID, PWA instalada y permisos del usuario.
6. Los reintentos de proveedores externos no garantizan entrega exactamente una vez. Usar idempotencia y reportar estado real.
7. Realizar tests de aislamiento RLS, webhooks falsificados, recovery y E2E de Push en iOS antes de habilitar alertas reales.

Ninguna migración, función, webhook o credencial de Supabase se creó/desplegó como consecuencia de registrar estas decisiones.
