# Mapa de pantallas

Cada fila: la captura, el HTML de diseño (con su lógica de demostración) y dónde vive hoy en el código. Las de 390 px de ancho son móvil.


## Rediseño (escritorio y móvil)

| Pantalla | Captura | Diseño | Código actual |
|---|---|---|---|
| Inicio | [ver](capturas/FluidoInicioC.png) | `pantallas-html/FluidoInicioC.dc.html` | src/features/Home.jsx · homeDashboardModel.js |
| Clases · Próxima clase | [ver](capturas/FluidoClases.png) | `pantallas-html/FluidoClases.dc.html` | src/features/Classes.jsx · ClassLog.jsx |
| Comunidad · alumno | [ver](capturas/FluidoComunidad.png) | `pantallas-html/FluidoComunidad.dc.html` | src/features/Community.jsx · Students.jsx |
| Seguimiento | [ver](capturas/FluidoSeguimiento.png) | `pantallas-html/FluidoSeguimiento.dc.html` | src/features/Tracking.jsx · trackingModel.js · Payments.jsx · Progress.jsx |
| Configuración | [ver](capturas/FluidoConfig.png) | `pantallas-html/FluidoConfig.dc.html` | src/features/Settings.jsx |
| Avatares de alumnos | [ver](capturas/Avatares.png) | `pantallas-html/Avatares.dc.html` | src/components/StudentAvatar.jsx |
| Clases · Calendario | [ver](capturas/FluidoClasesCalendario.png) | `pantallas-html/FluidoClasesCalendario.dc.html` | src/features/Classes.jsx · classesCalendarModel.js |
| Clases · Historial | [ver](capturas/FluidoClasesHistorial.png) | `pantallas-html/FluidoClasesHistorial.dc.html` | src/features/Classes.jsx · ClassLog.jsx |
| Clases · Nueva clase | [ver](capturas/FluidoClasesNueva.png) | `pantallas-html/FluidoClasesNueva.dc.html` | src/features/Classes.jsx · classesDraftModel.js · src/domain/schedule.js |
| Comunidad · Grupo | [ver](capturas/FluidoComunidadGrupo.png) | `pantallas-html/FluidoComunidadGrupo.dc.html` | src/features/Community.jsx · Groups.jsx · ArchivedGroupDetail.jsx · src/domain/groupArchiving.js |
| Móvil · Inicio · móvil | [ver](capturas/FluidoMovilInicio2.png) | `pantallas-html/FluidoMovilInicio2.dc.html` | src/features/Home.jsx (vista móvil) |
| Móvil · Inicio · al tocar una cifra · móvil | [ver](capturas/FluidoMovilInicio2Hoja.png) | `pantallas-html/FluidoMovilInicio2Hoja.dc.html` | src/features/Home.jsx (vista móvil) |
| Móvil · Clases · registrar clase · móvil | [ver](capturas/FluidoMovilClases.png) | `pantallas-html/FluidoMovilClases.dc.html` | src/features/Classes.jsx · class-log-mobile.css |
| Móvil · Calendario · móvil | [ver](capturas/FluidoMovilCalendario.png) | `pantallas-html/FluidoMovilCalendario.dc.html` | src/features/Classes.jsx (móvil) |
| Móvil · Calendario · al tocar una clase · móvil | [ver](capturas/FluidoMovilCalendarioDia.png) | `pantallas-html/FluidoMovilCalendarioDia.dc.html` | src/features/Classes.jsx (móvil) |
| Móvil · Historial · móvil | [ver](capturas/FluidoMovilHistorial.png) | `pantallas-html/FluidoMovilHistorial.dc.html` | src/features/Classes.jsx (móvil) |
| Móvil · Nueva clase · móvil | [ver](capturas/FluidoMovilNuevaClase.png) | `pantallas-html/FluidoMovilNuevaClase.dc.html` | src/features/Classes.jsx (móvil) |
| Móvil · Comunidad · móvil | [ver](capturas/FluidoMovilComunidad.png) | `pantallas-html/FluidoMovilComunidad.dc.html` | src/features/Community.jsx (móvil) |
| Móvil · Comunidad · al tocar un alumno · móvil | [ver](capturas/FluidoMovilComunidadAlumno.png) | `pantallas-html/FluidoMovilComunidadAlumno.dc.html` | src/features/Community.jsx (móvil) |
| Móvil · Comunidad · al tocar un grupo · móvil | [ver](capturas/FluidoMovilComunidadGrupo.png) | `pantallas-html/FluidoMovilComunidadGrupo.dc.html` | src/features/Community.jsx (móvil) |
| Móvil · Seguimiento · móvil | [ver](capturas/FluidoMovilSeguimiento.png) | `pantallas-html/FluidoMovilSeguimiento.dc.html` | src/features/Tracking.jsx (móvil) |
| Móvil · Seguimiento · al tocar una barra · móvil | [ver](capturas/FluidoMovilSeguimientoDetalle.png) | `pantallas-html/FluidoMovilSeguimientoDetalle.dc.html` | src/features/Tracking.jsx (móvil) |
| Móvil · Ajustes · móvil | [ver](capturas/FluidoMovilConfig.png) | `pantallas-html/FluidoMovilConfig.dc.html` | src/features/Settings.jsx (móvil) |
| Móvil · Ajustes · al tocar Tarifa · móvil | [ver](capturas/FluidoMovilConfigTarifa.png) | `pantallas-html/FluidoMovilConfigTarifa.dc.html` | src/features/Settings.jsx (móvil) |
| Nueva clase · caja para elegir grupo | [ver](capturas/FluidoClasesNuevaGrupo.png) | `pantallas-html/FluidoClasesNuevaGrupo.dc.html` | src/features/Classes.jsx · classesDraftModel.js · src/domain/schedule.js |
| Nueva clase · elegir alumno (individual) | [ver](capturas/FluidoClasesNuevaAlumno.png) | `pantallas-html/FluidoClasesNuevaAlumno.dc.html` | src/features/Classes.jsx · classesDraftModel.js · src/domain/schedule.js |
| Nueva clase · calendario | [ver](capturas/FluidoClasesNuevaFecha.png) | `pantallas-html/FluidoClasesNuevaFecha.dc.html` | src/features/Classes.jsx · classesDraftModel.js · src/domain/schedule.js |
| Nueva clase · reloj (bloquea lo ocupado) | [ver](capturas/FluidoClasesNuevaHora.png) | `pantallas-html/FluidoClasesNuevaHora.dc.html` | src/features/Classes.jsx · classesDraftModel.js · src/domain/schedule.js |
| Nueva clase · repetir (diario, semanal, mensual) | [ver](capturas/FluidoClasesNuevaRepetir.png) | `pantallas-html/FluidoClasesNuevaRepetir.dc.html` | src/features/Classes.jsx · classesDraftModel.js · src/domain/schedule.js |
| Móvil · Nueva clase · elegir grupo · móvil | [ver](capturas/FluidoMovilNuevaClaseGrupo.png) | `pantallas-html/FluidoMovilNuevaClaseGrupo.dc.html` | src/features/Classes.jsx (móvil) |
| Móvil · Nueva clase · calendario · móvil | [ver](capturas/FluidoMovilNuevaClaseFecha.png) | `pantallas-html/FluidoMovilNuevaClaseFecha.dc.html` | src/features/Classes.jsx (móvil) |
| Móvil · Nueva clase · reloj · móvil | [ver](capturas/FluidoMovilNuevaClaseHora.png) | `pantallas-html/FluidoMovilNuevaClaseHora.dc.html` | src/features/Classes.jsx (móvil) |
| Móvil · Nueva clase · repetir · móvil | [ver](capturas/FluidoMovilNuevaClaseRepetir.png) | `pantallas-html/FluidoMovilNuevaClaseRepetir.dc.html` | src/features/Classes.jsx (móvil) |

