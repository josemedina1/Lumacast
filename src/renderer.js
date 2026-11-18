const $ = id => document.getElementById(id);
const api = window.tsg;
function updateWindowState(state) {
  if (!state) return;
  const button = $('window-maximize');
  const label = state.expanded ? 'Restaurar' : 'Maximizar';
  button.textContent = state.expanded ? '❐' : '□';
  button.title = label;
  button.setAttribute('aria-label', label);
}
for (const action of ['minimize', 'maximize', 'close']) {
  $(`window-${action}`).onclick = () => {
    api.windowAction(action).then(updateWindowState).catch(error => status(error.message, true));
  };
}
api.onWindowState(updateWindowState);
let role = null;
let peer = null;
let stream = null;
let configuration = null;
let startupInfo = null;
function updateStartupNotice() {
  const notice = $('startup-notice');
  const problem = startupInfo && !startupInfo.skipped && !startupInfo.disabled && !startupInfo.configured;
  notice.hidden = !problem;
  notice.textContent = !problem ? '' : startupInfo.state === 'blocked' ? 'El inicio automático figura deshabilitado en Windows. Revisa Aplicaciones de inicio.' : 'No se pudo confirmar el inicio automático. La recepción sigue disponible. Revisa Aplicaciones de inicio de Windows.';
}

