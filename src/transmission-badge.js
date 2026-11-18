const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
function badgeBounds(area) {
  const width = Math.min(156, area.width), height = Math.min(36, area.height);
  return {width,height,x:Math.max(area.x,area.x+area.width-width-12),y:Math.max(area.y,area.y+area.height-height-12)};
}
class TransmissionBadge {
  constructor() {
    this.window = null;
    this.reposition = () => { if(this.window&&!this.window.isDestroyed())this.window.setBounds(badgeBounds(screen.getPrimaryDisplay().workArea)); };
    for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,this.reposition);
  }
  get sourceId() {return this.window&&!this.window.isDestroyed()?this.window.getMediaSourceId():null;}
  start() {
    if(this.window&&!this.window.isDestroyed())return;
    const window = new BrowserWindow({
      ...badgeBounds(screen.getPrimaryDisplay().workArea),title:'LumaCast · Transmitiendo',
      show:false,frame:false,transparent:true,hasShadow:false,focusable:false,skipTaskbar:true,
      resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false,
      alwaysOnTop:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}
    });
    this.window=window;
    window.setIgnoreMouseEvents(true);
    window.setContentProtection(true);
    window.setAlwaysOnTop(true,'screen-saver');
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.once('did-finish-load',()=>{if(this.window===window&&!window.isDestroyed()){this.reposition();window.showInactive();}});
    window.on('closed',()=>{if(this.window===window)this.window=null;});
    void window.loadFile(path.join(__dirname,'transmitting.html')).catch(()=>{if(this.window===window)this.stop();});
  }
  stop() { const window=this.window;this.window=null;if(window&&!window.isDestroyed())window.destroy(); }
  dispose() {this.stop();for(const event of ['display-added','display-removed','display-metrics-changed'])screen.removeListener(event,this.reposition);}
}
module.exports={TransmissionBadge,badgeBounds};
