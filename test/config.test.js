const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
test('rol, IP y perfil persisten y no dependen de la IP dinámica ni del argumento de inicio', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'tsg-settings-'));
 try {
  const file=path.join(dir,'settings.json');config.configureStore(file);
  assert.equal(config.getConfiguration({}).needsSetup,true);
  const settings={role:'sender',receiverHost:'192.168.130.14',quality:'balanced',autoStartReceiver:true};
  config.saveSettings(settings);
  assert.equal(config.getConfiguration({},true).isReceiver,false);
  assert.equal(config.getConfiguration({}).needsSetup,false);
  config.saveSettings({...settings,role:'receiver',receiverHost:'192.168.130.22',quality:'sharp'});
  const reloaded=config.getConfiguration({},false);
  assert.equal(reloaded.isReceiver,true);assert.equal(reloaded.receiverHost,'192.168.130.22');assert.equal(reloaded.quality,'sharp');
  for (const receiverHost of ['256.1.1.1','http://host','1.2.3','1.2.3.4:80','']) assert.throws(()=>config.saveSettings({...settings,receiverHost}));
  assert.equal(config.getConfiguration({}).receiverHost,'192.168.130.22');
  fs.writeFileSync(file,'{incomplete');assert.equal(config.getConfiguration({}).needsSetup,true);
 } finally {config.configureStore(null);fs.rmSync(dir,{recursive:true,force:true});}
});
test('nitidez conserva Full HD al reducir bitrate y fluidez adapta a 360p',()=>{
 const {Pacer}=require('../src/video-pacing');let time=0;
 const sharp=new Pacer(()=>time,'sharp');const smooth=new Pacer(()=>time,'smooth');
 for(let i=0;i<40;i++){const a=sharp.reserve(time*1000);const b=smooth.reserve(time*1000);time+=200;sharp.ack(a.id);smooth.ack(b.id);}
 assert.equal(sharp.settings().width,1920);assert.equal(sharp.settings().bitrate,4500000);assert.equal(smooth.settings().width,640);
});
