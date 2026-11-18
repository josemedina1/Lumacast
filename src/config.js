const fs = require('node:fs');
const path = require('node:path');
const { networkInterfaces } = require('node:os');
const RECEIVER_HOST = '192.168.130.14';
let settingsFile = null;
function configureStore(filename) { settingsFile = filename; }
function validAddress(value) {
  return typeof value === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(part => Number(part) <= 255);
}
function validateSettings(input) {
  if (!input || !['sender', 'receiver'].includes(input.role)) throw new Error('Elige si este equipo será emisor o receptor.');
  if (!validAddress(input.receiverHost)) throw new Error('Ingresa una dirección IPv4 válida para el receptor.');
  if (!['balanced', 'sharp', 'smooth'].includes(input.quality)) throw new Error('Selecciona un perfil de imagen válido.');
  if (typeof input.autoStartReceiver !== 'boolean') throw new Error('Configuración de inicio automático inválida.');
  return { role: input.role, receiverHost: input.receiverHost, quality: input.quality, autoStartReceiver: input.autoStartReceiver };
}
function loadSettings() {
  if (!settingsFile) return null;
  try { return validateSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); }
  catch { return null; }
}
function getConfiguration(interfaces = networkInterfaces(), receiverRequested = process.argv.includes('--receiver')) {
  const addresses = Object.values(interfaces).flat().filter(item => item && item.family === 'IPv4' && !item.internal).map(item => item.address);
  const saved = loadSettings();
  return {
    receiverHost: RECEIVER_HOST, quality: 'balanced', autoStartReceiver: true,
    ...saved, role: saved?.role || null, needsSetup: !saved,
    isReceiver: saved?.role === 'receiver', localAddresses: addresses,
    suggestedRole: receiverRequested || addresses.includes(RECEIVER_HOST) ? 'receiver' : 'sender'
  };
}
function saveSettings(input) {
  const settings = validateSettings(input);
  if (!settingsFile) throw new Error('No se pudo abrir la configuración local.');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temp = settingsFile + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(temp, settingsFile);
  return getConfiguration();
}
module.exports = { RECEIVER_HOST, getConfiguration, configureStore, saveSettings, validateSettings, validAddress };
