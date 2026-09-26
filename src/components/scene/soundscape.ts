import type { TimeOfDay, ViewMode } from './config';
import type { WeatherSettings } from './weather-state';
import { beginPhase, measurePhase, performanceEnabled, phaseStatus, type FinishPhase } from '../../lib/performance';

export interface Soundscape {
  /** Call directly inside the sound button's gesture; rejects if sound cannot start. */
  setEnabled(value: boolean): Promise<void>;
  setTimeOfDay(value: TimeOfDay): void;
  setView(value: ViewMode): void;
  /** The selected free-view place is indoors. Does not create or resume audio. */
  setSheltered(value: boolean): void;
  /** Rain loads only after consent. A failure is retryable and preserves the dry sound. */
  setWeather(value: WeatherSettings): Promise<void>;
  /** Current visual wind envelope, 0..1. Does not create or resume audio. */
  setGust(strength: number): void;
  /** Actual roof drainage, 0..1. Updates loaded drops only; never fetches or resumes. */
  setRoofRunoff(flow: number): void;
  setVolume(value: number): void;
  dispose(): void;
}

type RecordingGroup = 'base' | 'rain' | 'frog';
const RECORDINGS = [
  { file: 'bamboo-wind', group: 'base', trim: 1.5, highpass: 170, lowpass: 10500, pan: 0, phase: 0 },
  { file: 'dawn-birds', group: 'base', trim: 1.4, highpass: 180, lowpass: 13500, pan: -.17, phase: 1.7 },
  { file: 'summer-cicadas', group: 'base', trim: .32, highpass: 480, lowpass: 4800, pan: .16, phase: 3.4 },
  { file: 'night-crickets', group: 'base', trim: 6.8, highpass: 280, lowpass: 10800, pan: -.09, phase: 5.1 },
  { file: 'rain-soft', group: 'rain', trim: .78, highpass: 125, lowpass: 10500, pan: -.06, phase: 1.1 },
  { file: 'rain-heavy', group: 'rain', trim: .76, highpass: 100, lowpass: 10000, pan: .02, phase: 3.2 },
  { file: 'rain-eaves', group: 'rain', trim: .58, highpass: 240, lowpass: 6800, pan: .25, phase: 4.7 },
  { file: 'rain-leaves', group: 'rain', trim: .68, highpass: 190, lowpass: 10800, pan: -.15, phase: 2.4 },
  { file: 'frog-call', group: 'frog', trim: .65, highpass: 180, lowpass: 4600, pan: -.2, phase: 0 },
] as const;
type Recording = typeof RECORDINGS[number];

// The praised dawn balance is unchanged at the default dry breeze (.28).
// Cicadas are now a distant, intermittent detail; their piercing band is also cut.
const MIX: Record<TimeOfDay, readonly number[]> = {
  dawn: [.28, .66, 0, .035],
  day: [.34, .19, .045, 0],
  noon: [.30, .035, .055, 0],
  dusk: [.36, .10, .025, .21],
  night: [.32, 0, 0, .48],
};

const CROSSFADE_SECONDS = 6;
const fadeIn = Float32Array.from({ length: 96 }, (_, i) => Math.sin(i / 95 * Math.PI / 2));
const fadeOut = Float32Array.from(fadeIn, (_, i) => fadeIn[95 - i]);

interface Layer {
  recording: Recording;
  buffer: AudioBuffer;
  gain: GainNode;
  panner: StereoPannerNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  softness: BiquadFilterNode;
  nextStart: number;
  sources: Map<AudioBufferSourceNode, GainNode>;
}

