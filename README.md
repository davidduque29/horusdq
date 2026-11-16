# HorusDQ · Plataforma de monitoreo

![CI/CD](https://img.shields.io/github/actions/workflow/status/davidduque29/horusdq/deploy.yml?branch=main&label=Build%20%26%20deploy)

PWA mobile-first construida con **React, TypeScript y Vite**, publicada en GitHub Pages y preparada para evolucionar hacia monitoreo de despliegues, notificaciones Push y correo y verificación periódica de disponibilidad.

**PWA publicada:** https://davidduque29.github.io/horusdq/

## Estado de desarrollo

| Componente | Estado |
| --- | --- |
| Dashboard público de GitHub Actions | Publicado |
| UI GitHub OAuth / preferencias de avisos | Publicada, requiere configuración de Supabase |
| Migración PostgreSQL y RLS | Implementada en código, no aplicada |
| Receptor de webhooks HMAC SHA-256 | Implementado en código, no desplegado |
| Outbox y worker Push / Resend | Implementado en código, no desplegado |
| Verificación HTTPS de salud | Implementada en código, no programada |
| Registro de repositorios autorizados | Provisionamiento pendiente de configuración |
| Webhook inbox resistente a fallos parciales y reconciliación | Pendiente de endurecimiento |

**La PWA actual sigue usando la API pública de GitHub. Las nuevas notificaciones no estarán activas hasta configurar el backend, secretos, webhooks, cron y OAuth.**

## Desarrollo local

```bash
npm install
npm test
npm run build
npm run dev
```

La identidad corporativa utiliza azul marino `#0B1B5E` y verde `#22C55E`.

## Infraestructura objetivo

Se utilizará un **proyecto Supabase independiente**. No aplicar las migraciones a Orbit Tasks, TrackVikol ni Identity Lab. Ver [guía de implementación](docs/architecture/implementation.md) y [decisiones arquitectónicas](docs/architecture/decisions.md).

Para configurar el frontend, publicar como variables de GitHub Actions `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y `VITE_VAPID_PUBLIC_KEY`. Los secretos privados nunca se incluyen en los assets de GitHub Pages.

Las funciones Edge usan secrets privados y las invocaciones de workers requieren el encabezado `x-worker-secret`; no habilitarlas sin secretos fuertes.

## Pruebas y operación

El workflow en `.github/workflows/deploy.yml` ejecuta tests y compila antes de publicar. Los eventos Push y correo son de mejor esfuerzo: aceptación del proveedor no equivale a lectura.

**Precisión de estados:** resultado de un workflow, publicación del deployment y disponibilidad HTTP son dimensiones independientes.
