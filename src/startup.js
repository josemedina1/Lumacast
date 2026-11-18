const path = require('node:path');
const STARTUP_NAME = 'LumaCast Receptor';
const STARTUP_ARGS = ['--receiver', '--background'];
function samePath(a, b) { return typeof a === 'string' && typeof b === 'string' && path.win32.normalize(a.replace(/^"|"$/g, '')).toLowerCase() === path.win32.normalize(b.replace(/^"|"$/g, '')).toLowerCase(); }
function startupState(registered, executable, enabled) {
  // openAtLogin consulta AppUserModelId, no el nombre personalizado de nuestra entrada.
  const entries = registered.launchItems;
  if (Array.isArray(entries)) {
    const own = entries.filter(item => item.name === STARTUP_NAME && item.scope === 'user' && samePath(item.path, executable));
    const active = own.some(item => item.enabled === true);
    return { configured: enabled ? active : own.length === 0, disabled: !enabled, state: !enabled ? 'disabled' : active ? 'enabled' : own.length ? 'blocked' : 'missing' };
  }
  const active = registered.executableWillLaunchAtLogin === true;
  return { configured: enabled ? active : !active, disabled: !enabled, state: !enabled ? 'disabled' : active ? 'enabled' : 'unconfirmed' };
}
function configureReceiverStartup(app, env = process.env, enabled = true) {
  if (!app.isPackaged || app.commandLine.hasSwitch('tsg-test')) return { configured: false, skipped: true, state: 'skipped' };
  const settings = { openAtLogin: enabled, enabled, name: STARTUP_NAME, path: env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe'), args: [...STARTUP_ARGS] };
  try {
    try { app.setLoginItemSettings({ ...settings, name: 'TSG Pantalla Receptor', openAtLogin: false, enabled: false }); } catch { /* No impide verificar la entrada actual. */ }
    app.setLoginItemSettings(settings);
    // Electron interpreta la consulta como una línea de comandos; las comillas
    // evitan truncar rutas con espacios al enumerar launchItems en Windows.
    const registered = app.getLoginItemSettings({ path: `"${settings.path}"`, args: settings.args });
    return startupState(registered, settings.path, enabled);
  } catch (error) { return { configured: false, disabled: !enabled, state: 'error', error: error.message }; }
}
module.exports = { configureReceiverStartup, startupState, STARTUP_NAME, STARTUP_ARGS };
