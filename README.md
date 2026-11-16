# HorusDQ
Plataforma PWA para monitoreo de **GitHub Actions**, diseñada mobile-first. React, TypeScript, Vite y design system oficial (azul #0B1B5E, verde #22C55E).
## Alcance MVP v0.1
- Dashboard de repositorios públicos, resultados de últimos workflows, historial y búsqueda.
- Registro y eliminación local de repositorios, guardados en el navegador.
- Temas oscuro y claro; refresco automático cada 60 segundos.
- No se inventa la disponibilidad: **pipeline exitoso no significa despliegue confirmado ni aplicación operativa**.
- Sin Supabase, auth, webhooks, alertas push ni secretos hasta la próxima fase.
## Comandos
```bash
npm install
npm run dev
npm test
npm run build
```
## Publicación
El workflow de GitHub Actions publica en `https://davidduque29.github.io/horusdq/` una vez configurado **Settings → Pages → Source: GitHub Actions**. La publicación necesita los permisos y settings de GitHub Pages habilitados por el propietario.
## Seguridad
Sólo consulta la API pública GitHub sin tokens en el navegador. Repositorios privados requieren backend protegido en una fase posterior. Los repositorios sin datos se muestran como desconocidos.
