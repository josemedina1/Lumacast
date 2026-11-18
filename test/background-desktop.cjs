const {_electron:electron}=require('playwright-core');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..');const temp=await mkdtemp(path.join(os.tmpdir(),'lumacast-background-'));const apps=[];const errors=[];const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 async function state(app, visible){await app.evaluate(({BrowserWindow},expected)=>new Promise((resolve,reject)=>{const start=Date.now();function poll(){const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));if(w.isVisible()===expected)resolve();else if(Date.now()-start>5000)reject(Error('Visibilidad incorrecta: '+expected));else setTimeout(poll,25);}poll();}),visible);}
 async function launch(role){
  const data=path.join(temp,role);await mkdir(data,{recursive:true});await writeFile(path.join(data,'settings.json'),JSON.stringify({role,receiverHost:'127.0.0.1',quality:'balanced',autoStartReceiver:true}));
  const app=await electron.launch({args:[process.env.LUMACAST_TEST_APP || root,'--tsg-test','--user-data-dir='+data,...role==='receiver'?['--receiver','--background']:[]],env});apps.push(app);const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));return {app,page};
 }
 try{
  const {app:receiverApp,page:receiver}=await launch('receiver');await receiver.waitForFunction(()=>document.querySelector('#status').textContent.includes('El receptor está disponible'));
  await state(receiverApp,false);assert.equal(await receiver.locator('#status').evaluate(e=>e.classList.contains('error')),false);
  await receiverApp.evaluate(({app})=>app.emit('second-instance',{},[]));await state(receiverApp,true);
  await receiver.click('#window-close');await state(receiverApp,false);assert.equal(receiverApp.process().exitCode,null);
  const {app:senderApp,page:sender}=await launch('sender');await sender.waitForSelector('#choose-send:enabled');
  await sender.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');let n=0;const draw=()=>{ctx.fillStyle='#15394a';ctx.fillRect(0,0,640,360);ctx.fillStyle='#fff';ctx.font='24px sans-serif';ctx.fillText('Bandeja '+n++,50,100);requestAnimationFrame(draw);};draw();return c.captureStream(30);};});
  async function transmit(){await sender.click('#choose-send');await sender.uncheck('#share-audio');await sender.locator('.source-card[data-type="screen"]').first().click();await state(receiverApp,false);await sender.click('#start-selected');await receiver.waitForFunction(()=>document.querySelector('#video').videoWidth>0||Number(document.querySelector('#compatible-video').dataset.frames)>2,null,{timeout:30000});await state(receiverApp,true);}
  await transmit();await sender.click('#stop');await receiver.waitForSelector('#receiver:not([hidden])');await state(receiverApp,false);
  await transmit();await receiver.click('#window-close');await state(receiverApp,false);assert.equal(await sender.isVisible('#view'),true);
  // La acción Salir de la bandeja usa app.quit: cierra sin interceptar la X.
  const closed=receiverApp.waitForEvent('close');await receiverApp.evaluate(({app})=>app.quit());await closed;await sender.waitForSelector('#home:not([hidden])');
  assert.equal(await sender.locator('#video').evaluate(e=>e.srcObject),null);assert.deepEqual(errors,[]);
  console.log('OK: inicio oculto con receptor activo, abrir, X a bandeja, aparición al transmitir, regreso automático a bandeja, reconexión y salida real.');
 }finally{for(const app of apps.reverse())await app.close().catch(()=>{});await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
})().catch(e=>{console.error(e);process.exitCode=1;});
