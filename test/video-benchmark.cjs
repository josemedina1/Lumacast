const { _electron: electron } = require('playwright-core');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
const delayArg=process.argv.find(arg=>arg.startsWith('--ack-delay='));const ackDelay=delayArg?Number(delayArg.split('=')[1]):process.argv.includes('--slow-receiver')?200:0;
async function measure(root, name) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'tsg-bench-'));
  const apps = [];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  async function launch(role) {
    const directory = path.join(temp, role);
    await mkdir(directory, {recursive:true});
    await writeFile(path.join(directory,'settings.json'),JSON.stringify({role,receiverHost:'127.0.0.1',quality:'balanced',autoStartReceiver:false}));
    const app = await electron.launch({ args: [root, '--tsg-test', '--user-data-dir='+directory], env });
    apps.push(app);
    const page = await app.firstWindow();

    await page.waitForFunction(receiver => receiver ? document.getElementById('status').textContent.includes('El receptor está disponible') : !document.getElementById('choose-send').disabled, role === 'receiver').catch(async error=>{console.log('Estado',role,await page.evaluate(()=>({status:document.getElementById('status').textContent,config:configuration})));throw error;});
    await page.evaluate(() => {
      const Peer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Peer { constructor(options) { super({ ...options, iceServers: [], iceTransportPolicy: 'relay' }); } };
    });
    return page;
  }
  try {
    const receiver = await launch('receiver');
    const sender = await launch('sender');
    if (ackDelay) await receiver.evaluate(delay => {
      const ack = TSGLiveVideo.Receiver.prototype.ack;
      TSGLiveVideo.Receiver.prototype.ack = function (id) { setTimeout(() => ack.call(this, id), delay); };
    }, ackDelay);
    await sender.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
        const context = canvas.getContext('2d'); let count = 0;
        function draw() {
          context.fillStyle = '#132334'; context.fillRect(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < 30; i++) {
            context.fillStyle = `hsl(${i * 31},60%,45%)`;
            context.fillRect((i * 53 + count * 6) % 1440 - 80, 60 + (i % 8) * 78, 110, 55);
          }
          context.fillStyle = '#fff'; context.font = '32px Segoe UI'; context.fillText(`Prueba de movimiento ${count++}`, 400, 350);
          const time = Date.now() >>> 0;
          for (let i = 0; i < 32; i++) { context.fillStyle = ((time >>> (31 - i)) & 1) ? '#fff' : '#000'; context.fillRect(i * 8, 0, 8, 8); }
          requestAnimationFrame(draw);
        }
        draw(); return canvas.captureStream(30);
      };
    });
    await sender.click('#choose-send');await sender.uncheck('#share-audio');
    if (await sender.locator('#picker').count()) {
      await sender.locator('.source-card[data-type="screen"]').first().click();
      await sender.click('#start-selected');
    }
    await receiver.waitForFunction(() => Number(document.getElementById('compatible-video').dataset.frames || 0) >= 5, null, { timeout: 30000 });
    const result = await receiver.evaluate(async () => {
      const canvas = document.getElementById('compatible-video');
      const start = performance.now(); const first = Number(canvas.dataset.frames); const ages = [];
      const sample = setInterval(() => {
        const scale = canvas.width / 1920;
        const pixels = canvas.getContext('2d').getImageData(0, Math.max(0, Math.floor(4 * canvas.height / 1080)), canvas.width, 1).data;
        let stamp = 0;
        for (let bit = 0; bit < 32; bit++) stamp = (stamp * 2 + (pixels[Math.floor((bit * 8 + 4) * scale) * 4] > 128 ? 1 : 0)) >>> 0;
        const age = ((Date.now() >>> 0) - stamp) >>> 0;
        if (age < 10000) ages.push(age);
      }, 100);
      await new Promise(resolve => setTimeout(resolve, 6000));
      clearInterval(sample);
      ages.sort((a, b) => a - b);
      return { fps: (Number(canvas.dataset.frames) - first) * 1000 / (performance.now() - start), medianImageAgeMs: ages[Math.floor(ages.length / 2)], p95ImageAgeMs: ages[Math.floor(ages.length * .95)], samples: ages.length, codec: canvas.dataset.codec || 'jpeg', width: canvas.width, height: canvas.height };
    });
    const metrics = await sender.evaluate(() => JSON.parse(document.getElementById('transmission-stats')?.dataset.metrics || '{}'));
    const output = { name, ...result, responseMs: metrics.responseMs, maxPending: metrics.maxPending, capture: metrics.capture };
    console.log(JSON.stringify(output));
    return output;
  } finally {
    for (const app of apps.reverse()) await app.close().catch(() => {});
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
(async () => {
  const results = [];
  if (process.argv.includes('--compare')) results.push(await measure(path.join(project, 'artifacts', 'baseline-0.5'), '0.5 JPEG'));
  const current = await measure(process.env.LUMACAST_BENCH_APP || project, process.env.LUMACAST_BENCH_NAME || '0.10 video Full HD'); results.push(current);
  assert.notEqual(current.codec, 'jpeg', 'La prueba debe usar video comprimido, no imágenes independientes.');
  if (process.argv.includes('--slow-receiver')) assert.ok(current.width < 1920, 'La resolución no se adaptó a un receptor lento.');
  else assert.ok(current.fps >= (process.env.LUMACAST_BENCH_NAME === '0.9.3' && ackDelay ? 12 : 20), `La máquina local entregó solo ${current.fps.toFixed(1)} fps.`);
  if (ackDelay === 80 && process.env.LUMACAST_BENCH_NAME !== '0.9.3') assert.equal(current.width, 1920, 'Debe conservar Full HD con el ACK simulado.');
  assert.ok(current.samples >= 30, 'No se pudo leer el reloj visual de los fotogramas.');
  // El caso lento añade 200 ms a cada ACK deliberadamente; exige demora acotada,
  // no el umbral de la LAN local sin esa perturbación.
  const ageLimit = process.argv.includes('--slow-receiver') ? 300 : 150;
  assert.ok(current.medianImageAgeMs < ageLimit, 'La imagen local se retrasó demasiado.');
  assert.ok(current.maxPending <= 4, 'Se acumuló una cola de fotogramas.');
  await mkdir(path.join(project, 'artifacts'), { recursive: true });
  await writeFile(path.join(project, 'artifacts', 'video-performance-'+(process.env.LUMACAST_BENCH_NAME || 'current')+'-'+ackDelay+'.json'), JSON.stringify({ measuredAt: new Date().toISOString(), environment: 'Dos procesos Electron en el mismo equipo, ICE inutilizable, escena animada sintética 1080p; no representa la red Wi-Fi física.', results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });

