"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

export type Voice = "start" | "land" | "hardLand" | "crash" | "lowFuel" | "fuelOut";

export interface Sound {
  /** Fire a one-shot effect. */
  play: (voice: Voice) => void;
  /** Engine rumble on or off. Idempotent, so it is safe to call every frame. */
  engine: (on: boolean) => void;
}

/** One engine burn: a looping noise source through its own filter and gain. */
interface Burn {
  src: AudioBufferSourceNode;
  lfo: OscillatorNode;
  nodes: AudioNode[];
  gain: GainNode;
}

/**
 * Procedural Web Audio — no asset files, so nothing to load or 404.
 *
 * The context is created lazily on the first sound, because browsers refuse
 * to start one before a user gesture. Everything runs through a master gain
 * and a compressor, so a crash on top of a full-throttle engine never clips.
 *
 * The engine rumble is the one long-lived voice. Each burn gets a fresh
 * source → low-pass → gain chain; it fades in over a few milliseconds and,
 * when the burn ends, fades out exponentially before the source is stopped
 * and every node disconnected — no click at either end, and nothing left
 * behind however often the throttle is blipped.
 */
export function useSound(enabled: boolean): Sound {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const noiseRef = useRef<AudioBuffer | null>(null);
  const burnRef = useRef<Burn | null>(null);
  const enabledRef = useRef(enabled);

  const context = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      ctxRef.current = ctx;
      masterRef.current = master;
    }
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  /**
   * Two seconds of brown noise, generated once. The tail is cross-faded into
   * the head so the buffer loops without a seam.
   */
  const noise = useCallback((ctx: AudioContext): AudioBuffer => {
    if (noiseRef.current) return noiseRef.current;
    const n = Math.floor(ctx.sampleRate * 2);
    const fade = Math.floor(ctx.sampleRate * 0.05);
    const raw = new Float32Array(n + fade);
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      raw[i] = last * 3.5;
    }
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    data.set(raw.subarray(0, n));
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = raw[i] * t + raw[n + i] * (1 - t);
    }
    noiseRef.current = buf;
    return buf;
  }, []);

  const stopBurn = useCallback(() => {
    const burn = burnRef.current;
    const ctx = ctxRef.current;
    burnRef.current = null;
    if (!burn || !ctx) return;
    const now = ctx.currentTime;
    const g = burn.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(0, now, 0.03);
    burn.src.onended = () => {
      for (const node of burn.nodes) node.disconnect();
    };
    burn.src.stop(now + 0.3);
    burn.lfo.stop(now + 0.3);
  }, []);

  const startBurn = useCallback(() => {
    const ctx = context();
    const master = masterRef.current;
    if (!ctx || !master || burnRef.current) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.9;
    // A slow wobble on the cutoff gives the roar a ragged, combustive edge.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7 + Math.random() * 3;
    const wobble = ctx.createGain();
    wobble.gain.value = 70;
    lfo.connect(wobble).connect(filter.frequency);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(0.5, now, 0.025);
    src.connect(filter).connect(gain).connect(master);
    src.start(now, Math.random() * 1.5);
    lfo.start(now);
    burnRef.current = { src, lfo, gain, nodes: [src, filter, gain, lfo, wobble] };
  }, [context, noise]);

  const engine = useCallback(
    (on: boolean) => {
      if (on && enabledRef.current) startBurn();
      else if (burnRef.current) stopBurn();
    },
    [startBurn, stopBurn]
  );

  const tone = useCallback(
    (
      ctx: AudioContext,
      freq: number,
      duration: number,
      type: OscillatorType,
      gain: number,
      slideTo?: number,
      delay = 0
    ) => {
      const master = masterRef.current;
      if (!master) return;
      const start = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), start + duration);
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(gain, start + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(amp).connect(master);
      osc.start(start);
      osc.stop(start + duration + 0.02);
      osc.onended = () => {
        osc.disconnect();
        amp.disconnect();
      };
    },
    []
  );

  /** A burst of the shared noise through a sweeping filter. */
  const burst = useCallback(
    (ctx: AudioContext, duration: number, gain: number, type: BiquadFilterType, from: number, to: number) => {
      const master = masterRef.current;
      if (!master) return;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.setValueAtTime(from, now);
      filter.frequency.exponentialRampToValueAtTime(to, now + duration);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(gain, now);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      src.connect(filter).connect(amp).connect(master);
      src.start(now, Math.random() * 0.5, duration + 0.05);
      src.onended = () => {
        src.disconnect();
        filter.disconnect();
        amp.disconnect();
      };
    },
    [noise]
  );

  const play = useCallback(
    (voice: Voice) => {
      if (!enabledRef.current) return;
      const ctx = context();
      if (!ctx) return;
      switch (voice) {
        case "start":
          // The radio "beep" that closed every Apollo transmission.
          tone(ctx, 2525, 0.22, "sine", 0.035);
          break;
        case "lowFuel":
          tone(ctx, 988, 0.08, "square", 0.04);
          tone(ctx, 988, 0.08, "square", 0.04, undefined, 0.13);
          break;
        case "fuelOut":
          tone(ctx, 440, 0.6, "sawtooth", 0.05, 110);
          break;
        case "land":
          tone(ctx, 120, 0.22, "sine", 0.22, 55);
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ctx, f, 0.42, "triangle", 0.07, undefined, 0.12 + i * 0.1));
          break;
        case "hardLand":
          tone(ctx, 95, 0.3, "sine", 0.3, 40);
          burst(ctx, 0.25, 0.25, "lowpass", 900, 120);
          [523.25, 392].forEach((f, i) => tone(ctx, f, 0.3, "triangle", 0.06, undefined, 0.18 + i * 0.13));
          break;
        case "crash":
          burst(ctx, 1.4, 0.9, "lowpass", 2600, 70);
          burst(ctx, 0.35, 0.35, "highpass", 1800, 600);
          tone(ctx, 80, 1.0, "sine", 0.5, 28);
          break;
      }
    },
    [burst, context, tone]
  );

  // Follow the switch; silence the engine the moment sound is turned off.
  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) stopBurn();
  }, [enabled, stopBurn]);

  // Release everything on unmount.
  useEffect(() => {
    return () => {
      stopBurn();
      const ctx = ctxRef.current;
      ctxRef.current = null;
      masterRef.current = null;
      if (ctx) void ctx.close();
    };
  }, [stopBurn]);

  return useMemo(() => ({ play, engine }), [play, engine]);
}
