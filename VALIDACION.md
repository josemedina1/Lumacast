# Validación de LumaCast 0.13.0

29 de octubre de 2026.

## Corrección

Las ventanas minimizadas se agregan a App o ventana mediante la lista de ventanas de UI Automation de Windows. El capturador de Electron sigue proporcionando las fuentes de video normales. En una comprobación previa con una ventana propia minimizada, Electron no la devolvía ni con miniatura de 240x135 ni con miniatura desactivada.

Las tarjetas agregadas muestran el título, un marcador de ventana minimizada cuando no hay imagen y el aviso de restauración automática. Consultar la lista, marcar una tarjeta y cancelar NO restauran ventanas. Al confirmar Transmitir selección o Cambiar a esta selección se restaura únicamente la elegida mediante WindowPattern.SetWindowVisualState(Normal), antes de solicitar la captura. Si Windows no entrega una fuente válida, no se sustituye por el escritorio ni por otra ventana.

Se normaliza el HWND de los identificadores de Electron para reconocer el mismo destino con distintos sufijos. Se conserva el PID observado para rechazar una ventana cerrada cuyo identificador fuera reutilizado por otro proceso. La selección y la generación de la sesión se comprueban después de las operaciones asíncronas para no iniciar capturas tras detener. En un cambio fallido continúa la fuente anterior.

El consultor usa PowerShell de Windows, sin perfil, sin consola visible, con un script incluido y mensajes JSON por entrada/salida estándar. Solo permite listar ventanas y restaurar una identidad validada. No cambia directivas de Windows, permisos, certificados ni configuración del sistema. El proceso se inicia al necesitar la lista y se cierra con la app. Los títulos se usan en el selector local, sin envío al receptor ni telemetría.

El script queda fuera del ASAR para que Windows pueda leerlo. No se necesita un ejecutable nativo adicional ni un controlador. Si una política impide ejecutar el consultor, se informa que no se pudieron incluir las minimizadas y se mantienen las fuentes disponibles de Electron. Las aplicaciones elevadas, protegidas o que no exponen el patrón de ventana pueden requerir restauración manual. No se alteran estas restricciones.

Esto permite elegir ventanas minimizadas; al confirmar se restauran para obtener imagen. No garantiza que una aplicación siga dibujando si el usuario la minimiza de nuevo durante la transmisión. No enumera pestañas internas del navegador ni procesos sin una ventana disponible.

## Comprobaciones

- npm test: 20 pruebas aprobadas. Incluye normalización de identificadores con sufijos 0, 1 y 12, restauración solo en estado minimizado, validación de PID y rechazo de ventana desaparecida.
- test/minimized-desktop.cjs --no-ice: aprobado con captura real de ventanas propias y video compatible. Dos ventanas minimizadas presentes en selector; seleccionar/cancelar mantiene ambas minimizadas; confirmar restaura solo la elegida y entrega sus píxeles correctos; cambiar a otra minimizada funciona; si se cierra la nueva antes de confirmar, se mantiene la imagen anterior.
- test/minimized-desktop.cjs: las mismas comprobaciones aprobadas con WebRTC, incluido título con acentos.
- test/layout-desktop.cjs: aprobado desde 640x360 hasta 1920x1080, con controles dentro del viewport y sin scroll de documento.
- La prueba minimizada compatible se repitió contra el app.asar del paquete final, con el mismo runtime Electron y el script real de app.asar.unpacked: aprobada.
- Los 22 archivos de src, incluyendo el script desempaquetado, coinciden byte por byte con el paquete final.
- Vista previa revisada: artifacts/LumaCast-0.13.0-minimizadas.png. La captura del selector se limita a las dos ventanas sintéticas de prueba; no contiene otras ventanas del usuario.

Las transmisiones de prueba usan únicamente ventanas creadas por el arnés, no el escritorio real. No se validó en los dos equipos físicos del usuario ni en todas las aplicaciones o políticas corporativas de Windows.

## Artefactos

- dist/LumaCast-0.13.0-Instalador.exe: 112481242 bytes.
- CRC32 NSIS: 30280e4f, válido.
- SHA-256 instalador: BEE2F4975DED872DAE6C04DD55189F822F4027AF529E0F57D680198D59731B94.
- dist/LumaCast-0.13.0-Verificado.zip: 112483029 bytes.
- SHA-256 ZIP: A50F42462E30358B4ECFF76560726176E47BD247091CAF9DA82246EE445BE981.
- Verificada la copia del instalador dentro del ZIP por SHA-256. Incluye COMPROBAR.cmd y LEEME.txt.

Actualizar el notebook emisor después de salir de LumaCast desde la bandeja. Se conservan los ajustes y el protocolo v6, compatible con receptor 0.11.0 o posterior.

Referencias técnicas: https://www.electronjs.org/docs/latest/api/desktop-capturer y https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.windowpattern.setwindowvisualstate .
