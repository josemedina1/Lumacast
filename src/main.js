const { app, BrowserWindow, ipcMain, desktopCapturer, session, Menu, powerSaveBlocker, screen, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Signaling } = require('./signaling');
const config = require('./config');
const { configureReceiverStartup } = require('./startup');
const { WindowsCatalog, windowHandle, sameWindow } = require('./windows-catalog');
const windowsCatalog = new WindowsCatalog();
let listedWindows = new Map();
const { createTray } = require('./tray');
const { TransmissionBadge } = require('./transmission-badge');
let transmissionBadge = null;
let tray = null;
let quitting = false;
let returnToTray = false;
let activePresentation = false;
function showWindow(explicit = true) {
  if (!win || win.isDestroyed()) return;
  if (explicit) returnToTray = false;
  win.setSkipTaskbar(false);
  if (win.isMinimized()) win.restore();
  if (config.getConfiguration().isReceiver) win.setFullScreen(true);
  win.show(); win.focus();
}
function hideWindow() {
  if (!win || win.isDestroyed() || !tray || tray.isDestroyed()) return;
  returnToTray = true;
  win.hide(); win.setSkipTaskbar(true);
}

let win;
let selectedSource = null;
let selectedAudio = false;
let blocker = null;
const entry = pathToFileURL(path.join(__dirname, 'index.html')).href;
const signaling = new Signaling(message => {
  if (message.type === 'disconnected') { transmissionBadge?.stop(); activePresentation = false; if (returnToTray && signaling.role === 'receiver') hideWindow(); }
  if (win && !win.isDestroyed()) win.webContents.send('session-event', message);
});
const testMode = app.commandLine.hasSwitch('tsg-test');
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const ownsInstance = testMode || app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', (_event, args = []) => {
  if (!args.includes('--background') && !args.includes('--receiver')) showWindow();
});
function releaseBlocker() {
  if (blocker !== null && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
  blocker = null;
}
async function stop() {
  transmissionBadge?.stop();
  activePresentation = false;
  selectedSource = null;
  releaseBlocker();
  await signaling.stop();
}
function handle(name, handler) {
  ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame?.url !== entry) throw new Error('Origen no autorizado.');
    return handler(...args);
  });
}
app.whenReady().then(() => {
  if (!ownsInstance) return;
  config.configureStore(path.join(app.getPath('userData'), 'settings.json'));
  Menu.setApplicationMenu(null);
  transmissionBadge = new TransmissionBadge();
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const screenRequest = selectedSource !== null && signaling.role === 'sender' &&
      (permission === 'display-capture' || (permission === 'media' && Array.isArray(details.mediaTypes) && (details.mediaTypes.length === 0 || (selectedAudio && details.mediaTypes.every(type=>type==='audio')))));
    callback(contents === win?.webContents && details.requestingUrl === entry && (permission === 'fullscreen' || screenRequest));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => {
    return contents === win?.webContents && (permission === 'fullscreen' || (permission === 'display-capture' && selectedSource !== null));
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const id = selectedSource;
    const audio = selectedAudio && request.audioRequested;
    selectedSource = null; selectedAudio = false;
    if (request.frame?.url !== entry || !id || signaling.role !== 'sender') return callback({});
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find(item => item.id === id);
      callback(source ? { video: source, ...(audio ? {audio:'loopback'} : {}) } : {});
    } catch { callback({}); }
  });
  handle('configuration', () => ({ ...config.getConfiguration(), version: app.getVersion() }));
  handle('save-configuration', async input => {
    if (signaling.socket) throw new Error('Detén la transmisión antes de cambiar la configuración.');
    config.validateSettings(input);
    await stop();
    const settings = config.saveSettings(input);
    const startup = configureReceiverStartup(app, process.env, settings.isReceiver && settings.autoStartReceiver);
    if (!settings.isReceiver) win.setFullScreen(false);
    return { ...settings, startup };
  });
  handle('sources', async () => {
    const primaryId = String(screen.getPrimaryDisplay().id), ownId = win.getMediaSourceId();
    const [sources,native] = await Promise.all([
      desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:240,height:135}}),
      windowsCatalog.list().catch(()=>{if(!win.isDestroyed())win.webContents.send('session-event',{type:'source-warning',message:'No se pudieron consultar las ventanas minimizadas de Windows. Las demás fuentes siguen disponibles.'});return [];})
    ]);
    listedWindows = new Map(native.map(window=>[window.hwnd,window]));
    const excluded = id => id===ownId || sameWindow(id,ownId) || id===transmissionBadge?.sourceId || sameWindow(id,transmissionBadge?.sourceId);
    const result = sources.filter(source=>!excluded(source.id)).map(source=>({
      id:source.id,name:source.name,type:source.id.startsWith('screen:')?'screen':'window',displayId:source.display_id,
      isPrimary:source.display_id===primaryId,thumbnail:source.thumbnail.isEmpty()?'':source.thumbnail.toDataURL(),minimized:listedWindows.get(windowHandle(source.id))?.minimized||false
    }));
    for(const window of native){
      const id='window:'+window.hwnd+':0';
      if(window.minimized&&!excluded(id)&&!result.some(source=>sameWindow(source.id,id)))result.push({id,name:window.name,type:'window',displayId:'',isPrimary:false,thumbnail:'',minimized:true});
    }
    return result;
  });
  handle('select-source', async (id, audio = false) => {
    if (sameWindow(id,transmissionBadge?.sourceId) || sameWindow(id,win.getMediaSourceId()) || typeof id!=='string' || !/^(screen|window):/.test(id) || signaling.role!=='sender')throw new Error('Fuente no válida.');
    const socket=signaling.socket;
    const expected=listedWindows.get(windowHandle(id));
    let restored=false;
    if(windowHandle(id)){
      try{restored=await windowsCatalog.restore(id,expected?.pid);}catch(error){if(expected)throw error;}
    }
    let source;
    for(let attempt=0;attempt<(restored?25:1);attempt++){
      if(signaling.role!=='sender'||signaling.socket!==socket)throw new Error('La transmisión se detuvo.');
      const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0}});
      source=sources.find(source=>source.id===id||sameWindow(source.id,id));
      if(source)break;
      if(restored)await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!source)throw new Error('La pantalla o ventana seleccionada ya no está disponible.');
    if(signaling.role!=='sender'||signaling.socket!==socket)throw new Error('La transmisión se detuvo.');
    selectedSource=source.id;selectedAudio=audio===true;
  });
  handle('display-settings', () => shell.openExternal('ms-settings:display'));
  handle('host', async () => {
    const settings = config.getConfiguration();
    if (!settings.isReceiver) throw new Error('Configura este equipo como receptor para recibir transmisiones.');
    const result = await signaling.host();
    if (win.isVisible()) win.setFullScreen(true);
    releaseBlocker();
    blocker = powerSaveBlocker.start('prevent-display-sleep');
    return { ...result, startup: configureReceiverStartup(app, process.env, settings.autoStartReceiver !== false) };
  });
  handle('transmission-started', () => {
    if (config.getConfiguration().isReceiver || signaling.role !== 'sender' || !signaling.socket) return;
    transmissionBadge.start();
  });
  handle('presentation-started', () => {
    if (!config.getConfiguration().isReceiver || signaling.role !== 'receiver' || !signaling.socket) return;
    if (!activePresentation) { activePresentation = true; showWindow(false); }
  });
  handle('connect', () => {
    const configuration = config.getConfiguration();
    if (configuration.needsSetup) throw new Error('Completa la configuración inicial.');
    if (configuration.isReceiver) throw new Error('Este equipo está configurado como receptor.');
    return signaling.connect(configuration.receiverHost);
  });
  handle('disconnect-peer', () => {
    activePresentation = false;
    signaling.disconnectPeer();
    if (returnToTray && config.getConfiguration().isReceiver) hideWindow();
  });
  handle('signal', message => signaling.send(message));
  handle('audio', data => signaling.sendAudio(data));
  handle('frame', data => signaling.sendFrame(data));
  handle('stop', stop);
  handle('fullscreen', () => { win.setFullScreen(!win.isFullScreen()); return win.isFullScreen(); });
  handle('window-action', action => {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') {
      if (win.isFullScreen()) { win.setFullScreen(false); win.unmaximize(); }
      else if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') { win.close(); return null; }
    else throw new Error('Acción de ventana no válida.');
    return { expanded: win.isMaximized() || win.isFullScreen() };
  });
  const initial = config.getConfiguration();
  const startHidden = !initial.needsSetup && initial.isReceiver && (app.commandLine.hasSwitch('background') || app.commandLine.hasSwitch('receiver'));
  returnToTray = startHidden;
  const workArea = screen.getPrimaryDisplay().workArea;
  const initialWidth = Math.min(1080, workArea.width - 24);
  const initialHeight = Math.min(740, workArea.height - 24);
  win = new BrowserWindow({
    show: false,
    title: `LumaCast ${app.getVersion()}`, icon: path.join(__dirname, 'icon.ico'), width: initialWidth, height: initialHeight, minWidth: Math.min(640, initialWidth), minHeight: Math.min(420, initialHeight),
    backgroundColor: '#101722', frame: false,
    minimizable: true, maximizable: true, closable: true, resizable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  tray = createTray(path.join(__dirname, 'icon.ico'), { open: () => showWindow(), hide: hideWindow, quit: () => app.quit() });
  win.once('ready-to-show', () => { if (startHidden) win.setSkipTaskbar(true); else showWindow(); });
  win.on('close', event => {
    if (!quitting && config.getConfiguration().isReceiver && tray && !tray.isDestroyed()) { event.preventDefault(); hideWindow(); }
  });
  win.on('minimize', () => { if (config.getConfiguration().isReceiver) hideWindow(); });
  function fitWorkArea() {
    if (!win || win.isDestroyed() || win.isFullScreen() || win.isMaximized()) return;
    const bounds = win.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(bounds.width, area.width); const height = Math.min(bounds.height, area.height);
    win.setMinimumSize(Math.min(640, area.width), Math.min(420, area.height));
    if (width !== bounds.width || height !== bounds.height) win.setBounds({width,height,x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-height))});
  }
  win.on('move', fitWorkArea);
  screen.on('display-metrics-changed', fitWorkArea);
  function sendWindowState() {
    if (!win.isDestroyed()) win.webContents.send('window-state', { expanded: win.isMaximized() || win.isFullScreen() });
  }
  for (const name of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) win.on(name, sendWindowState);
  win.webContents.on('did-finish-load', sendWindowState);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('did-start-loading', () => { void stop(); });
  win.webContents.on('render-process-gone', () => { void stop(); });
  win.on('closed', () => { void stop(); });
  win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; windowsCatalog.close(); transmissionBadge?.dispose(); if (tray && !tray.isDestroyed()) tray.destroy(); releaseBlocker(); void signaling.stop(); });
