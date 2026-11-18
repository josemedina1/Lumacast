const { _electron: electron } = require('playwright-core');
const { mkdtemp, rm, mkdir } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..');const temp=await mkdtemp(path.join(os.tmpdir(),'tsg-ui-'));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const apps=[];const errors=[];
 async function launch(name){
  const app=await electron.launch({args:[root,'--tsg-test','--user-data-dir='+path.join(temp,name)],env});apps.push(app);
  const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('#settings:not([hidden])');return {app,page};
 }
 async function save(page,role){await page.check('input[name="role"][value="'+role+'"]');await page.fill('#receiver-ip','127.0.0.1');await page.click('#settings-form button[type="submit"]');}
 try{
  const {app:receiverApp,page:receiver}=await launch('receiver');await save(receiver,'receiver');await receiver.waitForSelector('#receiver:not([hidden])');
  const {app:senderApp,page:sender}=await launch('sender');
  assert.equal(await sender.inputValue('#receiver-ip'),'192.168.130.14');
  await save(sender,'sender');await sender.waitForSelector('#home:not([hidden])');
  await sender.reload();await sender.waitForSelector('#home:not([hidden])');
  const saved=await sender.evaluate(()=>tsg.configuration());assert.equal(saved.receiverHost,'127.0.0.1');assert.equal(saved.role,'sender');assert.equal(saved.needsSetup,false);
  await sender.click('#settings-button');await sender.fill('#receiver-ip','999.1.2.3');await sender.click('#settings-form button[type="submit"]');await sender.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));assert.equal((await sender.evaluate(()=>tsg.configuration())).receiverHost,'127.0.0.1');await sender.click('#settings-cancel');
  await sender.click('#choose-send');await sender.uncheck('#share-audio');await sender.waitForSelector('.source-card');assert.equal(await sender.isDisabled('#start-selected'),true);
  assert.equal(await sender.evaluate(()=>document.querySelector('#video').srcObject),null);assert.equal(await receiver.isVisible('#receiver'),true);
  await sender.click('[data-kind="extended"]');assert.match(await sender.textContent('#source-help'),/controlador de pantalla virtual/);
  await sender.click('#cancel-picker');assert.equal(await sender.isVisible('#home'),true);
  const fixture = await senderApp.evaluate(async ({BrowserWindow})=>{const w=new BrowserWindow({width:640,height:360,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});await w.loadURL('data:text/html,'+encodeURIComponent('<!doctype html><title>Contenido elegido de prueba</title><body style="margin:0;background:rgb(32,204,128)">Solo esta ventana</body>'));return {id:w.getMediaSourceId(),windowId:w.id};});
  assert.equal(await sender.locator('[data-kind="web"],#web-form').count(),0);
  await sender.click('#choose-send');await sender.uncheck('#share-audio');await sender.click('[data-kind="window"]');
  await sender.locator('.source-card[data-source-id="'+fixture.id+'"]').click();assert.equal(await receiver.isVisible('#receiver'),true);
  await sender.click('#start-selected');
  await receiver.waitForFunction(()=>document.querySelector('#video').videoWidth>0&&document.querySelector('#video').currentTime>.2,null,{timeout:30000});
  const pixel=await receiver.evaluate(()=>{const video=document.querySelector('#video');const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const c=canvas.getContext('2d');c.drawImage(video,0,0);return Array.from(c.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data);});
  assert.ok(pixel[1]>150&&pixel[0]<80&&pixel[2]>90,'Se debe recibir el verde de la ventana elegida: '+pixel);
  assert.match(await sender.textContent('#view-title'),/Contenido elegido/);
  await senderApp.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).destroy(),fixture.windowId);await sender.waitForSelector('#home:not([hidden])',{timeout:20000});await receiver.waitForSelector('#receiver:not([hidden])');
  assert.equal(await sender.evaluate(()=>document.querySelector('#video').srcObject),null);
  await sender.click('#settings-button');await save(sender,'receiver');await sender.waitForFunction(()=>document.querySelector('#status').textContent.includes('reintentará'));
  await senderApp.evaluate(({app})=>app.quit());
  assert.deepEqual(errors,[]);console.log('OK: primera ejecución, persistencia, IP inválida, cancelar sin transmitir, ayuda de extensión, captura real de ventana, cerrar fuente detiene la sesión.');
 } finally{
  for(const app of apps.reverse())await app.close().catch(()=>{});await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
