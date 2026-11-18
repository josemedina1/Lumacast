# Solicitud a TI: autorización de TSG Pantalla

Aplicación interna Windows x64 para transmitir exclusivamente imagen de notebooks al PC receptor 192.168.130.14. No implementa teclado, mouse, portapapeles, transferencia de archivos ni acceso remoto de control.

## Evidencia observada

El registro Microsoft-Windows-CodeIntegrity/Operational del notebook muestra el evento 3077 el 20 de octubre de 2026: TSG-Pantalla-0.3.0-Windows.exe intentó ejecutar TSG Pantalla.exe extraído en AppData/Local/Temp y fue bloqueado por requisitos de firma empresarial o política de integridad de código. Se observaron eventos de apoyo 3033 y 3089.

ID de política informado: {0283ac0f-fff1-49ae-ada1-8a933130cad6}.

El usuario observaba que no aparecía ninguna ventana ni aviso.

## Nueva entrega para revisión

La versión 0.4 usa un instalador NSIS por usuario, con acceso directo y una instalación persistente. Esto evita la extracción temporal de la app en cada apertura. La entrega todavía no tiene firma de código corporativa y este cambio no elimina la exigencia de autorización.

Solicitamos que TI revise y autorice la aplicación y sus componentes mediante el mecanismo aprobado por la organización, incluyendo firma corporativa si corresponde. No se solicita desactivar Device Guard ni otras protecciones. Los hashes de los artefactos están en VALIDACION.md.

## Operación

- Receptor fijo: 192.168.130.14; los notebooks pueden usar IP dinámica.
- Negociación: TCP 47831 hacia el receptor.
- Video: WebRTC con puertos UDP negociados dinámicamente entre los equipos.
- Sin servicios externos, nube, telemetría o almacenamiento del video.
- Red privada de confianza, sin autenticación de usuarios ni TLS en la señalización.
- Inicio automático solo del receptor al iniciar sesión del usuario, mediante la entrada HKCU Run llamada TSG Pantalla Receptor y argumento --receiver.

Queda pendiente validar arranque tras autorización, firewall y conectividad en los equipos de destino.
