# Hostinger: revisión de solo lectura del 27/10/2026

## Alcance

Inspección visual del panel autenticado. No se guardaron variables, no se ejecutó un build/redeploy, no se cambió GitHub/autodeploy, no se reinició el servicio y no se accedió a la base productiva. No se revelaron ni copiaron DATABASE_URL, JWT_SECRET, contraseñas SMTP ni secretos OAuth.

La sesión inicial estaba vencida; el usuario volvió a ingresar. Los datos siguientes fueron observados después de esa autenticación, no inferidos de la revisión anterior.

## Estado observado

- Sitio: `sistema.rendercorrientes.com`.
- Repositorio: `Render-audiovisual/sistema-render`, rama `hostinger-deploy`.
- Versión actual completada: `43f02707e299293c5b0c2bb6f12386bd4642746b`, desplegada el 23/10 a las 02:57 según el panel.
- Node `24.x`, raíz `./`, framework `Other`, configuración de compilación/salida personalizada. Los comandos detallados de build y entrada no se volvieron a abrir en esta revisión; sus valores del 26/10 siguen siendo evidencia histórica.
- El panel confirma mediante texto explicativo que la implementación automática está activada. **No hacer push a la rama publicada para “preparar” el release.**
- `APP_URL` coincide con `https://sistema.rendercorrientes.com`; `SETUP_DEMO_DATA=false`. Solo se revelaron estos valores no secretos y se volvieron a ocultar.
- Último backup del sitio mostrado: 26/10/2026 19:50. No es respaldo fresco de PostgreSQL externo ni incluye los datos posteriores.
- Recursos mostrados: 19,86/50 GB, 503,78K/600K inodos y 5/5 aplicaciones. No se contrató ni creó otro entorno remoto.

## Inventario de variables, sin valores

Se revisaron las dos páginas completas, con 17 nombres:

```text
MIA_SUPERVISOR_ENABLED
WILSON_SYSTEM_ACTOR_ID
GOOGLE_DRIVE_REDIRECT_URI
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_CLIENT_ID
APP_URL
EMAIL_FROM
SMTP_USER
SMTP_SECURE
SMTP_PORT
SMTP_HOST
SMTP_PASS
DATABASE_URL
JWT_SECRET
SETUP_DEMO_DATA
GOOGLE_CLIENT_ID
VITE_GOOGLE_CLIENT_ID
```

No aparecen las nuevas variables explícitas de entorno de base, sesiones browser, origen browser, trabajos en segundo plano ni CA requeridas por la lista de preparación. **No se agregaron**: guardarlas ahora modificaría el servicio vigente. Conservar las integraciones existentes; retirar una sección visual no autoriza borrar credenciales o adjuntos.

## Gates antes de publicar

Comparar privadamente los valores vigentes y la configuración aprobada, verificar TLS/destino y OAuth/SMTP/WhatsApp, detener escritores en ventana autorizada y obtener respaldo final consistente. La presencia de los nombres DATABASE_URL/JWT_SECRET no certifica sus valores ni constituye comparación de preservación. La inspección del panel tampoco valida la identidad de PostgreSQL, sus ACL o datos actuales.

Esta revisión no autoriza publicar. El ejecutor y su ensayo aislado se documentan separadamente; nunca reemplazar la base vigente por la copia.
