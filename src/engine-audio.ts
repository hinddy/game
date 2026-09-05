/** Browser-native synthesis, started only by a user gesture. Default volume: 35%. */
export class EngineAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private turboGain: GainNode | null = null;
  private oscillator: OscillatorNode | null = null;
  private harmonic: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private volume = 0.35;
  private muted = false;

  async unlock(): Promise<void> {
    if (!this.context) {
      const context = new AudioContext();
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.ratio.value = 6;
      this.master.connect(limiter).connect(context.destination);
      this.engineGain = context.createGain();
      this.engineGain.gain.value = 0;
      this.filter = context.createBiquadFilter();
      this.filter.type = "lowpass"; this.filter.frequency.value = 400; this.filter.Q.value = 0.5;
      this.oscillator = context.createOscillator();
      this.oscillator.type = "triangle"; this.oscillator.frequency.value = 34;
      this.harmonic = context.createOscillator();
      this.harmonic.type = "sawtooth"; this.harmonic.frequency.value = 68;
      const harmonicGain = context.createGain();
      harmonicGain.gain.value = 0.18;
      this.oscillator.connect(this.filter);
      this.harmonic.connect(harmonicGain).connect(this.filter);
      this.filter.connect(this.engineGain).connect(this.master);
      this.oscillator.start(); this.harmonic.start();
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      this.noise = context.createBufferSource(); this.noise.buffer = buffer; this.noise.loop = true;
      const noiseFilter = context.createBiquadFilter();
      noiseFilter.type = "bandpass"; noiseFilter.frequency.value = 1100; noiseFilter.Q.value = 0.7;
      this.turboGain = context.createGain(); this.turboGain.gain.value = 0;
      this.noise.connect(noiseFilter).connect(this.turboGain).connect(this.master);
      this.noise.start();
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  update(speedKph: number, throttle: number, boost: number, enabled: boolean): void {
    if (!this.context || !this.engineGain || !this.turboGain) return;
    const time = this.context.currentTime;
    const rpm = 34 + Math.min(speedKph / 90, 1) * 80 + throttle * 18 + boost * 10;
    this.oscillator!.frequency.setTargetAtTime(rpm, time, 0.12);
    this.harmonic!.frequency.setTargetAtTime(rpm * 2, time, 0.12);
    this.filter!.frequency.setTargetAtTime(260 + throttle * 250 + boost * 180, time, 0.15);
    this.engineGain.gain.setTargetAtTime(enabled ? 0.035 + throttle * 0.055 + boost * 0.015 : 0, time, 0.08);
    this.turboGain.gain.setTargetAtTime(enabled ? boost * 0.045 : 0, time, 0.12);
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyVolume();
  }
  toggleMute(): boolean { this.muted = !this.muted; this.applyVolume(); return this.muted; }
  private applyVolume(): void {
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.04);
  }
  suspend(): void { if (this.context?.state === "running") void this.context.suspend().catch(() => {}); }
  get state(): string { return this.context?.state ?? "locked"; }
  get level(): number { return this.muted ? 0 : this.volume; }
  dispose(): void {
    this.oscillator?.stop(); this.harmonic?.stop(); this.noise?.stop();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }
}
