(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSGPackets = factory();
})(globalThis, function () {
  const MAX_BYTES = 1024 * 1024;
  const HEADER = 24;
  const codecs = ['jpeg', 'avc1.42001f', 'vp8', 'avc1.420028'];
  function read(packet) {
    if (!(packet instanceof Uint8Array) || packet.byteLength <= HEADER || packet.byteLength > MAX_BYTES) throw new Error('Paquete multimedia inválido.');
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    if (view.getUint32(0) !== 0x54534736 || view.getUint8(4) >= codecs.length || view.getUint8(5) > 1) throw new Error('Formato de video incompatible.');
    const meta = { codec: codecs[view.getUint8(4)], type: view.getUint8(5) ? 'delta' : 'key', width: view.getUint16(6), height: view.getUint16(8), id: view.getUint32(12), timestamp: view.getFloat64(16) };
    if (!meta.id || !Number.isSafeInteger(meta.timestamp) || meta.timestamp < 0 || meta.width < 2 || meta.height < 2 || meta.width > 1920 || meta.height > 1080) throw new Error('Metadatos de video inválidos.');
    const data = packet.subarray(HEADER);
    if (meta.codec === 'jpeg' && (meta.type !== 'key' || data.length < 4 || data[0] !== 255 || data[1] !== 216 || data[data.length - 2] !== 255 || data[data.length - 1] !== 217)) throw new Error('Imagen JPEG inválida.');
    return { meta, data };
  }
  function write(meta, data) {
    if (!(data instanceof Uint8Array) || data.length + HEADER > MAX_BYTES) throw new Error('Fotograma demasiado grande.');
    const packet = new Uint8Array(HEADER + data.length);
    const view = new DataView(packet.buffer);
    view.setUint32(0, 0x54534736);
    const codecIndex = codecs.indexOf(meta.codec);
    if (codecIndex < 0 || !['key', 'delta'].includes(meta.type) || !Number.isInteger(meta.id) || meta.id < 1 || meta.id > 0xffffffff) throw new Error('Metadatos de video inválidos.');
    view.setUint8(4, codecIndex);
    view.setUint8(5, meta.type === 'delta' ? 1 : 0);
    view.setUint16(6, meta.width);
    view.setUint16(8, meta.height);
    view.setUint32(12, meta.id);
    view.setFloat64(16, meta.timestamp);
    packet.set(data, HEADER);
    read(packet);
    return packet;
  }
  return { read, write, MAX_BYTES };
});
