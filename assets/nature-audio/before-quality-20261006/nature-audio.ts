import * as THREE from 'three';
import { caveTorchLit } from '../shared/cave-light.mjs';
import { CAMP } from '../shared/world.mjs';
import { natureEnvironment, unit, type SoundPoint } from './nature-environment.js';
import {
  readAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from './nature-audio-settings.js';
import { natureSynthesis, NATURE_PHRASES, type MusicPlace } from './nature-synthesis.js';

type Loop = { source: AudioBufferSourceNode; gain: GainNode; panner?: PannerNode };
type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  nodes: AudioNode[];
  bus: 'music' | 'ambience';
  name: string;
};
const FILES = ['wind', 'fire', 'river', 'birds-0', 'birds-1', 'birds-2'];

export class NatureAudio {
  settings = readAudioSettings();
  context: AudioContext | null = null;
  readonly stats = {
    birds: 0,
    musicNotes: 0,
    voices: 0,
    peakVoices: 0,
    loops: 0,
    cave: 0,
    river: 0,
    fire: 0,
    place: '',
    loaded: 0,
  };
  readonly errors: string[] = [];
  private active = false;
  private disposed = false;
  private loading: Promise<void> | null = null;
  private abort = new AbortController();
  private master: GainNode;
  private buses: Record<'ambience' | 'music', GainNode>;
  private reverbSend: GainNode;
  private reverb: ConvolverNode;
  private buffers = new Map<string, AudioBuffer>();
  private loops = new Map<string, Loop>();
  private voices = new Set<Voice>();
  private forward = new THREE.Vector3();
  private nextBird = 0;
  private nextDrop = 0;
  private nextEnvironment = 0;
  private nextMusic = 0;
  private phraseStarted = 0;
  private phraseIndex = 0;
  private place: MusicPlace = 'explore';
  private phrasePlace: MusicPlace = 'explore';
  private env: ReturnType<typeof natureEnvironment> | null = null;
  private lastIdentity = '';
  private lastBird = -1;
  private ready = false;

