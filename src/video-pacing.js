(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSGPacing = factory();
})(globalThis, function () {
  class Pacer {
    constructor(now = () => performance.now(), quality = 'balanced') {
      this.now = now;
      this.quality = quality;
      this.pending = new Map();
      this.nextId = 0;
      this.delay = 0;
      this.profile = 0;
      this.acked = 0;
      this.fps = 0;
      this.windowStart = now();
      this.lastAdapt = now();
      this.maxPending = 0;
    }
    reserve(timestamp) {
      // Créditos calculados por tiempo de respuesta: no esperar un ACK para
      // cada pareja de imágenes en Wi-Fi. Límite duro de cuatro, nunca cola ilimitada.
      const limit = Math.min(4, Math.max(2, Math.ceil(this.delay / (1000 / 30)) + 1));
      if (this.pending.size >= limit) return null;
      const entry = { id: ++this.nextId, timestamp, started: this.now(), encoded: false };
      this.pending.set(entry.id, entry);
      this.maxPending = Math.max(this.maxPending, this.pending.size);
      return entry;
    }
    ack(id) {
      const entry = this.pending.get(id);
      if (!entry) return false;
      this.pending.delete(id);
      if (!this.started) { this.started = true; this.windowStart = this.now(); this.lastAdapt = this.now(); }
      const elapsed = this.now() - entry.started;
      this.delay = this.delay ? this.delay * 0.8 + elapsed * 0.2 : elapsed;
      this.acked++;
      const interval = this.now() - this.windowStart;
      if (interval >= 1000) {
        this.fps = this.acked * 1000 / interval;
        this.acked = 0;
        this.windowStart = this.now();
      }
      if (this.now() - this.lastAdapt > 2000 && (this.delay > 150 || (this.fps > 0 && this.fps < 18))) {
        this.profile = Math.min(2, this.profile + 1);
        this.lastAdapt = this.now();
      } else if (this.now() - this.lastAdapt > 8000 && this.delay < 65 && this.fps > 27) {
        this.profile = Math.max(0, this.profile - 1);
        this.lastAdapt = this.now();
      }
      return true;
    }
    settings() {
      const profiles = {
        balanced: [{width:1920,height:1080,bitrate:6000000},{width:1600,height:900,bitrate:4500000},{width:1280,height:720,bitrate:3000000}],
        sharp: [{width:1920,height:1080,bitrate:8000000},{width:1920,height:1080,bitrate:6000000},{width:1920,height:1080,bitrate:4500000}],
        smooth: [{width:1280,height:720,bitrate:2500000},{width:960,height:540,bitrate:1500000},{width:640,height:360,bitrate:750000}]
      };
      return (profiles[this.quality] || profiles.balanced)[this.profile];
    }
    clear() { this.pending.clear(); }
  }
  return { Pacer };
});
