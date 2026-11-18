const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tsg', {
  transmissionStarted: () => ipcRenderer.invoke('transmission-started'),
  presentationStarted: () => ipcRenderer.invoke('presentation-started'),
  configuration: () => ipcRenderer.invoke('configuration'),
  saveConfiguration: settings => ipcRenderer.invoke('save-configuration', settings),
  displaySettings: () => ipcRenderer.invoke('display-settings'),
  sources: () => ipcRenderer.invoke('sources'),
  selectSource: (id, audio=false) => ipcRenderer.invoke('select-source', id, audio),
  host: () => ipcRenderer.invoke('host'),
  connect: () => ipcRenderer.invoke('connect'),
  disconnectPeer: () => ipcRenderer.invoke('disconnect-peer'),
  signal: message => ipcRenderer.invoke('signal', message),
  audio: data => ipcRenderer.invoke('audio', data),
  frame: data => ipcRenderer.invoke('frame', data),
  stop: () => ipcRenderer.invoke('stop'),
  fullscreen: () => ipcRenderer.invoke('fullscreen'),
  windowAction: action => ipcRenderer.invoke('window-action', action),
  onWindowState: callback => ipcRenderer.on('window-state', (_event, state) => callback(state)),
  onEvent: callback => ipcRenderer.on('session-event', (_event, message) => callback(message))
});
