const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configureReceiverStartup, startupState } = require('../src/startup');
const { getConfiguration } = require('../src/config');

test('inicio automático sugiere el rol; la configuración guardada decide el rol', () => {
  assert.equal(getConfiguration({}, true).suggestedRole, 'receiver');
  assert.equal(getConfiguration({}, false).suggestedRole, 'sender');
});

test('inicio automático apunta al portable estable y fuerza modo receptor', () => {
  let registered;
  const registrations = [];
  const app = {
    isPackaged: true, commandLine: { hasSwitch: () => false },
    getPath: () => 'C:\\Temp\\extracted\\app.exe',
    setLoginItemSettings: settings => { registered = settings; registrations.push(settings); },
    getLoginItemSettings: () => ({ openAtLogin: true, executableWillLaunchAtLogin: true })
  };
  assert.equal(configureReceiverStartup(app, { PORTABLE_EXECUTABLE_FILE: 'C:\\TSG\\receptor.exe' }).configured, true);
  assert.equal(registered.path, 'C:\\TSG\\receptor.exe');
  assert.deepEqual(registered.args, ['--receiver', '--background']);
  assert.equal(registered.openAtLogin, true);
  assert.equal(registered.name, 'LumaCast Receptor');
  assert.ok(registrations.some(item => item.name === 'TSG Pantalla Receptor' && !item.openAtLogin && !item.enabled));
  assert.equal(configureReceiverStartup({ ...app, isPackaged: false }, {}).skipped, true);
  assert.equal(configureReceiverStartup({ ...app, commandLine: { hasSwitch: () => true } }, {}).skipped, true);
  assert.equal(configureReceiverStartup({ ...app, setLoginItemSettings: () => { throw new Error('denied'); } }, {}).configured, false);
});

// Regresión del aviso observado: una entrada con nombre propio funciona aunque
// Electron devuelva openAtLogin=false para el AppUserModelId predeterminado.
test('reconoce la entrada personalizada activa sin depender de openAtLogin', () => {
  const executable = 'C:\\Program Files\\LumaCast\\LumaCast.exe';
  const item = { name: 'LumaCast Receptor', path: executable.toUpperCase(), scope: 'user', enabled: true };
  assert.equal(startupState({openAtLogin:false,executableWillLaunchAtLogin:true,launchItems:[item]},executable,true).configured,true);
  assert.equal(startupState({launchItems:[{...item,enabled:false}]},executable,true).state,'blocked');
  assert.equal(startupState({executableWillLaunchAtLogin:true,launchItems:[{...item,name:'Otra app'}]},executable,true).configured,false);
  assert.equal(startupState({launchItems:[{...item,path:'C:\\Otra\\LumaCast.exe'}]},executable,true).configured,false);
  assert.equal(startupState({launchItems:[]},executable,false).configured,true);
});
test('consulta rutas con espacios entre comillas al verificar el inicio en Windows',()=>{
 let query;
 const executable='C:\\Program Files\\LumaCast\\LumaCast.exe';
 const app={isPackaged:true,commandLine:{hasSwitch:()=>false},getPath:()=>executable,setLoginItemSettings:()=>{},getLoginItemSettings:options=>{query=options;return {openAtLogin:false,launchItems:[{name:'LumaCast Receptor',path:executable,scope:'user',enabled:true}]};}};
 assert.equal(configureReceiverStartup(app,{}).configured,true);
 assert.equal(query.path,'"'+executable+'"');
 assert.deepEqual(query.args,['--receiver','--background']);
});
