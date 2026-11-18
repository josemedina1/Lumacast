// Prueba real de WebRTC con imagen sintética: no transmite el escritorio del usuario.
const { _electron: electron } = require('playwright-core');
const { mkdtemp, rm, mkdir } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
async function run() {
  const realCapture = process.argv.includes('--real-capture');
  const packaged = process.argv.includes('--packaged');
  const noIce = process.argv.includes('--no-ice');
  const noVideo = process.argv.includes('--no-video');
  const noCodecs = process.argv.includes('--no-codecs');
  const expectCompatible = noIce || noVideo;
  const root = path.resolve(__dirname, '..');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'tsg-test-'));
  const apps = [];
  const errors = [];
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  async function launch(name) {
    const instance = await electron.launch({
      ...(packaged ? { executablePath: path.join(root, 'dist', 'win-unpacked', 'LumaCast.exe') } : {}),
      args: [...(packaged ? [] : [root]), '--tsg-test', `--user-data-dir=${path.join(temp, name)}`], cwd: root, env: launchEnv
    });
    apps.push(instance);
    if (process.env.TSG_DEBUG_CAPTURE) { instance.process().stdout.on('data', chunk => process.stdout.write(chunk)); instance.process().stderr.on('data', chunk => process.stdout.write(chunk)); }
    const page = await instance.firstWindow();
    page.setDefaultTimeout(20000);
    console.log('App de prueba:', name);
    // Sustituye la configuración dentro del proceso de prueba, sin alterar la red
    // de Windows ni añadir opciones para cambiar el destino en la aplicación.
    await instance.evaluate(({ app }, role) => {
      const requireModule = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const config = requireModule('./src/config.js');
      config.getConfiguration = () => ({ receiverHost: '127.0.0.1', isReceiver: role === 'receiver' });
    }, name);
    await page.reload();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.log(name, message.text()); });
    if (name === 'receiver') await page.waitForFunction(() => document.getElementById('status').textContent.includes('El receptor está disponible'));
    else await page.waitForSelector('#choose-send:enabled');
    return page;
  }
  async function windowState(instance, state) {
    return instance.evaluate(({ BrowserWindow }, requested) => new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const window = BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));
        const ready = requested === 'hidden' ? !window.isVisible() : requested === 'minimized' ? window.isMinimized() : requested === 'maximized' ? window.isMaximized() : !window.isMaximized() && !window.isFullScreen();
        if (ready) resolve(true);
        else if (Date.now() - started > 5000) reject(new Error('Estado de ventana no alcanzado: ' + requested));
        else setTimeout(check, 20);
      };
      check();
    }), state);
  }
  try {
    const receiver = await launch('receiver');
    await mkdir(path.join(root, 'artifacts'), { recursive: true });
    const sender = await launch('sender');
    if (noCodecs) {
      await sender.evaluate(() => { window.VideoEncoder = undefined; });
      await receiver.evaluate(() => { window.VideoDecoder = undefined; });
    }
    if (noIce) for (const page of [receiver, sender]) await page.evaluate(() => {
      // Sin candidatos ICE utilizables, incluso en loopback. No altera el firewall.
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(options) { super({ ...options, iceTransportPolicy: 'relay', iceServers: [] }); }
      };
    });
    if (noVideo) await receiver.evaluate(() => {
      const NativePeer = window.RTCPeerConnection;
      window.testReachedConnected = false;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(options) {
          super(options);
          this.addEventListener('connectionstatechange', () => { if (this.connectionState === 'connected') window.testReachedConnected = true; });
        }
        set ontrack(_handler) { super.ontrack = null; }
      };
    });
    async function waitForImage() {
      await receiver.waitForFunction(fallback => {
        if (fallback) return Number(document.getElementById('compatible-video').dataset.frames || 0) >= 3;
        const video = document.getElementById('video');
        return video.videoWidth > 0 && video.currentTime > 0.2;
      }, expectCompatible, { timeout: 30000 });
    }
    await sender.screenshot({ path: path.join(root, 'artifacts', 'inicio.png') });
    assert.equal(await sender.locator('#settings').isVisible(), false);
    // Sustituye únicamente la captura en este proceso de prueba.
    if (!realCapture) await sender.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280; canvas.height = 720;
        const context = canvas.getContext('2d');
        let frame = 0;
        const draw = () => {
          context.fillStyle = '#15394a'; context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = '#b7f071'; context.font = '60px sans-serif'; context.fillText('LumaCast · Prueba de transmisión', 80, 300);
          context.font = '32px sans-serif'; context.fillText(`Video de prueba · ${frame++}`, 80, 380);
          requestAnimationFrame(draw);
        };
        draw();
        return canvas.captureStream(30);
      };
    });
    console.log('Abriendo selector');
    await sender.click('#choose-send'); await sender.uncheck('#share-audio');
    if (await sender.locator('#picker').count()) {
      await sender.locator('.source-card[data-type="screen"]').first().click();
      console.log('Confirmando fuente');
      await sender.click('#start-selected');
    }
    await waitForImage();
    if (noVideo) {
      assert.equal(await receiver.evaluate(() => window.testReachedConnected), true);
      console.log('OK: WebRTC conectado sin fotogramas no cancela la espera; activa modo compatible y muestra imagen.');
      return;
    }
    assert.equal(await receiver.locator('#video').evaluate(video => video.srcObject?.getAudioTracks().length || 0), 0);
    if (expectCompatible) assert.equal(await receiver.locator('#compatible-video').evaluate(canvas => canvas.getContext('2d').getImageData(10, 10, 1, 1).data[3]), 255);
    if (expectCompatible && !realCapture) {
      const pixel = await receiver.locator('#compatible-video').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(10, 10, 1, 1).data));
      assert.ok(pixel[1] > 40 && pixel[2] > 50, 'El fotograma recibido conserva el contenido de la imagen sintética.');
    }
    await sender.evaluate(() => { window.testCaptureTrack = document.getElementById('video').srcObject.getVideoTracks()[0]; });
    if (!realCapture) await receiver.screenshot({ path: path.join(root, 'artifacts', 'recepcion-prueba.png') });
    assert.equal(await apps[0].evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).isFullScreen()), true);
    assert.equal(await receiver.locator('#fullscreen').isVisible(), false);
    await sender.click('#stop');
    await receiver.waitForSelector('#receiver:not([hidden])');
    assert.equal(await sender.locator('#video').evaluate(video => video.srcObject), null);
    assert.equal(await sender.evaluate(() => window.testCaptureTrack.readyState), 'ended');
    // Una segunda conexión confirma que no quedan pistas/negociaciones anteriores.
    await sender.click('#choose-send');
    if (await sender.locator('#picker').count()) {
      await sender.locator('.source-card[data-type="screen"]').first().click();
      await sender.click('#start-selected');
    }
    await waitForImage();
    await sender.click('#stop');
    await sender.waitForSelector('#home:not([hidden])');
    assert.equal(await sender.locator('#video').evaluate(video => video.srcObject), null);
    await receiver.waitForSelector('#receiver:not([hidden])');
    // La barra también está disponible en el receptor a pantalla completa.
    for (const action of ['minimize', 'maximize', 'close']) assert.equal(await receiver.locator(`#window-${action}`).isVisible(), true);
    await receiver.click('#window-maximize');
    await windowState(apps[0], 'normal');
    await receiver.click('#window-maximize');
    await windowState(apps[0], 'maximized');
    await receiver.click('#window-minimize');
    await windowState(apps[0], 'hidden');
    await apps[0].evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')); window.restore(); window.show(); });
    // La X oculta el receptor; Salir (app.quit) debe cerrar de verdad y cortar video.
    await sender.click('#choose-send');
    if (await sender.locator('#picker').count()) {
      await sender.locator('.source-card[data-type="screen"]').first().click();
      await sender.click('#start-selected');
    }
    await waitForImage();
    await receiver.click('#window-close');
    await windowState(apps[0], 'hidden');
    assert.equal(await sender.isVisible('#view'), true);
    const receiverClosed = apps[0].waitForEvent('close');
    await apps[0].evaluate(({app})=>app.quit());
    await receiverClosed;
    await sender.waitForSelector('#home:not([hidden])');
    assert.equal(await sender.locator('#video').evaluate(video => video.srcObject), null);
    assert.deepEqual(errors, []);
    console.log(`OK (${realCapture ? 'captura real local' : 'video sintético'}, ${noIce ? 'ICE bloqueado, video compatible cifrado' : noVideo ? 'peer conectado sin imagen, video compatible cifrado' : 'WebRTC'}): imagen, detener, reconectar y controles de ventana.`);
  } catch (error) {
    for (const instance of apps) {
      for (const page of instance.windows()) console.log('Estado al fallar:', await page.locator('#status').textContent().catch(() => 'sin página'));
    }
    console.log('Errores de interfaz:', errors);
    throw error;
  } finally {
    for (const instance of apps.reverse()) await instance.close().catch(() => {});
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
