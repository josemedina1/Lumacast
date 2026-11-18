# LumaCast 0.13.0

Aplicación de escritorio Windows x64 para compartir una pantalla o una ventana con otro PC en la misma red. Una transmisión a la vez, con imagen y audio del equipo opcional; sin micrófono ni control remoto.

## Cambios de esta entrega

- Las ventanas minimizadas aparecen en **App o ventana** con una etiqueta y sin miniatura cuando Windows no permite obtenerla. La lista se complementa con UI Automation de Windows mediante un proceso PowerShell oculto; no restaura ventanas al enumerar ni al marcar una tarjeta.
- Solo al confirmar Transmitir selección o Cambiar a esta selección se restaura la ventana elegida para que Windows entregue imagen. No se transmite el escritorio como alternativa. Si la nueva fuente se cerró, se conserva la anterior.
- Se validan identificador de ventana y proceso; se reconocen los distintos sufijos de identificador que devuelve Electron para el mismo HWND. Consultar o cancelar la selección mantiene minimizadas las ventanas.
- Esta actualización mantiene el protocolo v6 y solo requiere actualizar el emisor.


- Indicador flotante **Transmitiendo** en el emisor: 156x36 unidades lógicas, punto rojo, sobre la esquina inferior derecha del área útil del monitor principal. Permanece al minimizar la app y no recibe foco ni clics. Solo aparece después de capturar una fuente y se elimina al detener, desconectar, recargar, cerrar o perder el renderer.
- Se excluye del selector y se solicita protección de captura de Windows. Se reposiciona si cambian los monitores o el escalado. Esta entrega mantiene el protocolo v6 de 0.11; el indicador solo requiere actualizar el emisor.

- Audio del equipo estéreo a 48 kHz, con compresión Opus a 96 kbps y alternativa PCM si no hay codificador Opus. Comparte el canal local cifrado con la imagen y funciona tanto con WebRTC como con video compatible.
- Casilla **Compartir audio del equipo** antes de transmitir. **Silenciar audio / Activar audio** durante la sesión; cambiar de ventana conserva la pista de sonido. Detener libera todas las capturas.
- El audio es global del equipo, incluso al elegir una ventana: puede incluir otras aplicaciones y notificaciones. No se captura el micrófono. La captura de Windows solicita dos canales y desactiva cancelación de eco, control automático de ganancia y reducción de ruido para no aplicar filtros de voz a la música.
- Para audio se necesita como mínimo 0.11.0 en ambos equipos: el protocolo usa v6 para reconocer audio cifrado y rechazar conexiones de versiones antiguas.


- Créditos de video compatibles adaptados al tiempo de respuesta: evita que un ACK de Wi-Fi limite el envío a cada dos imágenes. Límite de cuatro, sin cola ilimitada ni aumento de bitrate.
- Preferencia de H.264 baseline en WebRTC, conservando los demás codecs como alternativas.

- Espera de video con iconos de notebook, silueta de pingüino dentro de la nube y PC de escritorio: línea punteada que conecta los iconos, fondo negro y **Conectando** en negrita. Animación local de dos segundos y pausa de 0,1 segundos; sin GSAP ni conexión a Internet. Se oculta al llegar imagen, pausa cuando está oculta y respeta movimiento reducido.

- Ventana inicial ajustada al área útil de Windows, respetando el escalado de pantalla. Se adapta al moverla a una pantalla de menor tamaño.
- Diseño compacto según anchura y altura; sin desplazamiento vertical de toda la aplicación. Los controles de transmisión permanecen visibles. El listado de fuentes tiene desplazamiento propio cuando hay muchas ventanas.
- Se eliminó por completo **Pestaña web por URL**, incluida su ventana de navegación, IPC y API de precarga.
- **Cambiar pestaña** abre el selector durante la transmisión. Puedes elegir otra pantalla o ventana sin desconectar al receptor. En Chrome/Edge, una pestaña se puede separar en una ventana y elegirla en App o ventana.

## Actualizar

Cierra la versión anterior. Si está en la bandeja, clic derecho en su icono > Salir de LumaCast. Extrae todo LumaCast-0.13.0-Verificado.zip, ejecuta COMPROBAR.cmd y abre el instalador. El acceso directo y la barra superior deben identificar LumaCast 0.13.0. Los ajustes existentes se conservan.

En el primer inicio, elige el rol:

- **Receptor** en el PC por cable. Su IP fija predeterminada es 192.168.130.14 y se configura en Windows. La app recibe automáticamente sin pedir aceptación.
- **Emisor** en los notebooks por Wi-Fi. La IP de destino viene precargada; cambia solo esa dirección si corresponde. El notebook puede tener IP dinámica.

Configuración permite modificar rol, IP, calidad e inicio automático. La dirección no aparece en la pantalla de espera del receptor.

## Transmitir y cambiar contenido

1. Pulsa Transmitir pantalla.
2. Elige Pantalla completa, App o ventana, o una Segunda pantalla que Windows ya reconozca.
3. Selecciona una miniatura y confirma con Transmitir selección. Cancelar no transmite nada.
4. Durante el envío, pulsa **Cambiar pestaña**, elige la nueva fuente y confirma **Cambiar a esta selección**. La anterior continúa hasta confirmar.
5. Cancelar conserva lo que ya se comparte. Si la fuente nueva se cerró o no puede capturarse, la app mantiene la anterior y muestra el problema. Detener transmisión finaliza la sesión incluso desde el selector.

El cambio mantiene la conexión: WebRTC usa replaceTrack y el modo compatible sigue sobre el mismo canal cifrado. Cuando cambia la resolución o la relación de aspecto, el encoder compatible reconfigura su salida y genera un fotograma clave. Las pistas anteriores se detienen tras completar el cambio. No se cambia automáticamente a la pantalla completa si una ventana deja de existir.

Pantalla completa incluye todas las aplicaciones y notificaciones visibles. Puedes elegir una ventana minimizada: al confirmar se restaurará automáticamente para poder capturarla. Durante la transmisión, mantenla abierta y restaurada; algunas aplicaciones dejan de dibujar al minimizarse. El selector de ventanas no enumera pestañas internas de otros navegadores. El botón Cambiar pestaña permite cambiar la fuente compartida; el cambio de pestaña dentro de una misma ventana de navegador también se refleja en la ventana que se está capturando.

## Bandeja e inicio automático

En el receptor, activa Iniciar con Windows en la bandeja de iconos. Al iniciar sesión queda oculto y disponible. La primera configuración siempre se muestra si aún no hay rol guardado.

- Al llegar una transmisión aparece la imagen a pantalla completa; si estaba funcionando desde la bandeja, vuelve a ocultarse cuando termina.
- X y minimizar en el receptor ocultan la ventana sin detener la recepción.
- Doble clic en el icono o clic derecho > Abrir LumaCast muestra la ventana.
- Clic derecho > Salir de LumaCast cierra el servicio.
- Cerrar el notebook emisor termina la captura y cierra la app.

El inicio registrado incluye --receiver --background. Si existe un acceso manual añadido antes en shell:startup, evita duplicar ambos métodos; el acceso manual debe usar esos parámetros si también quieres un inicio oculto.

## Calidad y red

| Perfil | Objetivo | Adaptación compatible |
| --- | --- | --- |
| Equilibrada | Hasta Full HD, 30 fps, 6 Mbps | 1600x900 / 4,5 Mbps y 1280x720 / 3 Mbps |
| Nitidez | Hasta Full HD, 30 fps, 8 Mbps | Conserva resolución y reduce bitrate a 6 o 4,5 Mbps |
| Fluidez | Hasta HD, 30 fps | 960x540 o 640x360, menor carga |

WebRTC es la primera opción. Si no entrega imagen, se usa H.264 en tiempo real sobre el canal local cifrado; VP8 y finalmente JPEG son alternativas. El modo compatible conserva entre dos y cuatro fotogramas pendientes según la respuesta del receptor, con límite duro de cuatro. No acumula capturas mientras está sin créditos. WebRTC da preferencia a H.264 baseline compatible y solicita un búfer de reproducción mínimo. Son objetivos sujetos a la red y al hardware, sin garantía de latencia cero ni compresión sin pérdida.

Receptor por Ethernet y emisores por Wi-Fi en una LAN privada de confianza. TCP 47831 para negociación y video compatible; WebRTC usa también puertos negociados. No hay nube, STUN, TURN, grabación ni telemetría. El audio Opus añade aproximadamente 96 kbps de contenido, más cabeceras; la alternativa PCM estéreo usa aproximadamente 1,54 Mbps. AES-256-GCM con claves efímeras ECDH/HKDF protege el video compatible; la negociación no autentica identidades ni utiliza TLS. La app no cambia reglas del firewall ni políticas de seguridad.

## Extender el escritorio

Esta versión solo permite compartir pantallas secundarias que Windows ya reconoce. No crea un monitor virtual. Extender un notebook de una sola pantalla requiere un controlador virtual compatible, no incluido. Compartir una ventana permite limitar qué se muestra sin crear otro monitor.

## Desarrollo y validación

Node.js 24, Windows x64. Las pruebas que abren receptores usan TCP 47831: ejecutarlas secuencialmente.

~~~powershell
npm ci
npm start
npm test
node test/layout-desktop.cjs
node test/source-switch-desktop.cjs
node test/source-switch-desktop.cjs --no-ice
node test/configuration-desktop.cjs
node test/background-desktop.cjs
npm run test:desktop
npm run dist
~~~

La documentación de entrega está en VALIDACION.md. Las pruebas usan perfiles temporales, loopback y contenido sintético de ventanas propias, sin registrar inicio automático ni modificar Windows.


