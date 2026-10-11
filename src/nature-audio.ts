import * as THREE from 'three';
import { jumpProgress } from '../shared/jumping.mjs';
import { FoleyEvents, FOLEY_FILES, FOLEY_VARIANTS } from './nature-foley.js';
import { caveTorchLit } from '../shared/cave-light.mjs';
import { CAMP } from '../shared/world.mjs';
import { MOUNTAIN_WATERFALL } from '../shared/mountain-river.mjs';
import { FootstepClock, natureEnvironment, unit, type SoundPoint } from './nature-environment.js';
import {
  readAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from './nature-audio-settings.js';
import {
  AMBIENCE_FILES,
  MUSIC_FILES,
  NATURE_AUDIO_REVISION,
  musicRegion,
  type AmbienceLoop,
  type MusicPlace,
} from './nature-audio-design.js';
import {
  AUDIBLE_FLOOR_DBA,
  FIXED_LUFS,
  MASKING_MARGIN_DB,
  LEVELS,
  airLowpass,
  fixedGain,
  levelAt,
  playbackGain,
  rainDba,
  windDba,
  type LevelName,
} from './nature-audio-levels.js';

type ManifestFile = {
  name: string;
  url: string;
  kind: 'loop' | 'oneshot' | 'music' | 'impulse';
  /** Measured reference loudness: integrated (loop/music) or max momentary (one-shot). */
  loudness: number;
  seconds: number;
};
type Loop = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  panner?: PannerNode;
  stereo?: StereoPannerNode;
};
type LoopOptions = { point?: SoundPoint; spread?: boolean; lowpass?: number };
type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  nodes: AudioNode[];
  bus: 'ambience' | 'effects';
  name: string;
  fading?: boolean;
};
const WATERFALL_POINT: SoundPoint = {
  x: MOUNTAIN_WATERFALL.foot.x,
  y: (MOUNTAIN_WATERFALL.lip.y + MOUNTAIN_WATERFALL.foot.y) / 2,
  z: MOUNTAIN_WATERFALL.foot.z,
};
/** Needed everywhere, so readiness waits for these; the rest load when first audible. */
const CORE_FILES = [
  'wind',
  ...FOLEY_FILES,
  'birds-0',
  'birds-1',
  'birds-2',
  'birds-3',
  'birds-4',
  'birds-5',
];
const distance = (a: SoundPoint, b: SoundPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const db = (value: number) => 10 ** (value / 20);

/** Two media-element decks: long pieces stream instead of occupying decoded memory. */
class MusicDecks {
  private decks: { audio: HTMLAudioElement; gain: GainNode }[] = [];
  private current = -1;
  /** Deck used last, so a new piece never restarts the deck that is still fading out. */
  private last = -1;
  constructor(
    private context: AudioContext,
    output: AudioNode,
    onError: (message: string) => void,
  ) {
    for (let i = 0; i < 2; i++) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.addEventListener('error', () => onError(`music: ${audio.currentSrc || audio.src}`));
      const gain = context.createGain();
      gain.gain.value = 0;
      context.createMediaElementSource(audio).connect(gain).connect(output);
      this.decks.push({ audio, gain });
    }
  }
  /** Runs inside the unlocking user gesture so mobile browsers may start the decks later. */
  unlock(url: string) {
    for (const { audio } of this.decks) {
      if (!audio.paused) continue;
      if (!audio.getAttribute('src')) audio.src = url;
      audio.muted = true;
      void audio
        .play()
        .then(() => {
          if (this.decks[this.current]?.audio !== audio) audio.pause();
        })
        .catch(() => {})
        .finally(() => (audio.muted = false));
    }
  }
  start(url: string, volume: number) {
    this.fadeOut(4);
    this.current = this.last = (this.last + 1) % this.decks.length;
    const { audio, gain } = this.decks[this.current];
    if (audio.getAttribute('src') !== url) audio.src = url;
    audio.currentTime = 0;
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(volume, now, 0.8);
    return audio.play();
  }
  fadeOut(seconds: number) {
    const deck = this.decks[this.current];
    if (!deck) return;
    deck.gain.gain.cancelScheduledValues(this.context.currentTime);
    deck.gain.gain.setTargetAtTime(0, this.context.currentTime, seconds / 5);
    this.current = -1;
  }
  /** Releases decks that have faded out or finished. */
  tidy() {
    this.decks.forEach((deck, i) => {
      if (i !== this.current && !deck.audio.paused && deck.gain.gain.value < 0.002)
        deck.audio.pause();
    });
  }
  stop() {
    for (const { audio, gain } of this.decks) {
      gain.gain.cancelScheduledValues(this.context.currentTime);
      gain.gain.value = 0;
      audio.pause();
    }
    this.current = -1;
  }
  dispose() {
    this.stop();
    for (const { audio } of this.decks) {
      audio.removeAttribute('src');
      audio.load();
    }
  }
}