/** Local field recordings. No network, AudioContext or playback before consent. */
export function createSoundscape(): Soundscape {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let roomFilter: BiquadFilterNode | null = null;
  let layers: Layer[] = [];
  const loading = new Map<RecordingGroup, Promise<void>>();
  const loadAborts = new Map<RecordingGroup, AbortController>();
  let scheduler: ReturnType<typeof setInterval> | null = null;
  let suspendTimer: ReturnType<typeof setTimeout> | null = null;
  let enabled = false;
  let disposed = false;
  let enableVersion = 0;
  let pendingEnableTiming: FinishPhase | undefined;
  let pendingWeatherTiming: FinishPhase | undefined;
  let timeOfDay: TimeOfDay = 'dusk';
  let view: ViewMode = 'walk';
  let sheltered = false;
  let volume = .65;
  let wind = .28;
  let rain = 0;
  let autumn = 0;
  let gust = 0;
  // Until a visual callback is connected, keep the legacy rain-only balance.
  // The first explicit zero means the roof is dry, even when rain has begun.
  let roofRunoff: number | null = null;

  const frogsActive = () => rain > 0 && rain < .7;
  const isInside = () => view === 'free' && sheltered;
  const soundWidth = () => isInside() || view === 'porch' || view === 'well-rain' ? .6 : 1;

  function eavesAmount() {
    const flow = roofRunoff ?? rain;
    const proximity = view === 'well-rain' ? .54 : view === 'porch' ? .42
      : isInside() ? .52 : view === 'breeze' || view === 'moon' ? .025 : .12;
    return Math.pow(flow, .72) * proximity;
  }

  function windAmount() {
    const windLevel = wind <= .28 ? wind / .28 : 1 + (wind - .28) / .72 * .65;
    const ordinary = (view === 'breeze' ? .52 : MIX[timeOfDay][0]) * windLevel
      * (1 + rain * .3) * (1 + gust * .95);
    // A stronger moving canopy retains quiet between gusts. More spectral
    // detail and breathing room matter more than a constantly louder bed.
    const clearAutumn = autumn * Math.max(0, 1 - rain * 5);
    const canopy = (view === 'breeze' ? .50 : .44) * windLevel * (.68 + gust * .9);
    return (ordinary + (canopy - ordinary) * clearAutumn) * (view === 'well-rain' ? .72 : 1);
  }

  function ease(parameter: AudioParam, value: number, seconds: number) {
    if (!context) return;
    parameter.cancelScheduledValues(context.currentTime);
    parameter.setTargetAtTime(value, context.currentTime, seconds);
  }

  function windDetail(layer: Layer, seconds: number) {
    const clearAutumn = autumn * Math.max(0, 1 - rain * 5);
    const high = view === 'breeze' ? 310 : layer.recording.highpass;
    const low = view === 'breeze' ? 9300 : layer.recording.lowpass;
    // Open the real recording's fine leaf detail with the shared visual gust,
    // removing low rumble and a little hard midrange rather than adding noise.
    ease(layer.highpass.frequency, high + (260 + gust * 50 - high) * clearAutumn, seconds);
    ease(layer.lowpass.frequency, low + (7500 + gust * 2300 - low) * clearAutumn, seconds);
    ease(layer.softness.gain, -2.8 * clearAutumn, seconds);
  }

  function updateMix() {
    if (!context || !master || !roomFilter) return;
    const inside = isInside();
    const porch = view === 'porch';
    const well = view === 'well-rain';
    const forest = view === 'breeze' || view === 'moon';
    const shelter = inside ? .40 : porch ? .76 : well ? .88 : 1;
    ease(master.gain, enabled && !document.hidden ? volume * .78 * shelter : 0, .18);
    // Outside sounds arrive through openings; dense rainfall loses its brittle top.
    ease(roomFilter.frequency, inside ? 2600 : porch ? 10000 : well ? 11800 : 15500 - rain * 2200, .7);
    const rainfall = Math.pow(rain, .72);
    const downpour = Math.max(0, (rain - .35) / .65);
    const wildlife = rain >= .7 ? 0 : Math.pow(1 - rain, 1.6);
    const base = MIX[timeOfDay];
    for (const layer of layers) {
      const recording = layer.recording;
      let amount = 0;
      switch (recording.file) {
        case 'bamboo-wind':
          amount = windAmount();
          windDetail(layer, 1.3);
          break;
        case 'dawn-birds': {
          const birds = view === 'breeze' ? Math.min(base[1], .075) : base[1];
          amount = (birds + (Math.min(base[1], .022) - birds) * autumn) * wildlife;
          break;
        }
        case 'summer-cicadas': {
          const distantCall = Math.pow(Math.max(0, Math.sin(context.currentTime / 8.7)
            * Math.sin(context.currentTime / 19.1 + 1.8)), 2);
          amount = rain > 0 || autumn > 0 || view === 'breeze' ? 0 : base[2] * distantCall;
          break;
        }
        case 'night-crickets': amount = (view === 'breeze' ? Math.min(base[3], .09) : base[3]) * wildlife * (1 - autumn); break;
        case 'rain-soft': amount = rainfall * (.52 - downpour * .34) * (well ? .76 : 1); break;
        case 'rain-heavy': amount = downpour * .64 * (forest ? .7 : well ? .8 : 1); break;
        case 'rain-eaves':
          // Localised hard-surface drops are closest under the eaves. Indoors,
          // their lower resonances remain audible through the window and roof.
          amount = eavesAmount();
          ease(layer.lowpass.frequency, inside ? 2100 : recording.lowpass, 1.2);
          break;
        case 'rain-leaves': amount = rainfall * (forest ? .47 : porch ? .17 : well ? .12 : inside ? .09 : .28); break;
        case 'frog-call': amount = frogsActive() ? .42 * Math.min(1, (.7 - rain) / .25) : 0; break;
      }
      if (amount === 0 && (recording.group === 'frog'
        || recording.file === 'summer-cicadas' && (rain > 0 || autumn > 0)
        || recording.file === 'night-crickets' && autumn === 1
        || rain >= .7 && (recording.file === 'dawn-birds' || recording.file === 'night-crickets'))) {
        // Reach actual silence quickly; exponential fading alone never reaches zero.
        layer.gain.gain.cancelScheduledValues(context.currentTime);
        layer.gain.gain.setValueAtTime(layer.gain.gain.value, context.currentTime);
        layer.gain.gain.linearRampToValueAtTime(0, context.currentTime + .04);
      } else {
        ease(layer.gain.gain, amount * recording.trim,
          recording.file === 'rain-eaves' && roofRunoff !== null ? .35 : 1.8);
      }
    }
  }

  function scheduleLayer(layer: Layer, start: number) {
    if (!context) return;
    const source = context.createBufferSource();
    const envelope = context.createGain();
    source.buffer = layer.buffer;
    source.connect(envelope);
    envelope.connect(layer.highpass);
    const end = start + layer.buffer.duration;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.setValueCurveAtTime(fadeIn, start, CROSSFADE_SECONDS);
    envelope.gain.setValueCurveAtTime(fadeOut, end - CROSSFADE_SECONDS, CROSSFADE_SECONDS);
    layer.sources.set(source, envelope);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      layer.sources.delete(source);
    };
    source.start(start);
    source.stop(end);
    layer.nextStart = end - CROSSFADE_SECONDS;
  }

  function scheduleFrog(layer: Layer) {
    if (!context || !frogsActive() || context.currentTime < layer.nextStart) return;
    const source = context.createBufferSource();
    const envelope = context.createGain();
    const start = context.currentTime + .025;
    const end = start + layer.buffer.duration;
    source.buffer = layer.buffer;
    source.connect(envelope);
    envelope.connect(layer.highpass);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(1, start + .035);
    envelope.gain.setValueAtTime(1, end - .15);
    envelope.gain.linearRampToValueAtTime(0, end);
    layer.panner.pan.setValueAtTime(-.35 + Math.random() * .55, start);
    layer.sources.set(source, envelope);
    source.onended = () => { source.disconnect(); envelope.disconnect(); layer.sources.delete(source); };
    source.start(start);
    source.stop(end);
    // A single real call, then a long, irregular quiet interval. Never a chorus.
    layer.nextStart = end + 30 + Math.random() * 32;
  }

  function delayFrogs() {
    if (!context) return;
    for (const layer of layers) {
      if (layer.recording.group !== 'frog') continue;
      // A weather change or pause cancels the old phrase, so its tail cannot
      // reappear when the listener quickly returns to light rain.
      for (const [source, envelope] of layer.sources) {
        envelope.gain.cancelScheduledValues(context.currentTime);
        envelope.gain.setValueAtTime(envelope.gain.value, context.currentTime);
        envelope.gain.linearRampToValueAtTime(0, context.currentTime + .04);
        source.stop(context.currentTime + .05);
      }
      layer.nextStart = context.currentTime + 9 + Math.random() * 6;
    }
  }

  function schedule() {
    if (!context || context.state !== 'running' || !enabled || document.hidden) return;
    updateMix();
    for (const layer of layers) {
      if (layer.recording.group === 'frog') {
        scheduleFrog(layer);
        continue;
      }
      // Existing tails can finish, but a dry roof must not schedule another
      // recording merely because the old gain is still fading toward silence.
      if (layer.recording.file === 'rain-eaves' && roofRunoff === 0) continue;
      if (layer.recording.group === 'rain' && rain === 0 && layer.gain.gain.value < .0001) continue;
      // Twelve seconds ahead tolerates rendering hiccups without audible gaps.
      if (layer.nextStart < context.currentTime + 12) {
        scheduleLayer(layer, Math.max(layer.nextStart, context.currentTime + .025));
      }
      const recording = layer.recording;
      const autumnSweep = recording.file === 'bamboo-wind' ? autumn * (-.07 + gust * .14) : 0;
      ease(layer.panner.pan,
        (recording.pan + Math.sin(context.currentTime / 31 + recording.phase) * .045 + autumnSweep) * soundWidth(), 2);
    }
  }

  function stopLayers() {
    for (const layer of layers) {
      for (const [source, envelope] of layer.sources) {
        source.onended = null;
        source.stop();
        source.disconnect();
        envelope.disconnect();
      }
      layer.sources.clear();
      layer.gain.disconnect();
      layer.highpass.disconnect();
      layer.lowpass.disconnect();
      layer.softness.disconnect();
      layer.panner.disconnect();
    }
    layers = [];
  }

  function loadRecordings(group: RecordingGroup): Promise<void> {
    const pending = loading.get(group);
    if (pending) return pending;
    if (layers.some(layer => layer.recording.group === group)) return Promise.resolve();
    const audioContext = context!;
    const controller = new AbortController();
    loadAborts.set(group, controller);
    const finishGroup = beginPhase('audio.group-ready', { group });
    const recordings = RECORDINGS.filter(recording => recording.group === group);
    // A stalled connection is a retryable error, never an endless loading control.
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
    const request = Promise.all(recordings.map(async recording => {
      const file = `/audio/${recording.file}.mp3`;
      let finish = beginPhase('audio.download', { group, file });
      try {
        const response = await fetch(file, { signal: controller.signal });
        if (!response.ok) throw new Error(`自然声加载失败（${recording.file} / ${response.status}）`);
        const data = await response.arrayBuffer();
        finish(disposed ? 'cancelled' : 'success', { bytes: data.byteLength });
        finish = beginPhase('audio.decode', { group, file });
        const buffer = await audioContext.decodeAudioData(data);
        if (buffer.duration < (group === 'frog' ? .3 : CROSSFADE_SECONDS * 3)) {
          throw new Error(`自然声片段不完整（${recording.file}）`);
        }
        finish(disposed ? 'cancelled' : 'success', { durationSeconds: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
        return { recording, buffer };
      } catch (error) {
        finish(disposed ? 'cancelled' : timedOut ? 'error' : phaseStatus(error), { timedOut });
        throw error;
      }
    })).then(buffers => {
      // Only a recording already available when rain ends may supply its tail.
      // An obsolete in-flight rain load must not create a new drip source.
      if (disposed || group === 'rain' && rain === 0) {
        finishGroup(disposed ? 'cancelled' : 'skipped', { reason: disposed ? 'disposed' : 'weather-cleared' });
        return;
      }
      for (const { buffer, recording } of buffers) {
        const gain = audioContext.createGain();
        const highpass = audioContext.createBiquadFilter();
        const lowpass = audioContext.createBiquadFilter();
        const softness = audioContext.createBiquadFilter();
        const panner = audioContext.createStereoPanner();
        highpass.type = 'highpass';
        highpass.frequency.value = recording.highpass;
        highpass.Q.value = .5;
        lowpass.type = 'lowpass';
        lowpass.frequency.value = recording.lowpass;
        lowpass.Q.value = .5;
        softness.type = 'peaking';
        softness.frequency.value = 3100;
        softness.Q.value = .7;
        softness.gain.value = recording.file === 'summer-cicadas' ? -10 : 0;
        gain.gain.value = 0;
        panner.pan.value = recording.pan;
        highpass.connect(lowpass);
        lowpass.connect(softness);
        softness.connect(gain);
        gain.connect(panner);
        panner.connect(roomFilter!);
        layers.push({ recording, buffer, gain, highpass, lowpass, softness, panner,
          nextStart: audioContext.currentTime + (group === 'frog' ? 9 + Math.random() * 6 : .04), sources: new Map() });
      }
      updateMix();
      finishGroup('success', { recordings: buffers.length, boundary: 'audio-nodes-connected' });
    }).catch(error => {
      finishGroup(disposed ? 'cancelled' : 'error', { timedOut });
      controller.abort();
      if (disposed) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('自然声加载超时，请再试一次');
      }
      throw error;
    }).finally(() => {
      clearTimeout(timeout);
      loading.delete(group);
      loadAborts.delete(group);
    });
    loading.set(group, request);
    return request;
  }

  async function loadWeatherRecordings() {
    if (rain > 0) {
      try { await loadRecordings('rain'); }
      catch (error) { if (rain > 0) throw error; }
    }
    // The small optional call follows the rain bed, and may no longer be needed.
    if (disposed || !enabled || !frogsActive()) return;
    try { await loadRecordings('frog'); }
    catch (error) { if (frogsActive()) throw error; }
  }

  function clearSuspendTimer() {
    if (suspendTimer) clearTimeout(suspendTimer);
    suspendTimer = null;
  }

  function suspendAfterFade() {
    clearSuspendTimer();
    if (!context || context.state !== 'running') return;
    suspendTimer = setTimeout(() => {
      suspendTimer = null;
      if (context?.state === 'running' && (!enabled || document.hidden)) {
        void context.suspend().catch(error => console.warn('自然声暂停失败', error));
      }
    }, 1100);
  }

  function resumeContext(reason: 'enable' | 'visibility') {
    const audioContext = context!;
    const finish = beginPhase('audio.resume', { reason });
    try {
      // Keep the actual resume call synchronous in the original user gesture.
      const resumed = audioContext.resume();
      if (performanceEnabled()) void resumed.then(
        () => finish(disposed ? 'cancelled' : 'success', { contextState: audioContext.state, boundary: 'resume-promise-settled' }),
        error => finish(disposed ? 'cancelled' : phaseStatus(error)),
      );
      return resumed;
    } catch (error) { finish(phaseStatus(error)); throw error; }
  }

  function visibilityChanged() {
    if (!context || disposed) return;
    delayFrogs();
    updateMix();
    if (document.hidden) {
      suspendAfterFade();
      return;
    }
    clearSuspendTimer();
    if (enabled) {
      void resumeContext('visibility').then(() => { updateMix(); schedule(); }).catch(error => {
        console.warn('浏览器尚未恢复自然声，请重新开启声音', error);
      });
    }
  }

  return {
    async setEnabled(value) {
      pendingEnableTiming?.('superseded');
      const finish = beginPhase(value ? 'audio.enable' : 'audio.disable', { view, timeOfDay, rain });
      pendingEnableTiming = finish;
      if (disposed) {
        finish('cancelled', { reason: 'disposed' });
        if (value) throw new Error('自然声已关闭，请重新进入场景');
        return;
      }
      const version = ++enableVersion;
      try {
        enabled = value;
        clearSuspendTimer();
        delayFrogs();
        if (!value) {
          pendingWeatherTiming?.('cancelled', { reason: 'sound-disabled' });
          updateMix();
          suspendAfterFade();
          finish('success', { boundary: 'mute-fade-scheduled' });
          return;
        }
      } catch (error) { finish(phaseStatus(error)); throw error; }
      try {
        if (!context) {
          const AudioContextClass = window.AudioContext
            ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioContextClass) throw new Error('当前浏览器暂不支持自然声播放');
          context = measurePhase('audio.context-create', () => new AudioContextClass({ latencyHint: 'playback' }));
          master = context.createGain();
          master.gain.value = 0;
          roomFilter = context.createBiquadFilter();
          roomFilter.type = 'lowpass';
          roomFilter.frequency.value = 15500;
          roomFilter.Q.value = .5;
          roomFilter.connect(master);
          master.connect(context.destination);
          document.addEventListener('visibilitychange', visibilityChanged);
          scheduler = setInterval(schedule, 1500);
        }
        // Resume synchronously in the gesture, before waiting for network/decode.
        await Promise.all([
          resumeContext('enable'),
          loadRecordings('base'),
          // A clear view or storm can supersede pending rain / frog recordings.
          loadWeatherRecordings(),
        ]);
        if (disposed || !enabled || version !== enableVersion) { finish(disposed ? 'cancelled' : 'superseded'); return; }
        if (!document.hidden && context.state !== 'running') throw new Error('请再次轻点声音按钮，允许浏览器播放');
        updateMix();
        schedule();
        if (document.hidden) suspendAfterFade();
        // Loading, decode, resume and scheduling completed. This does not
        // measure acoustic output; recordings still use the existing fades.
        finish('success', { contextState: context.state, hidden: document.hidden, boundary: 'audio-api-ready' });
      } catch (error) {
        if (disposed || !enabled || version !== enableVersion) { finish(disposed ? 'cancelled' : 'superseded'); return; }
        finish(phaseStatus(error));
        enabled = false;
        updateMix();
        suspendAfterFade();
        throw error;
      }
    },
    setTimeOfDay(value) { timeOfDay = value; updateMix(); },
    setView(value) { view = value; updateMix(); },
    setSheltered(value) {
      if (disposed || sheltered === value) return;
      sheltered = value;
      updateMix();
    },
    async setWeather(value) {
      pendingWeatherTiming?.('superseded');
      const finish = beginPhase('audio.weather-ready', { view, timeOfDay, rain: value.rain, wind: value.wind, autumn: value.autumn ?? 0 });
      pendingWeatherTiming = finish;
      if (disposed) { finish('cancelled'); return; }
      try {
        const hadFrogs = frogsActive();
        if (Number.isFinite(value.wind)) wind = Math.min(1, Math.max(0, value.wind));
        if (Number.isFinite(value.rain)) rain = Math.min(1, Math.max(0, value.rain));
        if (Number.isFinite(value.autumn ?? 0)) autumn = Math.min(1, Math.max(0, value.autumn ?? 0));
        if (hadFrogs !== frogsActive()) delayFrogs();
        updateMix();
      } catch (error) { finish(phaseStatus(error)); throw error; }
      if (!enabled || !context || rain === 0) {
        finish(!enabled || !context ? 'skipped' : 'success', { reason: !enabled || !context ? 'sound-disabled' : 'dry-mix', boundary: 'mix-updated' });
        return;
      }
      try {
        await loadWeatherRecordings();
      } catch (error) {
        // Muting, leaving rain, or disposal supersedes this pending request.
        if (disposed || !enabled || rain === 0) { finish(disposed ? 'cancelled' : 'superseded'); return; }
        finish(phaseStatus(error));
        throw error;
      }
      if (disposed || !enabled) { finish(disposed ? 'cancelled' : 'superseded'); return; }
      try { updateMix(); schedule(); }
      catch (error) { finish(phaseStatus(error)); throw error; }
      finish('success', { contextState: context?.state, boundary: 'weather-audio-scheduled' });
    },
    setGust(strength) {
      if (disposed || !Number.isFinite(strength)) return;
      const next = Math.min(1, Math.max(0, strength));
      if (next === gust || next > 0 && Math.abs(next - gust) < .002) return;
      gust = next;
      const leaves = layers.find(layer => layer.recording.file === 'bamboo-wind');
      if (!leaves || !context) return;
      // The visual gust is the only envelope clock; leaves react without a howl.
      ease(leaves.gain.gain, windAmount() * leaves.recording.trim, .12);
      if (autumn > 0) {
        windDetail(leaves, .18);
        ease(leaves.panner.pan, autumn * (-.07 + gust * .14) * soundWidth(), .7);
      }
    },
    setRoofRunoff(flow) {
      if (disposed || !Number.isFinite(flow)) return;
      const next = Math.min(1, Math.max(0, flow));
      if (next === roofRunoff) return;
      roofRunoff = next;
      const eaves = layers.find(layer => layer.recording.file === 'rain-eaves');
      if (!eaves || !context) return;
      ease(eaves.gain.gain, eavesAmount() * eaves.recording.trim, .35);
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      volume = Math.min(1, Math.max(0, value));
      updateMix();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingEnableTiming?.('cancelled', { reason: 'disposed' });
      pendingWeatherTiming?.('cancelled', { reason: 'disposed' });
      enabled = false;
      for (const controller of loadAborts.values()) controller.abort();
      clearSuspendTimer();
      if (scheduler) clearInterval(scheduler);
      document.removeEventListener('visibilitychange', visibilityChanged);
      stopLayers();
      roomFilter?.disconnect();
      master?.disconnect();
      if (context && context.state !== 'closed') {
        void context.close().catch(error => console.warn('自然声资源释放失败', error));
      }
    },
  };
}
