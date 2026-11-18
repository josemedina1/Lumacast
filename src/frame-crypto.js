const { createECDH, hkdfSync, createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { read, MAX_BYTES: MAX_FRAME_BYTES } = require('./media-packet');
const audio = require('./audio-packet');
function validate(frame) { if (audio.isAudio(frame)) audio.read(frame); else read(frame); }
function keyPair() {
  const agreement = createECDH('prime256v1');
  agreement.generateKeys();
  return { agreement, publicKey: agreement.getPublicKey().toString('base64') };
}
function sharedKey(pair, publicKey) {
  if (typeof publicKey !== 'string' || publicKey.length !== 88) throw new Error('Clave de conexión inválida.');
  const key = Buffer.from(publicKey, 'base64');
  if (key.length !== 65 || key[0] !== 4) throw new Error('Clave de conexión inválida.');
  return Buffer.from(hkdfSync('sha256', pair.agreement.computeSecret(key), Buffer.alloc(0), Buffer.from('TSG screen compatible v1'), 32));
}
function encryptFrame(key, frame) {
  validate(frame);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(frame), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}
function decryptFrame(key, packet) {
  if (packet.length < 32 || packet.length > MAX_FRAME_BYTES + 28) throw new Error('Paquete de video inválido.');
  const decipher = createDecipheriv('aes-256-gcm', key, packet.subarray(0, 12));
  decipher.setAuthTag(packet.subarray(12, 28));
  const frame = Buffer.concat([decipher.update(packet.subarray(28)), decipher.final()]);
  validate(frame);
  return frame;
}
module.exports = { keyPair, sharedKey, encryptFrame, decryptFrame, MAX_FRAME_BYTES };
