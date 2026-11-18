const fs = require('node:fs');
const path = require('node:path');
const { crc32 } = require('node:zlib');
const { createHash } = require('node:crypto');

// NSIS normal CRC covers byte 512 through the payload, excluding the final
// stored CRC. Derivation: NSIS Source/exehead/fileform.c loadHeaders().
// This checks the artifact without executing it or weakening CRCCheck.
function verifyInstaller(buffer) {
  const signature = Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex');
  let header = -1;
  for (let offset = 512; offset + 28 <= buffer.length; offset += 512) {
    if (buffer.subarray(offset + 4, offset + 20).equals(signature) && (buffer.readUInt32LE(offset) & ~15) === 0) { header = offset; break; }
  }
  if (header < 0) throw new Error('Cabecera NSIS no encontrada.');
  if (buffer.readUInt32LE(header) & 4) throw new Error('El instalador tiene desactivada la comprobación CRC.');
  const payloadLength = buffer.readUInt32LE(header + 24);
  const end = header + payloadLength - 4;
  if (payloadLength < 32 || end + 4 > buffer.length) throw new Error('Instalador incompleto o truncado.');
  const expected = buffer.readUInt32LE(end);
  const actual = crc32(buffer.subarray(512, end));
  if (actual !== expected) throw new Error('CRC incorrecto: instalador alterado o dañado.');
  return { bytes: buffer.length, crc32: actual.toString(16).padStart(8, '0'), sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase() };
}
if (require.main === module) {
  const version = require('../package.json').version;
  const filename = process.argv[2] || path.resolve(__dirname, '..', 'dist', `LumaCast-${version}-Instalador.exe`);
  try { console.log(JSON.stringify({ file: filename, ...verifyInstaller(fs.readFileSync(filename)) }, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyInstaller };
