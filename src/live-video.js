/* Video de baja demora sobre el canal local cifrado. Mantiene una ventana acotada de dos a cuatro
   fotogramas entre captura y confirmación de presentación en el receptor. */
(function (root) {
  const { write, read } = root.TSGPackets;
  const { Pacer } = root.TSGPacing;
  class Sender {
    constructor({ video, api, onError, onMetrics, quality = 'balanced' }) {
      Object.assign(this, { video, api, onError, onMetrics });
      this.pacer = new Pacer(undefined, quality);
      this.quality = quality;
      this.closed = false;
      this.encoder = null;
      this.encoderEpoch = 0;
      this.modeIndex = -1;
      this.codec = null;
      this.needsKey = true;
      this.lastKey = 0;
      this.lastMetrics = 0;
      this.jpegBusy = false;
      this.switching = false;
      this.canvas = document.createElement('canvas');
      this.context = this.canvas.getContext('2d', { alpha: false });
    }
    dimensions() {
      const profile = this.pacer.settings();
      const width = this.video.videoWidth || 1280;
      const height = this.video.videoHeight || 720;
      const scale = Math.min(1, profile.width / width, profile.height / height);
      return { width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2), bitrate: profile.bitrate };
    }
    config(codec) {
      return { codec, ...this.dimensions(), framerate: 30, latencyMode: 'realtime', hardwareAcceleration: codec.startsWith('avc1') ? 'prefer-hardware' : 'no-preference', ...(codec.startsWith('avc1') ? { avc: { format: 'annexb' } } : {}) };
    }
    async start() {
      await this.nextCodec();
      if (!this.closed) { this.nextCapture = performance.now(); this.tick(); }
    }
    async nextCodec() {
      if (this.closed || this.switching) return;
      this.switching = true;
      this.encoderEpoch++;
      if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
      this.encoder = null;
      this.pacer.clear();
      const modes = [this.quality === 'smooth' ? 'avc1.42001f' : 'avc1.420028', 'vp8', 'jpeg'];
      try {
        while (++this.modeIndex < modes.length) {
          const codec = modes[this.modeIndex];
          const config = this.config(codec);
          if (codec !== 'jpeg') {
            if (typeof VideoEncoder === 'undefined') continue;
            const support = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
            if (this.closed) return;
            if (!support.supported) continue;
            const epoch = this.encoderEpoch;
            this.encoder = new VideoEncoder({
              output: chunk => { if (!this.closed && epoch === this.encoderEpoch) void this.encoded(chunk); },
              error: () => { if (!this.closed && epoch === this.encoderEpoch) void this.nextCodec().catch(this.onError); }
            });
            try { this.encoder.configure(config); }
            catch { this.encoder.close(); this.encoder = null; continue; }
          }
          this.codec = codec;
          this.format = { ...config, profile: this.pacer.profile };
          this.needsKey = true;
          return;
        }
        throw new Error('No se encontró un formato de video compatible.');
      } finally { this.switching = false; }
    }
    refreshProfile() {
      const config = this.config(this.codec);
      if (this.format.profile === this.pacer.profile && this.format.width === config.width && this.format.height === config.height) return true;
      if (this.pacer.pending.size) return false;
      this.format = { ...config, profile: this.pacer.profile };
      if (this.encoder) this.encoder.configure(config);
      this.needsKey = true;
      return true;
    }
    tick() {
      if (this.closed) return;
      const now = performance.now();
      if (!this.switching && this.codec && this.video.readyState >= 2 && !this.jpegBusy && (!this.encoder || this.encoder.encodeQueueSize < 2)) {
        try {
          if (this.refreshProfile()) {
            const entry = this.pacer.reserve(Math.round(now * 1000));
            if (entry) {
              Object.assign(entry, { codec: this.codec, width: this.format.width, height: this.format.height });
              if (this.codec === 'jpeg') void this.jpeg(entry);
              else {
                const frame = new VideoFrame(this.video, { timestamp: entry.timestamp });
                try {
                  const keyFrame = this.needsKey || now - this.lastKey > 2000;
                  this.encoder.encode(frame, { keyFrame });
                  if (keyFrame) { this.needsKey = false; this.lastKey = now; }
                } finally { frame.close(); }
              }
            }
          }
        } catch { void this.nextCodec().catch(this.onError); }
      }
      // Un encoder que no produce salida no debe bloquear la sesión indefinidamente.
      if ([...this.pacer.pending.values()].some(entry => !entry.encoded && now - entry.started > 1500) && !this.switching) void this.nextCodec().catch(this.onError);
      if (now - this.lastMetrics > 1000) {
        this.lastMetrics = now;
        this.onMetrics({ codec: this.codec, fps: this.pacer.fps, responseMs: this.pacer.delay, pending: this.pacer.pending.size, maxPending: this.pacer.maxPending, width: this.format?.width, height: this.format?.height, bitrate: this.format?.bitrate });
      }
      this.nextCapture = Math.max(this.nextCapture + 1000 / 30, performance.now());
      this.timer = setTimeout(() => this.tick(), Math.max(1, this.nextCapture - performance.now()));
    }
    async encoded(chunk) {
      const entry = [...this.pacer.pending.values()].find(item => item.timestamp === chunk.timestamp);
      if (!entry) return;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      await this.send(entry, data, chunk.type);
    }
    async jpeg(entry) {
      this.jpegBusy = true;
      try {
        if (this.canvas.width !== entry.width || this.canvas.height !== entry.height) { this.canvas.width = entry.width; this.canvas.height = entry.height; }
        this.context.drawImage(this.video, 0, 0, entry.width, entry.height);
        const blob = await new Promise(resolve => this.canvas.toBlob(resolve, 'image/jpeg', this.quality === 'sharp' ? 0.85 : 0.7));
        if (blob) await this.send(entry, new Uint8Array(await blob.arrayBuffer()), 'key');
        else this.pacer.pending.delete(entry.id);
      } catch (error) { if (!this.closed) this.onError(error); }
      finally { this.jpegBusy = false; }
    }
    async send(entry, data, type) {
      if (this.closed || !this.pacer.pending.has(entry.id)) return;
      try {
        entry.encoded = true;
        const accepted = await this.api.frame(write({ ...entry, type }, data));
        if (!accepted && !this.closed) this.requestKey();
      } catch (error) { if (!this.closed) this.onError(error); }
    }
    ack(id) {
      if (!this.pacer.ack(id) || this.closed) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.tick(), Math.max(0, this.nextCapture - performance.now()));
    }
    requestKey() { this.pacer.clear(); this.needsKey = true; }
    reject(codec) { if (codec === this.codec) void this.nextCodec().catch(this.onError); }
    close() {
      this.closed = true;
      this.encoderEpoch++;
      clearTimeout(this.timer);
      this.pacer.clear();
      if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    }
  }
  class Receiver {
    constructor({ canvas, api, onFrame, onError }) {
      Object.assign(this, { canvas, api, onFrame, onError });
      this.context = canvas.getContext('2d', { alpha: false });
      this.pending = new Map();
      this.rejected = new Set();
      this.closed = false;
      this.queue = Promise.resolve();
      this.decoderEpoch = 0;
    }
    receive(packet) {
      this.queue = this.queue.then(() => { if (!this.closed) return this.decode(packet); }).catch(error => { if (!this.closed) this.onError(error); });
    }
    ack(id) { if (!this.closed) void this.api.signal({ type: 'frame-ack', id }).catch(this.onError); }
    reject(meta) {
      this.ack(meta.id);
      if (this.rejected.has(meta.codec)) return;
      this.rejected.add(meta.codec);
      void this.api.signal({ type: 'codec-reject', codec: meta.codec }).catch(this.onError);
    }
    clearDecoder() {
      this.decoderEpoch++;
      if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
      this.decoder = null;
      for (const item of this.pending.values()) this.ack(item.id);
      this.pending.clear();
    }
    draw(frame, meta) {
      if (this.closed) return;
      // Con la ventana de crédito acotada nunca se acumula un historial de imágenes.
      if (this.canvas.width !== meta.width || this.canvas.height !== meta.height) { this.canvas.width = meta.width; this.canvas.height = meta.height; }
      this.context.drawImage(frame, 0, 0, meta.width, meta.height);
      this.canvas.dataset.codec = meta.codec;
      this.canvas.dataset.frames = String(Number(this.canvas.dataset.frames || 0) + 1);
      this.ack(meta.id);
      this.onFrame(meta);
    }
    async decode(packet) {
      const { meta, data } = read(packet);
      if (this.rejected.has(meta.codec)) { this.ack(meta.id); return; }
      if (meta.codec === 'jpeg') {
        const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
        try { if (!this.closed) this.draw(bitmap, meta); }
        finally { bitmap.close(); }
        return;
      }
      const format = `${meta.codec}:${meta.width}:${meta.height}`;
      if (!this.decoder || this.format !== format) {
        if (meta.type !== 'key') {
          this.ack(meta.id);
          void this.api.signal({ type: 'video-keyframe' }).catch(this.onError);
          return;
        }
        this.clearDecoder();
        const config = { codec: meta.codec, codedWidth: meta.width, codedHeight: meta.height, optimizeForLatency: true };
        if (typeof VideoDecoder === 'undefined' || !(await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }))).supported) { this.reject(meta); return; }
        if (this.closed) return;
        const epoch = this.decoderEpoch;
        this.decoder = new VideoDecoder({
          output: frame => {
            try {
              if (this.closed || epoch !== this.decoderEpoch) return;
              const info = this.pending.get(frame.timestamp);
              if (!info) return;
              this.pending.delete(frame.timestamp);
              this.draw(frame, info);
            } finally { frame.close(); }
          },
          error: () => { if (!this.closed && epoch === this.decoderEpoch) { this.clearDecoder(); this.reject(meta); } }
        });
        this.decoder.configure(config);
        this.format = format;
      }
      if (this.decoder.decodeQueueSize >= 2) {
        this.clearDecoder();
        this.ack(meta.id);
        void this.api.signal({ type: 'video-keyframe' }).catch(this.onError);
        return;
      }
      this.pending.set(meta.timestamp, meta);
      this.decoder.decode(new EncodedVideoChunk({ type: meta.type, timestamp: meta.timestamp, data }));
    }
    close() { this.closed = true; this.clearDecoder(); }
  }
  root.TSGLiveVideo = { Sender, Receiver };
})(globalThis);