## Cobro mensual y grupos archivados

| Pantalla | Captura | Diseño | Código actual |
|---|---|---|---|
| Escritorio · Grupo con cobro mensual | [ver](capturas/FluidoComunidadGrupoMensual.png) | `pantallas-html/FluidoComunidadGrupoMensual.dc.html` | src/features/Community.jsx · Groups.jsx · ArchivedGroupDetail.jsx · src/domain/groupArchiving.js |
| Escritorio · Confirmar archivo | [ver](capturas/FluidoComunidadGrupoArchivar.png) | `pantallas-html/FluidoComunidadGrupoArchivar.dc.html` | src/features/Community.jsx · Groups.jsx · ArchivedGroupDetail.jsx · src/domain/groupArchiving.js |
| Escritorio · Grupo archivado | [ver](capturas/FluidoComunidadGrupoArchivado.png) | `pantallas-html/FluidoComunidadGrupoArchivado.dc.html` | src/features/Community.jsx · Groups.jsx · ArchivedGroupDetail.jsx · src/domain/groupArchiving.js |
| Escritorio · Seguimiento › Pagos con mensualidades | [ver](capturas/FluidoSeguimientoMensual.png) | `pantallas-html/FluidoSeguimientoMensual.dc.html` | src/features/Tracking.jsx · trackingModel.js · Payments.jsx · Progress.jsx |
| Escritorio · Inicio · mensualidad en «Para atender» | [ver](capturas/FluidoInicioCMensual.png) | `pantallas-html/FluidoInicioCMensual.dc.html` | src/features/Home.jsx · homeDashboardModel.js |
| Escritorio · Registrar clase de un grupo mensual | [ver](capturas/FluidoClasesMensual.png) | `pantallas-html/FluidoClasesMensual.dc.html` | src/features/Classes.jsx · ClassLog.jsx (+ cobro mensual) |
| Móvil · Archivados y grupo archivado · móvil | [ver](capturas/FluidoMovilComunidadArchivo.png) | `pantallas-html/FluidoMovilComunidadArchivo.dc.html` | src/features/Community.jsx (móvil) |
| Móvil · Confirmar archivo · móvil | [ver](capturas/FluidoMovilComunidadArchivar.png) | `pantallas-html/FluidoMovilComunidadArchivar.dc.html` | src/features/Community.jsx (móvil) |
| Móvil · Editar grupo · mensual · móvil | [ver](capturas/FluidoMovilComunidadMensual.png) | `pantallas-html/FluidoMovilComunidadMensual.dc.html` | src/features/Community.jsx (móvil) |
| Móvil · Alumno nuevo a mitad de mes · móvil | [ver](capturas/FluidoMovilComunidadAgregar.png) | `pantallas-html/FluidoMovilComunidadAgregar.dc.html` | src/features/Community.jsx (móvil) |
| Móvil · Inicio · mensualidades que vencen hoy · móvil | [ver](capturas/FluidoMovilInicio2Mensual.png) | `pantallas-html/FluidoMovilInicio2Mensual.dc.html` | src/features/Home.jsx (vista móvil) |
| Móvil · Seguimiento › Pagos con mensualidades · móvil | [ver](capturas/FluidoMovilSeguimientoMensual.png) | `pantallas-html/FluidoMovilSeguimientoMensual.dc.html` | src/features/Tracking.jsx (móvil) |
| Móvil · Registrar clase de un grupo mensual · móvil | [ver](capturas/FluidoMovilClasesMensual.png) | `pantallas-html/FluidoMovilClasesMensual.dc.html` | src/features/Classes.jsx · class-log-mobile.css |