  constructor() {
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.pagehide);
  }
  private pagehide = () => this.silence();
  private visibility = () => {
    if (document.hidden) this.silence();
    else if (this.active && this.settings.enabled && this.context) void this.start();
  };
  get status() {
    if (!this.settings.enabled) return '音はオフです';
    if (this.errors.length) return '一部の音を読み込めませんでした';
    if (this.context?.state !== 'running') return '画面をタップすると音が始まります';
    return this.ready ? '' : '音を準備しています…';
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.resetTimeline();
    if (!active) this.silence();
    else if (this.context && this.settings.enabled) void this.start();
  }
  setSettings(settings: AudioSettings) {
    this.settings = { ...settings };
    saveAudioSettings(this.settings);
    if (!settings.enabled) this.silence();
    else {
      this.applyVolumes();
      for (const voice of this.voices) if (!settings[voice.bus]) this.stopVoice(voice);
      if (this.active) void this.start();
    }
  }
  private resetTimeline() {
    this.env = null;
    this.lastIdentity = '';
    this.nextEnvironment = this.nextMusic = 0;
    this.nextBird = this.nextDrop = 0;
    this.phraseStarted = 0;
    this.phraseIndex = 0;
  }
  private ramp(param: AudioParam, value: number, speed = 0.18) {
    if (!this.context) return;
    param.setTargetAtTime(value, this.context.currentTime, speed);
  }
  private applyVolumes() {
    if (!this.context) return;
    for (const name of ['ambience', 'music'] as const)
      this.ramp(this.buses[name].gain, this.settings[name]);
  }
  async start() {
    if (this.disposed || !this.settings.enabled || document.hidden) return;
    try {
      if (!this.context) this.initialize();
      await this.context!.resume();
      // Resume can resolve after leaving the room, muting or hiding the page.
      if (!this.active || !this.settings.enabled || document.hidden || this.disposed) {
        this.silence();
        return;
      }
      this.applyVolumes();
      this.ramp(this.master.gain, 0.8, 0.25);
      if (!this.loading) this.loading = this.load();
      await this.loading;
    } catch (e) {
      if (!this.disposed && !this.errors.includes(String(e))) this.errors.push(String(e));
    }
  }
  private initialize() {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.context = new Constructor());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 12;
    limiter.ratio.value = 5;
    this.master.connect(limiter).connect(ctx.destination);
    this.buses = { ambience: ctx.createGain(), music: ctx.createGain() };
    for (const bus of Object.values(this.buses)) bus.connect(this.master);
    const generated = natureSynthesis(ctx);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = generated.impulse;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.buses.ambience.connect(this.reverbSend);
    this.buses.music.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb).connect(this.master);
    for (const [key, buffer] of Object.entries(generated))
      if (key !== 'impulse') this.buffers.set(key, buffer);
  }
  private async load() {
    // Decode sequentially to bound temporary memory on phones.
    for (const name of FILES) {
      if (this.disposed) return;
      try {
        const response = await fetch(`/audio/nature/${name}.wav`, { signal: this.abort.signal });
        if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
        const buffer = await this.context!.decodeAudioData(await response.arrayBuffer());
        if (this.disposed) return;
        this.buffers.set(name, buffer);
        this.stats.loaded++;
      } catch (e) {
        if (!this.disposed) this.errors.push(String(e));
      }
    }
    if (!this.disposed) {
      this.ready = true;
      this.resetTimeline();
    }
  }
  private silence() {
    this.resetTimeline();
    if (!this.context || this.context.state === 'closed') return;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setValueAtTime(0, this.context.currentTime);
    for (const voice of [...this.voices]) this.stopVoice(voice);
    for (const loop of this.loops.values()) {
      loop.gain.gain.cancelScheduledValues(this.context.currentTime);
      loop.gain.gain.value = 0;
    }
    void this.context.suspend().catch(() => {});
  }
  private stopVoice(voice: Voice) {
    voice.source.onended = null;
    try {
      voice.source.stop();
    } catch {
      /* Already ended. */
    }
    for (const node of voice.nodes) node.disconnect();
    this.voices.delete(voice);
    this.stats.voices = this.voices.size;
  }
  private panner(point: SoundPoint) {
    const p = this.context!.createPanner();
    // Bounded, cheap spatial panning works with speakers as well as headphones.
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.rolloffFactor = 0.8;
    p.maxDistance = 60;
    p.positionX.value = point.x;
    p.positionY.value = point.y;
    p.positionZ.value = point.z;
    return p;
  }
  private play(
    name: string,
    volume: number,
    bus: Voice['bus'],
    rate = 1,
    point?: SoundPoint,
    lowpass = 15000,
  ) {
    if (
      !this.context ||
      !this.active ||
      !this.settings.enabled ||
      document.hidden ||
      this.context.state !== 'running' ||
      !this.settings[bus]
    )
      return;
    const buffer = this.buffers.get(name);
    if (!buffer || this.voices.size >= 14) return;
    const source = this.context.createBufferSource(),
      gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    source.connect(filter).connect(gain);
    const nodes: AudioNode[] = [source, filter, gain];
    if (point) {
      const p = this.panner(point);
      gain.connect(p).connect(this.buses[bus]);
      nodes.push(p);
    } else gain.connect(this.buses[bus]);
    const voice = { source, gain, nodes, bus, name };
    this.voices.add(voice);
    source.onended = () => this.stopVoice(voice);
    this.stats.voices = this.voices.size;
    this.stats.peakVoices = Math.max(this.stats.peakVoices, this.voices.size);
    source.start();
  }
  private loop(name: string, bufferName: string, volume: number, point?: SoundPoint) {
    if (!this.context || !this.buffers.has(bufferName)) return;
    let loop = this.loops.get(name);
    if (!loop) {
      const source = this.context.createBufferSource(),
        gain = this.context.createGain();
      source.buffer = this.buffers.get(bufferName)!;
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain);
      const panner = point ? this.panner(point) : undefined;
      if (panner) gain.connect(panner).connect(this.buses.ambience);
      else gain.connect(this.buses.ambience);
      loop = { source, gain, panner };
      this.loops.set(name, loop);
      source.start(0, name === 'shore' ? 7 : 0);
      this.stats.loops = this.loops.size;
    }
    this.ramp(loop.gain.gain, volume, 0.45);
    if (loop.panner && point)
      for (const axis of ['X', 'Y', 'Z'] as const)
        this.ramp(loop.panner[`position${axis}`], point[axis.toLowerCase()], 0.12);
  }
  update(world: any, time: number) {
    if (
      !this.context ||
      !this.ready ||
      !this.active ||
      !this.settings.enabled ||
      document.hidden ||
      this.context.state !== 'running'
    )
      return;
    const entity = world.players.get(world.selfId),
      p = entity?.state;
    if (!p || !entity.actor || !entity.model.visible) {
      this.resetTimeline();
      for (const loop of this.loops.values()) this.ramp(loop.gain.gain, 0);
      for (const voice of this.voices) this.ramp(voice.gain.gain, 0);
      return;
    }
    const position = entity.model.position as SoundPoint;
    const identity = `${p.id}/${p.species}/${p.gender}/${p.warpSequence ?? 0}`;
    const baseline = this.lastIdentity !== identity;
    if (baseline) {
      this.resetTimeline();
      this.lastIdentity = identity;
      for (const voice of this.voices) this.ramp(voice.gain.gain, 0, 0.18);
    }
    world.camera.getWorldDirection(this.forward);
    const listener = this.context.listener;
    // Listen at the player, orient with the camera; zoom never changes loudness.
    for (const axis of ['X', 'Y', 'Z'] as const) {
      const key = axis.toLowerCase();
      listener[`position${axis}`].value = position[key] + (axis === 'Y' ? 1.2 : 0);
      listener[`forward${axis}`].value = this.forward[key];
    }
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
    if (time >= this.nextEnvironment || !this.env) {
      this.nextEnvironment = time + 0.1;
      const e = (this.env = natureEnvironment(position, time, world.state.maritime));
      const outdoors = 1 - e.cave;
      if (e.cave > 0.1)
        for (const voice of this.voices)
          if (voice.name.startsWith('birds-')) this.ramp(voice.gain.gain, 0, 0.3);
      this.ramp(this.reverbSend.gain, e.cave * 0.2, 0.4);
      this.loop('wind', 'wind', (0.11 + e.wind.strength * 0.24) * outdoors);
      this.loop(
        'river',
        'river',
        (1 - unit(e.river.distance / 32)) * 0.72 * outdoors,
        e.river.point,
      );
      this.loop('shore', 'river', e.shore * 0.32 * outdoors);
      this.loop('rain', 'rain', e.rain * 0.6);
      const fires = world.fires.filter((f) => !f.cave || world.state.camp.caveFireLit);
      let fire: any = null,
        distance = Infinity;
      for (const f of fires) {
        const d = Math.hypot(
          f.root.position.x - position.x,
          f.root.position.y - position.y,
          f.root.position.z - position.z,
        );
        if (d < distance && (e.cave > 0.8 ? f.cave : !f.cave)) {
          distance = d;
          fire = f;
        }
      }
      const fireVolume = fire ? (1 - unit(distance / 17)) * 0.8 : 0;
      this.loop('fire', 'fire', fireVolume, fire?.root.position ?? position);
      const torch = caveTorchLit(p) ? 0.055 : 0;
      this.loop('torch', 'fire', torch);
      this.stats.cave = e.cave;
      this.stats.river = (1 - unit(e.river.distance / 32)) * outdoors;
      this.stats.fire = fireVolume;
      this.place =
        e.cave > 0.6
          ? 'cave'
          : Math.hypot(position.x - CAMP.x, position.z - CAMP.z) < 17
            ? 'camp'
            : 'explore';
      this.stats.place = this.place;
    }
    const e = this.env!;
    if (!this.nextBird) this.nextBird = time + 3 + Math.random() * 6;
    if (time >= this.nextBird) {
      this.nextBird = time + 11 + Math.random() * 14;
      if (e.cave < 0.05 && e.biome === 'grassland' && e.rain < 0.1) {
        this.lastBird = (this.lastBird + 1 + Math.floor(Math.random() * 2)) % 3;
        const angle = Math.random() * Math.PI * 2;
        this.play(`birds-${this.lastBird}`, 0.36, 'ambience', 0.97 + Math.random() * 0.06, {
          x: position.x + Math.cos(angle) * 9,
          y: position.y + 3,
          z: position.z + Math.sin(angle) * 9,
        });
        this.stats.birds++;
      }
    }
    if (!this.nextDrop) this.nextDrop = time + 3;
    if (time >= this.nextDrop) {
      this.nextDrop = time + 4 + Math.random() * 8;
      if (e.cave > 0.6)
        this.play('drop', 0.16, 'ambience', 0.8 + Math.random() * 0.4, {
          x: position.x + Math.sin(time) * 4,
          y: position.y + 1,
          z: position.z + Math.cos(time) * 4,
        });
    }
    this.updateMusic(time);
  }
  private updateMusic(time: number) {
    if (this.phrasePlace !== this.place) {
      // Crossfade out the previous phrase; no new note is queued across a boundary.
      for (const voice of this.voices)
        if (voice.bus === 'music') this.ramp(voice.gain.gain, 0, 0.6);
      this.phrasePlace = this.place;
      this.nextMusic = time + 2;
      this.phraseIndex = 0;
      this.phraseStarted = 0;
    }
    if (!this.nextMusic) this.nextMusic = time + 4;
    if (!this.phraseStarted && time >= this.nextMusic) {
      this.phraseStarted = time;
      this.phraseIndex = 0;
    }
    if (!this.phraseStarted) return;
    const phrase = NATURE_PHRASES[this.place];
    while (
      this.phraseIndex < phrase.length &&
      time - this.phraseStarted >= phrase[this.phraseIndex][0]
    ) {
      const [offset, pitch, volume, instrument] = phrase[this.phraseIndex++];
      if (time - this.phraseStarted - offset < 0.4) {
        this.play(instrument, volume, 'music', 2 ** ((pitch - 62) / 12));
        this.stats.musicNotes++;
      }
    }
    if (this.phraseIndex === phrase.length) {
      this.phraseStarted = 0;
      this.nextMusic = time + 22 + Math.random() * 14;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.abort.abort();
    this.silence();
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.pagehide);
    for (const loop of this.loops.values()) {
      loop.source.stop();
      loop.source.disconnect();
      loop.gain.disconnect();
      loop.panner?.disconnect();
    }
    this.loops.clear();
    this.buffers.clear();
    if (this.context) void this.context.close().catch(() => {});
  }
}
