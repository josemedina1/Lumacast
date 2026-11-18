const { WebSocket, WebSocketServer } = require('ws');
const { networkInterfaces } = require('node:os');
const { RECEIVER_HOST } = require('./config');
const { keyPair, sharedKey, encryptFrame, decryptFrame, MAX_FRAME_BYTES } = require('./frame-crypto');

const AudioPackets = require('./audio-packet');
const PORT = 47831;
const PROTOCOL = 'tsg-screen-v6';
function validSignal(message, role) {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'audio-state') return role === 'sender' && typeof message.enabled === 'boolean';
  if (message.type === 'frame-ack') return role === 'receiver' && Number.isInteger(message.id) && message.id > 0 && message.id <= 0xffffffff;
  if (message.type === 'video-keyframe') return role === 'receiver';
  if (message.type === 'codec-reject') return role === 'receiver' && ['avc1.42001f', 'avc1.420028', 'vp8', 'jpeg'].includes(message.codec);
  if (message.type === 'fallback-request') return role === 'receiver';
  if (message.type === 'fallback-start') return role === 'sender';
  if (message.type === 'ice') return message.candidate === null ||
    (typeof message.candidate?.candidate === 'string' && message.candidate.candidate.length < 8192);
  const expected = role === 'sender' ? 'offer' : 'answer';
  return message.type === expected && message.description?.type === expected &&
    typeof message.description.sdp === 'string' && message.description.sdp.length < 100000;
}
function validHost(host) {
  return typeof host === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(host) &&
    host.split('.').every(part => Number(part) <= 255);
}
class Signaling {
  constructor(notify) {
    this.notify = notify;
    this.server = null;
    this.socket = null;
    this.role = null;
    this.frameKey = null;
    this.fallback = false;
  }
  async stop() {
    this.role = null;
    this.frameKey = null;
    this.fallback = false;
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.terminate();
    const server = this.server;
    this.server = null;
    if (server) {
      for (const client of server.clients) client.terminate();
      await new Promise(resolve => server.close(resolve));
    }
  }
  async host() {
    await this.stop();
    const server = new WebSocketServer({ host: '0.0.0.0', port: PORT, maxPayload: MAX_FRAME_BYTES + 28, perMessageDeflate: false });
    this.server = server;
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    }).catch(async error => { await this.stop(); throw error; });
    this.role = 'receiver';
    const attempts = new Set();
    server.on('error', () => this.notify({ type: 'error', message: 'Falló el servicio de recepción.' }));
    server.on('connection', socket => {
      if (this.socket || attempts.size >= 4) return socket.close(1008, 'Receptor ocupado');
      attempts.add(socket);
      let authenticated = false;
      const timer = setTimeout(() => socket.terminate(), 5000);
      socket.on('error', () => {});
      socket.on('close', () => {
        clearTimeout(timer);
        attempts.delete(socket);
        if (this.socket === socket) {
          this.socket = null;
          this.frameKey = null;
          this.fallback = false;
          this.notify({ type: 'disconnected' });
        }
      });
      socket.on('message', (raw, binary) => {
        if (authenticated && this.socket !== socket) return;
        if (binary) {
          if (!authenticated || this.socket !== socket || !this.frameKey) return socket.close(1008);
          try {
            const data = decryptFrame(this.frameKey, raw);
            if (AudioPackets.isAudio(data)) { AudioPackets.read(data); this.notify({type:'audio',data}); }
            else if (this.fallback) this.notify({type:'frame',data});
            else return socket.close(1008);
          }
          catch { socket.close(1008, 'Fotograma inválido'); }
          return;
        }
        if (raw.length > 128 * 1024) return socket.close(1008);
        let message;
        try { message = JSON.parse(raw.toString()); } catch { return socket.close(1008); }
        if (!authenticated) {
          if (message?.type !== 'hello' || message.protocol !== PROTOCOL || this.socket) {
            return socket.close(1008, 'Versión incompatible o receptor ocupado');
          }
          const pair = keyPair();
          try { this.frameKey = sharedKey(pair, message.publicKey); }
          catch { return socket.close(1008, 'Clave de conexión inválida'); }
          authenticated = true;
          clearTimeout(timer);
          attempts.delete(socket);
          this.socket = socket;
          socket.send(JSON.stringify({ type: 'ready', protocol: PROTOCOL, publicKey: pair.publicKey }));
          this.notify({ type: 'peer-ready' });
          return;
        }
        if (validSignal(message, 'sender')) {
          if (message.type === 'fallback-start') this.fallback = true;
          this.notify(message);
        }
        else socket.close(1008, 'Mensaje no permitido');
      });
    });
    const addresses = Object.values(networkInterfaces()).flat()
      .filter(item => item && item.family === 'IPv4' && !item.internal).map(item => item.address);
    return { addresses, port: PORT };
  }
  disconnectPeer() {
    const socket = this.socket;
    this.socket = null;
    this.frameKey = null;
    this.fallback = false;
    if (socket) socket.terminate();
  }
  async connect(host = RECEIVER_HOST) {
    if (!validHost(host)) throw new Error('La dirección del receptor no es válida.');
    await this.stop();
    this.role = 'sender';
    const pair = keyPair();
    const socket = new WebSocket(`ws://${host}:${PORT}`, { maxPayload: 128 * 1024, perMessageDeflate: false, handshakeTimeout: 8000 });
    this.socket = socket;
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => { reject(new Error(`El receptor ${host} no responde. Comprueba que su app esté abierta y ambos equipos estén en la red.`)); socket.terminate(); }, 10000);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, publicKey: pair.publicKey })));
      socket.on('message', raw => {
        if (this.socket !== socket) return;
        let message;
        try { message = JSON.parse(raw.toString()); } catch { return socket.close(1008); }
        if (!ready && message?.type === 'ready' && message.protocol === PROTOCOL) {
          try { this.frameKey = sharedKey(pair, message.publicKey); }
          catch { return socket.close(1008, 'Clave de conexión inválida'); }
          ready = true;
          clearTimeout(timer);
          resolve();
        } else if (ready && validSignal(message, 'receiver')) {
          if (message.type === 'fallback-request') this.fallback = true;
          this.notify(message);
        }
        else socket.close(1008);
      });
      socket.on('error', () => {
        clearTimeout(timer);
        reject(new Error(`No se pudo conectar a ${host}. Comprueba que la app del receptor esté abierta y que la red y el firewall permitan la conexión.`));
        if (ready && this.socket === socket) this.notify({ type: 'error', message: 'Se perdió la conexión con el receptor.' });
      });
      socket.on('close', () => {
        clearTimeout(timer);
        if (!ready) reject(new Error('El receptor está ocupado o usa una versión incompatible. Usa la misma versión en ambos equipos y espera a que termine la otra transmisión.'));
        if (this.socket === socket) {
          this.socket = null;
          this.frameKey = null;
          this.fallback = false;
          this.notify({ type: 'disconnected' });
        }
      });
    });
  }
  send(message) {
    if (!validSignal(message, this.role)) throw new Error('Mensaje no permitido.');
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('No hay otro equipo conectado.');
    if (message.type === 'fallback-request' || message.type === 'fallback-start') this.fallback = true;
    this.socket.send(JSON.stringify(message));
  }
  sendAudio(data) {
    if (this.role !== 'sender' || !this.frameKey || this.socket?.readyState !== WebSocket.OPEN) throw new Error('Audio no disponible.');
    AudioPackets.read(data);
    if (this.socket.bufferedAmount > 8 * 1024) return false;
    this.socket.send(encryptFrame(this.frameKey, Buffer.from(data.buffer,data.byteOffset,data.byteLength)));
    return true;
  }
  sendFrame(data) {
    if (this.role !== 'sender' || !this.fallback || !this.frameKey || this.socket?.readyState !== WebSocket.OPEN) throw new Error('Video compatible no disponible.');
    if (!(data instanceof Uint8Array)) throw new Error('Fotograma inválido.');
    if (this.socket.bufferedAmount > MAX_FRAME_BYTES) return false;
    const frame = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    this.socket.send(encryptFrame(this.frameKey, frame));
    return true;
  }
}
module.exports = { Signaling, PORT, PROTOCOL, validHost, validSignal };
