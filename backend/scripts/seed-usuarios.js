// Legacy unreviewed roster seeding is intentionally inert. Account creation
// belongs to the authenticated server administration flow, not a shared owner
// identity or environment-wide default password. No DB or dotenv imports.
console.error('Alta heredada de usuarios deshabilitada: no se crearon ni modificaron cuentas. Desde una sesión de administrador, usá Usuarios y equipo para crear accesos individuales. No se convierte ni elimina la cuenta Líder automáticamente. Consultá docs/DEPLOY.md.');
process.exitCode = 1;
