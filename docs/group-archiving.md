# Archivar grupos

En Comunidad, el menú de cada grupo activo permite archivarlo conservando sus alumnos, clases, calificaciones y pagos. El apartado Archivados permanece cerrado inicialmente y permite consultar el historial o reactivar el grupo.

Inicio y Seguimiento excluyen el historial de los grupos archivados por defecto. El interruptor Incluir grupos archivados incorpora ese historial solo durante la sesión actual de la aplicación. Un aviso indica el alcance y advierte de los saldos pendientes excluidos. Los informes exportados respetan el filtro e indican su estado.

Consultar el archivo no cambia el filtro. Incluir el historial no reactiva grupos ni devuelve clases futuras a la agenda. Reactivar un grupo reanuda sus horarios desde la fecha actual y conserva el estado individual de cada alumno.

El archivo conserva los vínculos originales. Los informes filtran cada registro por su grupo de origen, de modo que un alumno puede seguir aportando actividad de otros grupos o clases individuales. Las calificaciones antiguas sin grupo identificable conservan su tratamiento anterior.

## Compatibilidad de datos

Los grupos incorporan status (Active o Inactive), archivedAt y scheduleResumeDate (fechas AAAA-MM-DD). Los registros anteriores se normalizan como activos. Los respaldos completos conservan todo el historial y los metadatos del archivo. El protocolo cifrado guarda estos campos dentro de la entidad del grupo; no requiere cambios en tablas o migraciones SQL.

La implementación no incorpora datos de demostración, cambios de clave de almacenamiento ni controles para restablecer registros.
