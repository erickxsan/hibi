# Regresiones de la auditoría de sincronización

La auditoría del 3 de octubre de 2026 (commit bbe7c96) reprodujo nueve defectos del motor de sincronización (S01–S09). Estas pruebas exigen ahora el comportamiento corregido y se conservan como regresiones:

| Archivo                      | Cubre                                                     | Nivel                                                                        |
| ---------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `repository.audit.test.js`   | S01, S02, S03, S05, S06, S09 y la barrera de restauración | Cifrado y repositorios reales contra el RPC sintético                        |
| `hook.audit.test.jsx`        | S04, S05, S07, S08                                        | Hook real con el repositorio simulado para controlar el orden de los eventos |
| `integration.audit.test.jsx` | S01, S02, S03, S04, S06, S07, S09                         | Hook, repositorio, cifrado y cola reales sobre IndexedDB emulado             |

Datos ficticios. El servidor sintético (`src/test/encryptedSyncServer.js`) sigue el orden de comprobaciones de `apply_encrypted_workspace_mutation`: recibo, revisión, límite de 500 cambios y 5 MiB, revisiones de entidad y cadena del manifiesto, además de verificar cada manifiesto criptográficamente. No se requieren credenciales ni se escribe en un servicio remoto.

Desde la raíz de class-manager-data-safety:

```powershell
pnpm exec vitest run tests/sync-audit src/cloud --reporter=verbose
```

El diseño de la corrección está descrito en `docs/E2EE_ARCHITECTURE.md` (secciones _Entity envelope_ y _Synchronization and offline operation_).