let candidates = [];
let busy = false;
let generation = 0;
let videoTimer = null;
let disconnectTimer = null;
let signalQueue = Promise.resolve();
let receiverRetryTimer = null;
let transport = 'webrtc';
let liveSender = null;
let liveReceiver = null;
let statsTimer = null;
let frameCallback = null;
let audioSender = null;
let audioReceiver = null;
let audioProblem = false;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function show(id) {
  document.body.classList.toggle('waiting', id === 'receiver');
  document.body.classList.toggle('presenting', id === 'view');
  for (const section of ['home', 'receiver', 'view', 'settings', 'picker']) $(section).hidden = section !== id;
}
function setBusy(value) {
  busy = value;
  $('choose-send').disabled = value;
  $('change-source').disabled = value;
  $('start-selected').disabled = value || !selectedContent;
  $('cancel-picker').disabled = value;
  $('refresh-sources').disabled = value;
  for (const button of document.querySelectorAll('[data-kind]')) button.disabled = value;
}
function closePeer() {
  clearInterval(statsTimer);
  if (peer) { peer.onconnectionstatechange = null; peer.onicecandidate = null; peer.ontrack = null; peer.close(); }
  peer = null;
}
function closeMedia() {
  audioSender?.close(); audioReceiver?.close(); audioSender = audioReceiver = null; audioProblem = false;
  $('toggle-audio').hidden = true;
  clearTimeout(videoTimer);
  clearTimeout(disconnectTimer);
  liveSender?.close();
  liveReceiver?.close();
  liveSender = null;
  liveReceiver = null;
  if (frameCallback !== null) $('video').cancelVideoFrameCallback(frameCallback);
  frameCallback = null;
  closePeer();
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  $('video').srcObject = null;
  $('video').hidden = false;
  $('compatible-video').hidden = true;
  $('compatible-video').getContext('2d').clearRect(0, 0, $('compatible-video').width, $('compatible-video').height);
  delete $('compatible-video').dataset.frames;
  delete $('compatible-video').dataset.codec;
  $('transmission-stats').textContent = '';
  delete $('transmission-stats').dataset.metrics;
  transport = 'webrtc';
  candidates = [];
}
async function reset(message = 'Sesión finalizada.') {
  generation++;
  changingSource = false;
  sharedContent = null;
  closeMedia();
  if (configuration?.isReceiver) await api.disconnectPeer();
  else await api.stop();
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  role = configuration?.isReceiver ? 'receiver' : null;
  document.body.classList.remove('receiving');
  setBusy(false);
  show(configuration?.isReceiver ? 'receiver' : 'home');
  status(message);
}
async function fail(error) {
  await reset();
  status(error.message || 'Ocurrió un error. Vuelve a intentarlo.', true);
}
function view() {
  if (role === 'receiver') void api.presentationStarted().catch(error => { void fail(error); });
  show('view');
  $('view-role').textContent = role === 'sender' ? 'TRANSMITIENDO DESDE ESTE EQUIPO' : 'RECEPTOR · SOLO VISUALIZACIÓN';
  $('view-title').textContent = role === 'sender' ? `Compartiendo: ${sharedContent?.name || selectedContent?.name || 'selección'}` : 'Pantalla del notebook';
  $('view-note').textContent = role === 'sender' ? 'Solo se comparte el contenido elegido. Si compartes una pantalla completa, también se verán sus notificaciones. Pulsa Detener para finalizar.' : 'Receptor automático. La transmisión se controla desde el notebook.';
  $('video-wait').hidden = false;
  $('video-wait-label').textContent = 'Conectando';
  $('fullscreen').hidden = role !== 'receiver';
  $('change-source').hidden = role !== 'sender';
  document.body.classList.toggle('receiving', role === 'receiver');
}
function watchDecodedFrames(epoch) {
  const next = () => {
    if (epoch !== generation || role !== 'receiver' || transport !== 'webrtc') return;
    $('video-wait').hidden = true;
    clearTimeout(videoTimer);
    videoTimer = setTimeout(() => { void requestCompatible(); }, 8000);
    frameCallback = $('video').requestVideoFrameCallback(next);
  };
  frameCallback = $('video').requestVideoFrameCallback(next);
}
async function requestCompatible() {
  if (role !== 'receiver' || transport === 'fallback') return;
  const epoch = generation;
  transport = 'fallback';
  clearTimeout(videoTimer);
  clearTimeout(disconnectTimer);
  closePeer();
  $('video').srcObject = null;
  $('video').hidden = true;
  $('compatible-video').hidden = false;
  $('video-wait-label').textContent = 'Conectando';
  $('video-wait').hidden = false;
  liveReceiver = new TSGLiveVideo.Receiver({
    canvas: $('compatible-video'), api,
    onError: error => { if (epoch === generation) void fail(error); },
    onFrame: () => {
      if (epoch !== generation) return;
      $('video-wait').hidden = true;
      clearTimeout(videoTimer);
      videoTimer = setTimeout(() => { void fail(new Error('Se interrumpió la recepción de video. Vuelve a transmitir desde el notebook.')); }, 12000);
    }
  });
  try {
    await api.signal({ type: 'fallback-request' });
    if (epoch !== generation || transport !== 'fallback') return;
    videoTimer = setTimeout(() => { void fail(new Error('No llegan imágenes desde el notebook. Detén la transmisión y vuelve a intentarlo.')); }, 12000);
  } catch (error) { await fail(error); }
}
async function startCompatible() {
  if (role !== 'sender' || transport === 'fallback') return;
  if (!stream?.active) throw new Error('La captura de pantalla no está disponible.');
  const epoch = generation;
  transport = 'fallback';
  clearTimeout(videoTimer);
  clearTimeout(disconnectTimer);
  closePeer();
  await api.signal({ type: 'fallback-start' });
  if (epoch !== generation || role !== 'sender' || !stream?.active) return;
  liveSender = new TSGLiveVideo.Sender({
    video: $('video'), api, quality: configuration?.quality || 'balanced',
    onError: error => { if (epoch === generation) void fail(error); },
    onMetrics: metrics => { if (epoch === generation) reportVideoMetrics(metrics); }
  });
  await liveSender.start();
  status('Transmitiendo · Video comprimido de baja demora por conexión local cifrada.');
  $('video-wait').hidden = true;
}
function receiveFrame(data) {
  if (role !== 'receiver' || transport !== 'fallback') return;
  liveReceiver?.receive(data);
}
function audioError(error) {
  if (audioProblem) return;
  audioProblem = true;
  if(audioSender){audioSender.track.onended=null;audioSender.track.stop();stream?.removeTrack(audioSender.track);}
  audioSender?.close(); audioReceiver?.close(); audioSender = audioReceiver = null;
  $('toggle-audio').hidden = role !== 'sender';
  $('toggle-audio').textContent = 'Audio no disponible';
  $('toggle-audio').disabled = true;
  $('toggle-audio').title = error.message;
  if (role === 'sender') void api.signal({type:'audio-state',enabled:false}).catch(()=>{});
  status('La imagen continúa, pero el audio no está disponible: ' + error.message, true);
}
async function startAudio(epoch) {
  const track = stream?.getAudioTracks()[0];
  if (!track) { if ($('share-audio').checked) audioError(new Error('Windows no entregó una pista de sonido del equipo.')); return; }
  const sender = new LumaAudio.Sender({track,api,onError:error=>{if(epoch===generation)audioError(error);}});
  audioSender = sender;
  track.onended = ()=>{if(epoch===generation&&audioSender===sender)audioError(new Error('Se detuvo la captura del sonido del equipo.'));};
  try {
    await sender.start();
    if(epoch!==generation||sender.closed)return;
    await api.signal({type:'audio-state',enabled:true});
    $('toggle-audio').hidden = false; $('toggle-audio').disabled = false; $('toggle-audio').title = ''; $('toggle-audio').textContent = 'Silenciar audio';
    $('toggle-audio').setAttribute('aria-pressed','false');
  } catch(error) {if(epoch===generation)audioError(error);}
}
$('toggle-audio').onclick = async()=>{
  const sender = audioSender; if(!sender||sender.closed)return;
  sender.muted = !sender.muted;
  sender.track.enabled = !sender.muted;
  $('toggle-audio').textContent = sender.muted?'Activar audio':'Silenciar audio';
  $('toggle-audio').setAttribute('aria-pressed',String(sender.muted));
  try{await api.signal({type:'audio-state',enabled:!sender.muted});}catch(error){audioError(error);}
};
function audioState(enabled) {
  if(role!=='receiver')return;
  audioReceiver?.close(); audioReceiver=null;
  if(enabled){const epoch=generation;audioReceiver=new LumaAudio.Receiver({onError:error=>{if(epoch===generation)audioError(error);}});}
}
function reportVideoMetrics(metrics) {
  const label = metrics.codec?.startsWith('avc1') ? 'H.264' : metrics.codec === 'vp8' ? 'VP8' : metrics.codec === 'jpeg' ? 'JPEG adaptativo' : 'WebRTC';
  $('transmission-stats').textContent = `${label} · ${Math.round(metrics.fps || 0)} fps · respuesta ${Math.round(metrics.responseMs || 0)} ms · ${metrics.width || 0}×${metrics.height || 0}`;
  $('transmission-stats').dataset.metrics = JSON.stringify(metrics);
}
function createPeer() {
  const connection = new RTCPeerConnection({ iceServers: [] });
  peer = connection;
  const epoch = generation;
  connection.onicecandidate = event => {
    if (event.candidate && peer === connection) api.signal({ type: 'ice', candidate: event.candidate.toJSON() }).catch(error => { if (generation === epoch) void fail(error); });
  };
  connection.ondatachannel = event => event.channel.close();
  connection.ontrack = event => {
    if (peer !== connection || transport !== 'webrtc' || role !== 'receiver' || event.track.kind !== 'video') return;
    $('video').srcObject = new MediaStream([event.track]);
    try { if ('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = 0; } catch {}
    try { if ('playoutDelayHint' in event.receiver) event.receiver.playoutDelayHint = 0; } catch {}
    watchDecodedFrames(epoch);
    $('video').play().catch(() => { void requestCompatible(); });
  };
  if (role === 'sender') statsTimer = setInterval(async () => {
    try {
      const stats = await connection.getStats();
      if (peer !== connection || transport !== 'webrtc') return;
      let outbound; let pair;
      stats.forEach(item => {
        if (item.type === 'outbound-rtp' && item.kind === 'video') outbound = item;
        if (item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated) pair = item;
      });
      if (outbound) reportVideoMetrics({ codec: 'WebRTC', fps: outbound.framesPerSecond || 0, responseMs: (pair?.currentRoundTripTime || 0) * 1000, width: outbound.frameWidth, height: outbound.frameHeight });
    } catch { /* Puede cerrarse mientras se obtiene la muestra. */ }
  }, 1000);
  connection.onconnectionstatechange = () => {
    if (peer !== connection || transport !== 'webrtc') return;
    clearTimeout(disconnectTimer);
    if (connection.connectionState === 'connected') {
      status(role === 'sender' ? 'Transmitiendo · Video directo al PC receptor.' : 'Conectado · Recibiendo pantalla.');
    } else if (connection.connectionState === 'failed') {
      void (role === 'receiver' ? requestCompatible() : startCompatible()).catch(fail);
    }
    else if (connection.connectionState === 'disconnected') {
      status('Conexión interrumpida. Intentando recuperar el video…');
      disconnectTimer = setTimeout(() => { if (generation === epoch) void (role === 'receiver' ? requestCompatible() : startCompatible()).catch(fail); }, 3000);
    }
  };
  if (role === 'receiver') videoTimer = setTimeout(() => { if (generation === epoch) void requestCompatible(); }, 8000);
  return connection;
}
async function flushCandidates() {
  for (const candidate of candidates) await peer.addIceCandidate(candidate);
  candidates = [];
}
async function handleEvent(message) {
  if (!role) return;
  if (message.type === 'disconnected') {
    if (role === 'receiver') {
      generation++;
      closeMedia();
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      document.body.classList.remove('receiving');
      show('receiver'); status('El notebook se desconectó. Esperando una nueva transmisión.');
    } else await reset('El receptor se desconectó. La pantalla dejó de compartirse.');
  } else if (message.type === 'error') throw new Error(message.message);
  else if (message.type === 'audio-state') audioState(message.enabled);
  else if (message.type === 'frame-ack') liveSender?.ack(message.id);
  else if (message.type === 'video-keyframe') liveSender?.requestKey();
  else if (message.type === 'codec-reject') liveSender?.reject(message.codec);
  else if (message.type === 'fallback-request' && role === 'sender') await startCompatible();
  else if (message.type === 'fallback-start' && role === 'receiver') await requestCompatible();
  else if (message.type === 'peer-ready') status('Notebook conectado. Esperando el video…');
  else if (message.type === 'offer' && role === 'receiver') {
    const earlyCandidates = candidates;
    closeMedia();
    candidates = earlyCandidates;
    view();
    const connection = createPeer();
    await connection.setRemoteDescription(message.description);
    // Solo se acepta una pista de video entrante, nunca audio ni envío de medios.
    for (const transceiver of connection.getTransceivers()) transceiver.direction = transceiver.receiver.track.kind === 'video' ? 'recvonly' : 'inactive';
    await flushCandidates();
    await connection.setLocalDescription(await connection.createAnswer());
    await api.signal({ type: 'answer', description: connection.localDescription.toJSON() });
  } else if (message.type === 'answer' && role === 'sender' && peer && transport === 'webrtc') {
    await peer.setRemoteDescription(message.description);
    await flushCandidates();
  } else if (message.type === 'ice' && transport === 'webrtc') {
    if (peer?.remoteDescription) await peer.addIceCandidate(message.candidate);
    else candidates.push(message.candidate);
  }
}
api.onEvent(message => {
  if(message.type==='source-warning'){status(message.message,true);return;}
  if (message.type === 'audio') { if(role==='receiver' && $('video-wait').hidden)audioReceiver?.receive(message.data); return; }
  if (message.type === 'frame') { void receiveFrame(message.data); return; }
  signalQueue = signalQueue.then(() => handleEvent(message)).catch(fail);
});
async function startReceiver() {
  if (busy) return;
  setBusy(true);
  clearTimeout(receiverRetryTimer);
  try {
    const info = await api.host();
    role = 'receiver';
    show('receiver'); status('Esperando al notebook. El receptor está disponible.');
    startupInfo = info.startup;
    updateStartupNotice();
  } catch (error) {
    show('receiver');
    status('Preparando el receptor. Se reintentará automáticamente…', true);
    receiverRetryTimer = setTimeout(startReceiver, 3000);
  }
  finally { setBusy(false); }
}
async function transmitSelected() {
  if (busy) return;
  if (!configuration || configuration.isReceiver) return;
  setBusy(true);
  const epoch = generation;
  try {
    if (!selectedContent) throw new Error('Selecciona qué compartir.');
    status('Conectando con el receptor configurado…');
    await api.connect();
    if (epoch !== generation) return;
    role = 'sender';
    const source = selectedContent;
    if (!source) throw new Error('No se encontró una pantalla para transmitir.');
    const shareAudio = $('share-audio').checked;
    await api.selectSource(source.id, shareAudio);
    if(epoch!==generation)return;
    const captureWidth = configuration.quality === 'smooth' ? 1280 : 1920;
    const captureHeight = configuration.quality === 'smooth' ? 720 : 1080;
    const captureOptions = { audio: shareAudio ? {echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:2,sampleRate:48000} : false, video: { width: { ideal: captureWidth, max: captureWidth }, height: { ideal: captureHeight, max: captureHeight }, frameRate: { ideal: 30, max: 30 } } };
    let capture;
    try { capture = await navigator.mediaDevices.getDisplayMedia(captureOptions); }
    catch(error) {
      if (!shareAudio || !['NotReadableError','NotSupportedError'].includes(error.name) || epoch !== generation) throw error;
      await api.selectSource(source.id,false);
      capture = await navigator.mediaDevices.getDisplayMedia({...captureOptions,audio:false});
    }
    if (epoch !== generation) { stopCapture(capture); return; }
    stream = capture;
    const track = stream.getVideoTracks()[0];
    track.contentHint = configuration.quality === 'sharp' ? 'detail' : 'motion';
    bindCaptureEnd(track);
    await api.transmissionStarted();
    if (epoch !== generation) return;
    sharedContent = source;
    view();
    $('video').srcObject = stream;
    await $('video').play();
    const connection = createPeer();
    const transceiver = connection.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
    const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs;
    if (codecs && transceiver.setCodecPreferences) {
      const preferred = codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/h264' && /profile-level-id=42/i.test(codec.sdpFmtpLine || ''));
      if (preferred.length) transceiver.setCodecPreferences([...preferred, ...codecs.filter(codec => !preferred.includes(codec))]);
    }
    const parameters = transceiver.sender.getParameters();
    if (parameters.encodings?.length) {
      parameters.encodings[0].maxBitrate = configuration.quality === 'sharp' ? 8000000 : configuration.quality === 'smooth' ? 3000000 : 6000000;
      parameters.encodings[0].maxFramerate = 30;
      parameters.degradationPreference = configuration.quality === 'sharp' ? 'maintain-resolution' : 'maintain-framerate';
      await transceiver.sender.setParameters(parameters);
    }
    await connection.setLocalDescription(await connection.createOffer());
    await api.signal({ type: 'offer', description: connection.localDescription.toJSON() });
    status('Estableciendo transmisión de video…');
    await startAudio(epoch);
  } catch (error) { if (epoch === generation) await fail(error); }
  finally { if (epoch === generation) setBusy(false); }
}
function bindCaptureEnd(track) {
  track.onended = () => { if (stream?.getVideoTracks().includes(track)) void reset('La fuente compartida se cerró.'); };
}
function stopCapture(media) {
  media?.getTracks().forEach(track => { track.onended = null; track.stop(); });
}
async function replaceSource() {
  if (busy || !changingSource || role !== 'sender' || !stream?.active) return;
  const source = selectedContent;
  const previousStream = stream; const previousContent = sharedContent; const epoch = generation;
  let candidate = null; let committed = false; let replacedSender = null;
  const preview = document.createElement('video'); preview.muted = true; preview.playsInline = true;
  setBusy(true);
  try {
    await api.selectSource(source.id);
    if(epoch!==generation)return;
    const width = configuration.quality === 'smooth' ? 1280 : 1920;
    const height = configuration.quality === 'smooth' ? 720 : 1080;
    candidate = await navigator.mediaDevices.getDisplayMedia({audio:false,video:{width:{ideal:width,max:width},height:{ideal:height,max:height},frameRate:{ideal:30,max:30}}});
    preview.srcObject = candidate;
    let timer;
    try { await Promise.race([preview.play(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('La nueva fuente no entrega imagen.')),5000);})]); }
    finally { clearTimeout(timer); }
    if (epoch !== generation || role !== 'sender' || !previousStream.active) return;
    const track = candidate.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') throw new Error('La fuente seleccionada se cerró.');
    track.contentHint = configuration.quality === 'sharp' ? 'detail' : 'motion';
    if (transport === 'webrtc') {
      const sender = peer?.getSenders().find(item=>item.track?.kind === 'video');
      if (!sender) throw new Error('La conexión de video no está disponible.');
      await sender.replaceTrack(track); replacedSender = sender;
    }
    if (epoch !== generation) return;
    stream = candidate; $('video').srcObject = candidate;
    await $('video').play();
    if (epoch !== generation) return;
    sharedContent = source; bindCaptureEnd(track);
    committed = true; changingSource = false;
    // El sonido del equipo es independiente de la ventana elegida.
    // Conserva la misma pista para que cambiar imagen no corte el audio.
    for(const audio of previousStream.getAudioTracks()){previousStream.removeTrack(audio);candidate.addTrack(audio);}
    stopCapture(previousStream);
    // El canal WebRTC y el emisor compatible siguen vivos. Este último observa
    // el mismo elemento de video y reajusta dimensiones con un fotograma clave.
    show('view');
    $('view-title').textContent = 'Compartiendo: ' + source.name;
    $('video-wait').hidden = true;
    status('Contenido cambiado. La transmisión continúa.');
  } catch (error) {
    if (epoch === generation && previousStream.active) {
      try {
        if (replacedSender && transport === 'webrtc') await replacedSender.replaceTrack(previousStream.getVideoTracks()[0]);
        stream = previousStream; sharedContent = previousContent;
        $('video').srcObject = previousStream; await $('video').play();
        status(error.message + ' Se mantiene el contenido anterior.', true);
      } catch (restoreError) { await fail(restoreError); }
    }
  } finally {
    preview.pause(); preview.srcObject = null;
    if (!committed) stopCapture(candidate);
    if (epoch !== generation) stopCapture(previousStream);
    if (epoch === generation) setBusy(false);
  }
}
$('video').onplaying = () => { if (role === 'sender') $('video-wait').hidden = true; };
$('stop').onclick = () => { void reset(configuration?.isReceiver ? 'Transmisión detenida. Esperando otro notebook.' : 'Dejaste de compartir la pantalla.'); };
async function fullscreen() {
  if (role !== 'receiver') return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('.stage').requestFullscreen();
  } catch (error) { status(error.message, true); }
}
$('fullscreen').onclick = fullscreen;
$('video').ondblclick = fullscreen;
window.addEventListener('beforeunload', () => { clearTimeout(receiverRetryTimer); closeMedia(); });
async function initialize() {
  try {
    configuration = await api.configuration();
    document.querySelector('.window-title').textContent = `LumaCast · ${configuration.version}`;
    document.querySelector('.version').textContent = `/ ${configuration.version}`;
    if (configuration.needsSetup) { openSettings(); return; }
    if (configuration.isReceiver) {
      show('receiver');
      await startReceiver();
    } else {
      show('home');
      setBusy(false);
      status('Listo. Pulsa Transmitir pantalla y elige qué compartir.');
    }
  } catch (error) { status(error.message, true); }
}
let selectedContent = null;
let sharedContent = null;
let changingSource = false;
let sourceKind = 'screen';
let availableSources = [];
let sourceLoadId = 0;
function openSettings() {
  if (!configuration) return;
  if (stream || peer || liveReceiver || busy) { status('Detén la transmisión antes de cambiar la configuración.', true); return; }
  clearTimeout(receiverRetryTimer);
  document.querySelector('input[name="role"][value="' + (configuration.role || configuration.suggestedRole || 'sender') + '"]').checked = true;
  $('receiver-ip').value = configuration.receiverHost;
  $('quality').value = configuration.quality || 'balanced';
  $('auto-start').checked = configuration.autoStartReceiver !== false;
  $('settings-title').textContent = configuration.needsSetup ? 'Configura este equipo una sola vez.' : 'Configuración';
  $('settings-cancel').hidden = !!configuration.needsSetup;
  updateStartupNotice();
  show('settings'); status('Selecciona el rol de este equipo y la IP del receptor.');
}
$('settings-button').onclick = openSettings;
$('settings-cancel').onclick = () => { void initialize(); };
$('settings-form').onsubmit = async event => {
  event.preventDefault();
  try {
    configuration = await api.saveConfiguration({ role: document.querySelector('input[name="role"]:checked').value, receiverHost: $('receiver-ip').value.trim(), quality: $('quality').value, autoStartReceiver: $('auto-start').checked });
    await initialize();
  } catch (error) { status(error.message, true); }
};
function renderSources() {
  selectedContent = null;
  $('start-selected').disabled = true;
  $('selected-label').textContent = 'Selecciona el contenido que quieres compartir.';
  $('source-list').replaceChildren();
  $('stop-picker').hidden = !changingSource;
  $('start-selected').textContent = changingSource ? 'Cambiar a esta selección' : 'Transmitir selección';
  $('picker-title').textContent = changingSource ? 'Elige el nuevo contenido' : '¿Qué vamos a transmitir?';
  $('display-settings').hidden = sourceKind !== 'extended';
  const help = {
    screen: 'Se verá toda la pantalla seleccionada, incluidas las notificaciones.',
    window: 'Se comparte una ventana. Para una pestaña de Chrome o Edge, sepárala en una ventana propia y selecciónala aquí. Las ventanas minimizadas se restauran automáticamente al confirmar para poder transmitir su imagen.',
    extended: 'Solo aparecen pantallas secundarias que Windows ya reconoce. Crear una segunda pantalla sin monitor requiere un controlador de pantalla virtual, que esta app no incluye. Usa una ventana para compartir solo tu contenido.'
  };
  $('source-help').textContent = help[sourceKind];
  for (const button of document.querySelectorAll('[data-kind]')) button.setAttribute('aria-pressed', String(button.dataset.kind === sourceKind));
  const list = availableSources.filter(source => sourceKind === 'extended' ? source.type === 'screen' && !source.isPrimary : source.type === sourceKind);
  for (const source of list) addSource(source);
  if (!list.length) $('selected-label').textContent = sourceKind === 'extended' ? 'Windows no detecta una segunda pantalla disponible.' : 'No hay fuentes disponibles. Abre la ventana y actualiza la lista.';
}
function addSource(source) {
  const card = document.createElement('button');
  card.className = 'source-card'; card.type = 'button'; card.dataset.type = source.type; card.dataset.sourceId = source.id; card.title = source.name + (source.minimized?' · Minimizada; se restaurará al transmitir':'');
  card.setAttribute('aria-pressed', 'false');
  if (source.thumbnail) { const img = document.createElement('img'); img.src = source.thumbnail; img.alt = ''; card.append(img); }
  if(!source.thumbnail){const placeholder=document.createElement('div');placeholder.className='source-placeholder';placeholder.textContent=source.minimized?'Ventana minimizada':'Sin vista previa';card.append(placeholder);}
  const name = document.createElement('span'); name.textContent = source.name; card.append(name);
  if(source.minimized){const note=document.createElement('small');note.className='source-state';note.textContent='Minimizada · se restaurará al transmitir';card.append(note);}
  card.onclick = () => {
    selectedContent = source;
    for (const other of $('source-list').children) other.setAttribute('aria-pressed', String(other === card));
    $('start-selected').disabled = false;
    $('selected-label').textContent = 'Contenido elegido: ' + source.name;
  };
  $('source-list').append(card);
  return card;
}
async function refreshSources() {
  const request = ++sourceLoadId; const epoch = generation;
  availableSources = []; renderSources();
  $('source-list').setAttribute('aria-busy','true');
  $('refresh-sources').disabled = true;
  $('selected-label').textContent = 'Buscando pantallas y ventanas…';
  try {
    const sources = await api.sources();
    if (request !== sourceLoadId || epoch !== generation || $('picker').hidden) return;
    availableSources = sources; renderSources();
  } catch (error) { if (request === sourceLoadId && epoch === generation) status(error.message, true); }
  finally {
    if (request === sourceLoadId && epoch === generation) { $('source-list').setAttribute('aria-busy','false'); $('refresh-sources').disabled = busy; }
  }
}
$('choose-send').onclick = async () => {
  if (busy || !configuration || configuration.isReceiver) return;
  $('audio-choice').hidden = false;
  sourceKind = 'screen'; show('picker'); status('Nada se transmite hasta que confirmes la selección.');
  await refreshSources();
};
for (const button of document.querySelectorAll('[data-kind]')) button.onclick = () => { sourceKind = button.dataset.kind; renderSources(); };
$('refresh-sources').onclick = refreshSources;
$('cancel-picker').onclick = () => {
  if (busy) return;
  if (changingSource && stream?.active) { changingSource = false; selectedContent = sharedContent; show('view'); status('Se mantiene el contenido compartido.'); }
  else { selectedContent = null; show('home'); status('Listo para compartir.'); }
};
$('start-selected').onclick = () => { if (!busy && selectedContent) void (changingSource ? replaceSource() : transmitSelected()); };
$('stop-picker').onclick = () => { void reset('Dejaste de compartir la pantalla.'); };
$('change-source').onclick = async () => {
  if (busy || role !== 'sender' || !stream?.active) return;
  $('audio-choice').hidden = true;
  changingSource = true; sourceKind = sharedContent?.type === 'window' ? 'window' : 'screen';
  show('picker'); status('Se sigue transmitiendo el contenido actual hasta confirmar el cambio.');
  await refreshSources();
};
$('display-settings').onclick = () => { void api.displaySettings().catch(error => status(error.message, true)); };
void initialize();

