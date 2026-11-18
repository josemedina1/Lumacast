const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pacer } = require('../src/video-pacing');
const { write, read } = require('../src/media-packet');

test('no acumula fotogramas durante una interrupción y continúa desde la captura nueva', () => {
  let time = 0;
  const pacer = new Pacer(() => time);
  const first = pacer.reserve(0);
  const second = pacer.reserve(33000);
  for (let i = 0; i < 900; i++) { time += 33; assert.equal(pacer.reserve(time * 1000), null); }
  assert.equal(pacer.pending.size, 2);
  assert.equal(pacer.ack(first.id), true);
  const current = pacer.reserve(time * 1000);
  assert.equal(current.timestamp, time * 1000);
  assert.ok(current.timestamp > second.timestamp);
  assert.equal(pacer.ack(first.id), false);
  assert.equal(pacer.maxPending, 2);
});
test('reduce la carga cuando la confirmación de presentación se retrasa', () => {
  let time = 0;
  const pacer = new Pacer(() => time);
  for (let i = 0; i < 30; i++) { const frame = pacer.reserve(time * 1000); time += 180; pacer.ack(frame.id); }
  assert.ok(pacer.settings().width < 1920);
  assert.ok(pacer.settings().bitrate < 6000000);
});
test('paquetes conservan codec, tipo y timestamp y rechazan metadatos inválidos', () => {
  const meta = { id: 1, timestamp: 123456789, width: 1280, height: 720, codec: 'avc1.42001f', type: 'delta' };
  const packet = write(meta, new Uint8Array([1, 2, 3]));
  assert.deepEqual(read(packet).meta, meta);
  assert.deepEqual(Array.from(read(packet).data), [1, 2, 3]);
  assert.throws(() => write({ ...meta, codec: 'unknown' }, new Uint8Array([1])));
  assert.throws(() => write({ ...meta, width: 4000 }, new Uint8Array([1])));
  packet[4] = 255;
  assert.throws(() => read(packet));
});

test('mantiene treinta envíos por segundo con ACK de Wi-Fi a 80 ms sin superar cuatro créditos', () => {
  let time = 0; const pacer = new Pacer(() => time); const acks = []; let sent = 0;
  for (let tick = 0; tick < 180; tick++) {
    time = tick * (1000 / 30);
    while (acks.length && acks[0].at <= time) pacer.ack(acks.shift().id);
    const frame = pacer.reserve(Math.round(time * 1000));
    if (frame) { sent++; acks.push({id:frame.id,at:time+80}); }
    assert.ok(pacer.pending.size <= 4);
  }
  assert.ok(sent >= 170, `Solo ${sent} envíos en 6 segundos`);
  assert.equal(pacer.settings().width, 1920);
  time += 10000;
  for (let n=0;n<1000;n++) pacer.reserve(time * 1000);
  assert.ok(pacer.pending.size <= 4, 'Una interrupción no debe crear una cola ilimitada');
});
