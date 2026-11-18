const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { Signaling, PORT, validHost, validSignal } = require('../src/signaling');
const { getConfiguration } = require('../src/config');
const { write } = require('../src/media-packet');

test('sugiere receptor por IP fija pero pide configurar el rol explícitamente', () => {
  const first = getConfiguration({ Ethernet: [{ family: 'IPv4', address: '192.168.130.14', internal: false }] });
  assert.equal(first.needsSetup, true);
  assert.equal(first.suggestedRole, 'receiver');
  for (const address of ['192.168.130.25', '192.168.130.180']) {
    const config = getConfiguration({ WiFi: [{ family: 'IPv4', address, internal: false }] });
    assert.equal(config.receiverHost, '192.168.130.14');
    assert.equal(config.suggestedRole, 'sender');
    assert.equal(config.isReceiver, false);
  }
});

test('valida direcciones y limita los mensajes a señalización de video', () => {
  assert.equal(validHost('192.168.1.25'), true);
  for (const host of ['localhost/path', '256.1.1.1', '1.1.1.1:80', 'file:///']) assert.equal(validHost(host), false);
  assert.equal(validSignal({ type: 'keyboard', key: 'a' }, 'sender'), false);
  assert.equal(validSignal({ type: 'offer', description: { type: 'offer', sdp: 'test' } }, 'receiver'), false);
  assert.equal(validSignal({ type: 'answer', description: { type: 'answer', sdp: 'test' } }, 'receiver'), true);
});

test('empareja, intercambia SDP/ICE, rechaza segundo emisor y permite reconexión', async () => {
  const received = [];
  const transmitted = [];
  const host = new Signaling(event => received.push(event));
  const sender = new Signaling(event => transmitted.push(event));
  const extra = new Signaling(() => {});
  try {
    await host.host();
    const malicious = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await once(malicious, 'open');
    malicious.send(JSON.stringify({ type: 'hello', protocol: 'incompatible' }));
    await once(malicious, 'close');
    await sender.connect('127.0.0.1');
    await assert.rejects(extra.connect('127.0.0.1'), /ocupado/);
    sender.send({ type: 'offer', description: { type: 'offer', sdp: 'test-offer' } });
    host.send({ type: 'answer', description: { type: 'answer', sdp: 'test-answer' } });
    sender.send({ type: 'ice', candidate: { candidate: 'test-candidate' } });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.ok(received.some(event => event.description?.sdp === 'test-offer'));
    assert.ok(received.some(event => event.type === 'ice'));
    assert.ok(transmitted.some(event => event.description?.sdp === 'test-answer'));
    host.send({ type: 'fallback-request' });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(transmitted.some(event => event.type === 'fallback-request'));
    sender.send({ type: 'fallback-start' });
    const jpeg = Buffer.from(write({ codec: 'vp8', type: 'key', width: 1280, height: 720, id: 1, timestamp: 1000 }, new Uint8Array([12, 34, 56])));
    sender.sendFrame(jpeg);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(received.some(event => event.type === 'frame' && Buffer.from(event.data).equals(jpeg)));
    host.send({ type: 'frame-ack', id: 1 });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(transmitted.some(event => event.type === 'frame-ack' && event.id === 1));
    assert.throws(() => host.sendFrame(jpeg));
    assert.throws(() => sender.send({ type: 'mouse', x: 10 }));
    await sender.stop();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(received.some(event => event.type === 'disconnected'));
    await sender.connect('127.0.0.1');
    host.disconnectPeer();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(transmitted.some(event => event.type === 'disconnected'));
    await sender.connect('127.0.0.1');
  } finally { await sender.stop(); await extra.stop(); await host.stop(); }
});

test('explica cuando otro receptor ocupa el puerto', async () => {
  const first = new Signaling(() => {});
  const second = new Signaling(() => {});
  try {
    await first.host();
    await assert.rejects(second.host(), { code: 'EADDRINUSE' });
  } finally { await first.stop(); await second.stop(); }
});