export class NatureAudio {
  settings = readAudioSettings();
  context: AudioContext | null = null;
  readonly stats = {
    steps: 0,
    events: 0,
    surface: '',
    birds: 0,
    musicPhrases: 0,
    voices: 0,
    peakVoices: 0,
    loops: 0,
    cave: 0,
    river: 0,
    fire: 0,
    place: '',
    loaded: 0,
    decodedBytes: 0,
    /** Current level of each audible bed at the listener, dBA (real-world scale). */
    dba: {} as Record<string, number>,
  };
  readonly errors: string[] = [];
  private active = false;
  private disposed = false;
  private loading: Promise<void> | null = null;
  private abort = new AbortController();
  private master: GainNode;
  private buses: Record<'ambience' | 'music' | 'effects', GainNode>;
  private reverbSend: GainNode;
  private reverb: ConvolverNode;
  private music: MusicDecks | null = null;
  private manifest = new Map<string, ManifestFile>();
  private buffers = new Map<string, AudioBuffer>();
  private requested = new Set<string>();
  private decodeQueue: Promise<void> = Promise.resolve();
  private loops = new Map<string, Loop>();
  private voices = new Set<Voice>();
  private steps = new FootstepClock();
  private events = new FoleyEvents();
  private variants = new Map<string, number>();
  private lastConfirm = -Infinity;
  private forward = new THREE.Vector3();
  private listenerPoint: SoundPoint = { x: 0, y: 0, z: 0 };
  private nextBird = 0;
  private nextDrop = 0;
  private nextEnvironment = 0;
  private nextMusic = 0;
  private place: MusicPlace = 'explore';
  private phrasePlace: MusicPlace = 'explore';
  private candidatePlace: MusicPlace = 'explore';
  private candidateSince = 0;
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
      if (!settings.music) this.music?.stop();
      if (this.active) void this.start();
    }
  }
  private resetTimeline() {
    this.steps.reset();
    this.events.reset();
    this.env = null;
    this.lastIdentity = '';
    this.nextEnvironment = this.nextMusic = 0;
    this.nextBird = this.nextDrop = 0;
    this.candidateSince = 0;
  }
  private ramp(param: AudioParam, value: number, speed = 0.18) {
    if (!this.context) return;
    param.setTargetAtTime(value, this.context.currentTime, speed);
  }
  private applyVolumes() {
    if (!this.context) return;
    for (const name of ['ambience', 'music', 'effects'] as const)
      this.ramp(this.buses[name].gain, this.settings[name]);
  }
  private url(file: ManifestFile) {
    return `${file.url}?v=${NATURE_AUDIO_REVISION}`;
  }
  async start() {
    if (this.disposed || !this.settings.enabled || document.hidden) return;
    try {
      if (!this.context) this.initialize();
      // Synchronous part of a tap/key handler: allow the music decks to start later.
      this.music?.unlock(`/audio/nature/bgm-explore.mp3?v=${NATURE_AUDIO_REVISION}`);
      await this.context!.resume();
      // Resume can resolve after leaving the room, muting or hiding the page.
      if (!this.active || !this.settings.enabled || document.hidden || this.disposed) {
        this.silence();
        return;
      }
      this.applyVolumes();
      this.ramp(this.master.gain, 1, 0.25);
      if (!this.loading) this.loading = this.load();
      await this.loading;
    } catch (e) {
      if (!this.disposed && !this.errors.includes(String(e))) this.errors.push(String(e));
    }
  }
  private initialize() {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.context = new Constructor({ sampleRate: 44100, latencyHint: 'playback' }));
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // Safety only: the calibrated mix leaves headroom except right beside the waterfall.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 2;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    this.master.connect(limiter).connect(ctx.destination);
    this.buses = { ambience: ctx.createGain(), music: ctx.createGain(), effects: ctx.createGain() };
    for (const bus of Object.values(this.buses)) bus.connect(this.master);
    // Measured cathedral response (stone, long decay) for cave drips, fire and torch.
    this.reverb = ctx.createConvolver();
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.reverbSend.connect(this.reverb).connect(this.buses.ambience);
    this.music = new MusicDecks(ctx, this.buses.music, (message) => {
      if (!this.errors.includes(message)) this.errors.push(message);
    });
  }
  private async load() {
    const response = await fetch(`/audio/nature/manifest.json?v=${NATURE_AUDIO_REVISION}`, {
      signal: this.abort.signal,
    });
    if (!response.ok) throw Error(`manifest: HTTP ${response.status}`);
    for (const file of (await response.json()).files as ManifestFile[])
      this.manifest.set(file.name, file);
    for (const name of [...AMBIENCE_FILES, ...FOLEY_FILES, ...MUSIC_FILES])
      if (!this.manifest.has(name)) this.errors.push(`${name}: missing from manifest`);
    await Promise.all(CORE_FILES.map((name) => this.need(name)));
    if (!this.disposed) {
      this.ready = true;
      this.resetTimeline();
    }
  }
  /** Decode one file (sequentially, to bound temporary memory on phones). */
  private need(name: string): Promise<void> {
    if (this.buffers.has(name) || this.requested.has(name) || this.disposed)
      return this.decodeQueue;
    const file = this.manifest.get(name);
    if (!file) return this.decodeQueue;
    this.requested.add(name);
    this.decodeQueue = this.decodeQueue.then(async () => {
      if (this.disposed) return;
      try {
        const response = await fetch(this.url(file), { signal: this.abort.signal });
        if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
        const buffer = await this.context!.decodeAudioData(await response.arrayBuffer());
        if (this.disposed) return;
        this.buffers.set(name, buffer);
        if (name === 'cave-ir') this.reverb.buffer = buffer;
        this.stats.loaded++;
        this.stats.decodedBytes += buffer.length * buffer.numberOfChannels * 4;
      } catch (e) {
        if (!this.disposed) this.errors.push(String(e));
      }
    });
    return this.decodeQueue;
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
    this.music?.stop();
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
  private fadeVoice(voice: Voice, seconds = 1) {
    if (!this.context || voice.fading) return;
    voice.fading = true;
    this.ramp(voice.gain.gain, 0, seconds / 5);
    voice.source.stop(this.context.currentTime + seconds);
  }
  private panner(point: SoundPoint) {
    const p = this.context!.createPanner();
    // Direction only: distance is already in the calibrated gain (nature-audio-levels).
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.rolloffFactor = 0;
    p.positionX.value = point.x;
    p.positionY.value = point.y;
    p.positionZ.value = point.z;
    return p;
  }
  /** Linear gain for `name` heard at `dba`, from the file's measured loudness. */
  private gainFor(name: string, dba: number, floor = AUDIBLE_FLOOR_DBA) {
    const file = this.manifest.get(name);
    return file ? playbackGain(dba, file.loudness, floor) : 0;
  }
  private play(
    name: string,
    gain: number,
    bus: Voice['bus'],
    rate = 1,
    point?: SoundPoint,
    lowpass = 20000,
  ) {
    if (
      !this.context ||
      !this.active ||
      !this.settings.enabled ||
      document.hidden ||
      this.context.state !== 'running' ||
      !this.settings[bus] ||
      gain <= 0
    )
      return;
    const buffer = this.buffers.get(name);
    if (!buffer) {
      void this.need(name);
      return;
    }
    if (
      this.voices.size >= 14 ||
      (bus === 'effects' && [...this.voices].filter((v) => v.bus === 'effects').length >= 6)
    )
      return;
    const source = this.context.createBufferSource(),
      amp = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    amp.gain.value = gain;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(20000, lowpass);
    source.connect(filter).connect(amp);
    const nodes: AudioNode[] = [source, filter, amp];
    if (point) {
      const p = this.panner(point);
      amp.connect(p).connect(this.buses[bus]);
      if (name.startsWith('drop-')) p.connect(this.reverbSend);
      nodes.push(p);
    } else amp.connect(this.buses[bus]);
    const voice = { source, gain: amp, nodes, bus, name };
    this.voices.add(voice);
    source.onended = () => this.stopVoice(voice);
    this.stats.voices = this.voices.size;
    this.stats.peakVoices = Math.max(this.stats.peakVoices, this.voices.size);
    source.start();
    return true;
  }
  /**
   * A steady bed at its real level (dBA at the listener); silent beds are never loaded.
   * `floor` is the background that masks it (the breeze, for distant water and fire).
   */
  private bed(
    name: AmbienceLoop,
    dba: number,
    scale = 1,
    options: LoopOptions = {},
    floor = AUDIBLE_FLOOR_DBA,
  ) {
    const gain = dba > floor ? this.gainFor(name, dba, floor) * scale : 0;
    if (gain > 1e-4) this.stats.dba[name] = Math.round(dba * 10) / 10;
    else delete this.stats.dba[name];
    this.loop(name, gain, options);
    return gain;
  }
  private loop(
    name: AmbienceLoop,
    volume: number,
    { point, spread, lowpass = 20000 }: LoopOptions,
  ) {
    if (!this.context) return;
    if (!this.buffers.has(name)) {
      if (volume > 0) void this.need(name);
      return;
    }
    let loop = this.loops.get(name);
    if (!loop) {
      const source = this.context.createBufferSource(),
        gain = this.context.createGain();
      source.buffer = this.buffers.get(name)!;
      source.loop = true;
      gain.gain.value = 0;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      filter.frequency.value = Math.min(20000, lowpass);
      source.connect(filter).connect(gain);
      const panner = point && !spread ? this.panner(point) : undefined;
      const stereo = spread ? this.context.createStereoPanner() : undefined;
      if (panner) gain.connect(panner).connect(this.buses.ambience);
      else if (stereo) gain.connect(stereo).connect(this.buses.ambience);
      else gain.connect(this.buses.ambience);
      if (name === 'fire') (panner ?? gain).connect(this.reverbSend);
      if (name === 'torch') gain.connect(this.reverbSend);
      loop = { source, gain, filter, panner, stereo };
      this.loops.set(name, loop);
      source.start(0, Math.random() * source.buffer.duration);
      this.stats.loops = this.loops.size;
    }
    this.ramp(loop.gain.gain, volume, 0.7);
    this.ramp(loop.filter.frequency, Math.min(20000, lowpass), 0.7);
    if (loop.panner && point)
      for (const axis of ['X', 'Y', 'Z'] as const)
        this.ramp(loop.panner[`position${axis}`], point[axis.toLowerCase()], 0.12);
    if (loop.stereo && point) {
      const listener = this.listenerPoint;
      const dx = point.x - listener.x;
      const dz = point.z - listener.z;
      const side = dx * -this.forward.z + dz * this.forward.x;
      this.ramp(
        loop.stereo.pan,
        Math.max(-0.65, Math.min(0.65, side / Math.max(5, Math.hypot(dx, dz)))),
        0.2,
      );
    }
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
      for (const voice of this.voices) this.fadeVoice(voice);
      return;
    }
    const position = entity.model.position as SoundPoint;
    const identity = `${p.id}/${p.species}/${p.gender}/${p.warpSequence ?? 0}`;
    const baseline = this.lastIdentity !== identity;
    if (baseline) {
      this.resetTimeline();
      this.lastIdentity = identity;
      for (const voice of this.voices) this.fadeVoice(voice);
    }
    world.camera.getWorldDirection(this.forward);
    const listener = this.context.listener;
    // Listen at the player's head, orient with the camera; zoom never changes loudness.
    this.listenerPoint = { x: position.x, y: position.y + 1.2, z: position.z };
    for (const axis of ['X', 'Y', 'Z'] as const) {
      const key = axis.toLowerCase();
      listener[`position${axis}`].value = this.listenerPoint[key];
      listener[`forward${axis}`].value = this.forward[key];
    }
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
    if (time >= this.nextEnvironment || !this.env) {
      this.nextEnvironment = time + 0.1;
      this.environment(world, p, position, time);
    }
    const e = this.env!;
    this.stats.surface = e.surface;
    const motion = p.id === world.predictedMotion?.id ? world.predictedMotion : p;
    const animation = entity.actor.animation;
    const gait = /^(Walk|Run)_Loop$/.test(animation.name);
    const phase = gait ? (animation.current.time / animation.current.getClip().duration) % 1 : null;
    if (
      this.steps.update(
        {
          ...position,
          id: p.id,
          warp: p.warpSequence ?? 0,
          moving: !!motion.moving && motion.speed > 0.03,
          grounded:
            !p.downedUntil &&
            !p.mountId &&
            !p.boatId &&
            !p.carrierId &&
            !p.passengerId &&
            jumpProgress(p, world.serverNow()) === null,
          phase,
          clip: animation.name,
        },
        time,
      )
    ) {
      // Running steps land harder: about 4 dB louder in the field.
      if (this.effect('step-' + e.surface, undefined, motion.running ? 4 : 0)) this.stats.steps++;
    }
    this.events.update(world, p, world.serverNow(), baseline, (name, point) => {
      if (this.effect(name, point)) this.stats.events++;
    });
    if (!this.nextBird) this.nextBird = time + 3 + Math.random() * 6;
    if (time >= this.nextBird) {
      this.nextBird = time + 12 + Math.random() * 16;
      if (e.cave < 0.05 && e.biome === 'grassland' && e.rain < 0.1) {
        this.lastBird = (this.lastBird + 1 + Math.floor(Math.random() * 5)) % 6;
        const angle = Math.random() * Math.PI * 2;
        const range = 16 + Math.random() * 26;
        const point = {
          x: position.x + Math.cos(angle) * range,
          y: position.y + 3 + Math.random() * 5,
          z: position.z + Math.sin(angle) * range,
        };
        const d = distance(point, this.listenerPoint);
        const name = `birds-${this.lastBird}`;
        if (
          this.play(
            name,
            this.gainFor(name, levelAt(LEVELS.birds, d)),
            'ambience',
            0.995 + Math.random() * 0.01,
            point,
            airLowpass(d),
          )
        )
          this.stats.birds++;
      }
    }
    if (!this.nextDrop) this.nextDrop = time + 3;
    if (time >= this.nextDrop) {
      this.nextDrop = time + 6 + Math.random() * 9;
      if (e.cave > 0.6) {
        const angle = Math.random() * Math.PI * 2;
        const range = 2.5 + Math.random() * 4.5;
        const point = {
          x: position.x + Math.cos(angle) * range,
          y: position.y + 1 + Math.random() * 2,
          z: position.z + Math.sin(angle) * range,
        };
        const name = `drop-${Math.floor(Math.random() * 4)}`;
        this.play(
          name,
          this.gainFor(name, levelAt(LEVELS.drop, distance(point, this.listenerPoint))),
          'ambience',
          0.97 + Math.random() * 0.06,
          point,
        );
      }
    }
    this.updateMusic(this.context.currentTime);
  }
  private environment(world: any, p: any, position: SoundPoint, time: number) {
    const e = (this.env = natureEnvironment(position, time, world.state.maritime));
    const outdoors = 1 - e.cave;
    if (e.cave > 0.1)
      for (const voice of this.voices)
        if (voice.name.startsWith('birds-')) this.fadeVoice(voice, 1.5);
    if (e.cave > 0.05) void this.need('cave-ir');
    this.ramp(this.reverbSend.gain, e.cave * 0.32, 0.8);
    const breeze = windDba(e.wind.strength);
    this.bed('wind', breeze, outdoors);
    // Outdoors, distant steady sources disappear under the breeze; in caves only the floor.
    const masked = outdoors > 0.5 ? breeze - MASKING_MARGIN_DB : AUDIBLE_FLOOR_DBA;
    const { river, stream } = e.flow;
    this.stats.river = this.bed(
      'river',
      levelAt(LEVELS.river, river.edge),
      outdoors,
      {
        point: river.point,
        spread: true,
        lowpass: airLowpass(river.edge),
      },
      masked,
    );
    this.bed(
      'stream',
      levelAt(LEVELS.stream, stream.edge),
      outdoors,
      {
        point: stream.point,
        spread: true,
        lowpass: airLowpass(stream.edge),
      },
      masked,
    );
    const fall = distance(WATERFALL_POINT, this.listenerPoint);
    this.bed(
      'waterfall',
      levelAt(LEVELS.waterfall, fall),
      outdoors,
      {
        point: WATERFALL_POINT,
        lowpass: airLowpass(fall),
      },
      masked,
    );
    // The coastline grid saturates at 31.75 m inland; the surf fades out before that.
    this.bed(
      'shore',
      levelAt(LEVELS.shore, e.coast),
      outdoors * unit((30 - e.coast) / 8),
      {
        lowpass: airLowpass(e.coast),
      },
      masked,
    );
    this.bed('rain', rainDba(e.rain), outdoors);
    const fires = world.fires.filter((f) => !f.cave || world.state.camp.caveFireLit);
    let fire: any = null,
      nearest = Infinity;
    for (const f of fires) {
      const d = distance(f.root.position, this.listenerPoint);
      if (d < nearest && (e.cave > 0.8 ? f.cave : !f.cave)) {
        nearest = d;
        fire = f;
      }
    }
    this.stats.fire = this.bed(
      'fire',
      fire ? levelAt(LEVELS.fire, nearest) : 0,
      1,
      {
        point: fire?.root.position ?? position,
        lowpass: airLowpass(nearest),
      },
      masked,
    );
    this.bed('torch', caveTorchLit(p) ? LEVELS.torch.dba : 0);
    this.stats.cave = e.cave;
    this.place = musicRegion(
      this.place,
      e.cave,
      Math.hypot(position.x - CAMP.x, position.z - CAMP.z),
    );
    this.stats.place = this.place;
  }
  private updateMusic(time: number) {
    this.music?.tidy();
    if (!this.settings.music || !this.music) {
      this.nextMusic = 0;
      return;
    }
    if (this.candidatePlace !== this.place || !this.candidateSince) {
      this.candidatePlace = this.place;
      this.candidateSince = time;
    }
    if (this.phrasePlace !== this.candidatePlace && time - this.candidateSince >= 3) {
      this.music.fadeOut(4);
      this.phrasePlace = this.candidatePlace;
      this.nextMusic = time + 0.8;
    }
    if (!this.nextMusic) this.nextMusic = time + 5;
    if (time < this.nextMusic || this.phrasePlace !== this.place) return;
    const file = this.manifest.get(`bgm-${this.phrasePlace}`);
    if (!file) return;
    // A piece, then a long natural rest: the world is heard between phrases.
    this.nextMusic = time + file.seconds + 30 + Math.random() * 30;
    this.stats.musicPhrases++;
    this.music.start(this.url(file), fixedGain(FIXED_LUFS.music, file.loudness)).catch((e) => {
      if (!this.errors.includes(String(e))) this.errors.push(String(e));
    });
  }
  /** One action or step at its real level; `boost` adds dB (running), `point` adds distance. */
  private effect(name: string, point?: SoundPoint, boost = 0) {
    const count = FOLEY_VARIANTS[name];
    let sample = 'fx-' + name;
    if (count) {
      const previous = this.variants.get(name) ?? -1;
      const next = (previous + 1 + Math.floor(Math.random() * (count - 1))) % count;
      this.variants.set(name, next);
      sample += '-' + next;
    }
    let gain: number;
    if (name === 'confirm' || name === 'discovery')
      gain = fixedGain(FIXED_LUFS[name], this.manifest.get(sample)?.loudness ?? -23);
    else {
      const level = LEVELS[name as LevelName];
      if (!level) return;
      const dba = point ? levelAt(level, distance(point, this.listenerPoint)) : level.dba;
      // Natural variation between repetitions: +-1.5 dB, +-4 % speed for steps.
      gain = this.gainFor(sample, dba + boost) * db((Math.random() - 0.5) * 3);
    }
    const step = name.startsWith('step-');
    const rate = 1 + (Math.random() - 0.5) * (step ? 0.08 : 0.05);
    return this.play(sample, gain, 'effects', rate, point);
  }
  confirm() {
    const now = performance.now();
    if (now - this.lastConfirm < 700) return;
    this.lastConfirm = now;
    this.effect('confirm');
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
      loop.filter.disconnect();
      loop.panner?.disconnect();
      loop.stereo?.disconnect();
    }
    this.loops.clear();
    this.buffers.clear();
    this.music?.dispose();
    if (this.context) void this.context.close().catch(() => {});
  }
}
