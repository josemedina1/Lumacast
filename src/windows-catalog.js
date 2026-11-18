const {spawn}=require('node:child_process');
const path=require('node:path');
function windowHandle(id){return typeof id==='string'?/^window:(\d+):\d+$/.exec(id)?.[1]||null:null;}
function sameWindow(a,b){const first=windowHandle(a);return first!==null&&first===windowHandle(b);}
class WindowsCatalog {
  constructor(){this.child=null;this.pending=new Map();this.nextId=0;this.failedAt=0;}
  launch(){
    if(this.child)return;
    if(Date.now()-this.failedAt<5000)throw Error('La lista de ventanas de Windows no está disponible.');
    const script=path.join(__dirname,'native','windows-catalog.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
    const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-File',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});this.child=child;let output='';
    const fail=()=>{if(this.child!==child)return;this.child=null;this.failedAt=Date.now();for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error('No se pudo consultar la lista de ventanas de Windows.'));}this.pending.clear();child.kill();};
    child.stdout.setEncoding('utf8');
    child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);
    child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>4*1024*1024){fail();return;}let end;while((end=output.indexOf('\n'))>=0){const line=output.slice(0,end).trim();output=output.slice(end+1);let reply;try{reply=JSON.parse(line);}catch{fail();return;}const item=this.pending.get(reply.id);if(!item)continue;this.pending.delete(reply.id);clearTimeout(item.timer);if(reply.error)item.reject(Error(reply.error));else item.resolve(reply.result);}});
  }
  request(cmd,args={}){
    if(process.platform!=='win32')return Promise.resolve(cmd==='list'?[]:{restored:false});
    try{this.launch();}catch(error){return Promise.reject(error);}
    if(this.pending.size>=8)return Promise.reject(Error('Windows está ocupado enumerando ventanas. Vuelve a intentarlo.'));
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.close();this.failedAt=Date.now();reject(Error('Windows tardó demasiado en responder. Vuelve a intentarlo.'));},8000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,cmd,...args})+'\n');});
  }
  list(){return this.request('list');}
  async restore(id,expectedPid){
    const hwnd=windowHandle(id);if(!hwnd)return false;
    const windows=await this.list(),window=windows.find(w=>w.hwnd===hwnd);
    if(!window){if(expectedPid)throw Error('La ventana seleccionada ya no está disponible.');return false;}
    if(expectedPid&&window.pid!==expectedPid)throw Error('La ventana seleccionada ya no está disponible.');
    if(window.minimized){await this.request('restore',{hwnd,pid:window.pid});return true;}
    return false;
  }
  close(){const child=this.child;this.child=null;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error('Se cerró la consulta de ventanas.'));}this.pending.clear();child?.kill();}
}
module.exports={WindowsCatalog,windowHandle,sameWindow};