## Acceso y tutorial

| Pantalla | Captura | Diseño | Código actual |
|---|---|---|---|
| Inicio de sesión | [ver](capturas/AccesoLogin.png) | `pantallas-html/AccesoLogin.dc.html` | src/auth/AuthScreen.jsx |
| Tutorial · Bienvenida | [ver](capturas/TutBienvenida.png) | `pantallas-html/TutBienvenida.dc.html` | src/onboarding/OnboardingTutorial.jsx · ContextualTour.jsx |
| Tutorial · 1 Grupo | [ver](capturas/TutGrupo.png) | `pantallas-html/TutGrupo.dc.html` | src/onboarding/OnboardingTutorial.jsx · ContextualTour.jsx |
| Tutorial · 2 Alumnos | [ver](capturas/TutAlumnos.png) | `pantallas-html/TutAlumnos.dc.html` | src/onboarding/OnboardingTutorial.jsx · ContextualTour.jsx |
| Tutorial · 3 Agenda | [ver](capturas/TutAgenda.png) | `pantallas-html/TutAgenda.dc.html` | src/onboarding/OnboardingTutorial.jsx · ContextualTour.jsx |
| Recorrido guiado · paso 2 de 5 | [ver](capturas/TutRecorrido.png) | `pantallas-html/TutRecorrido.dc.html` | src/onboarding/OnboardingTutorial.jsx · ContextualTour.jsx |
