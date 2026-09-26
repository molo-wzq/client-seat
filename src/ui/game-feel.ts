/**
 * 打击感引擎:全部反馈零素材,WebAudio 现场合成 + WAAPI 震屏。
 *
 * - 音效在首次用户手势(pointerdown)时才创建 AudioContext,满足浏览器自动播放策略;
 * - jsdom 等无 AudioContext 的环境下所有函数安全退化为无操作(测试不炸、不响);
 * - 静音选择写 localStorage,跨会话记忆;
 * - 震屏走 WAAPI,不与 CSS 动画互相覆盖;prefers-reduced-motion 时直接跳过。
 */

export type SfxName = "click" | "send" | "card" | "dial" | "stamp" | "end";

const STORAGE_KEY = "duilian-sfx";

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
let pointerSfxBound = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

export function sfxEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === null ? true : saved === "1";
  } catch {
    return true;
  }
}

export function setSfxEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // 隐私模式等场景写不进就算了,本次会话内开关仍生效。
  }
}

export function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 单音:起止频率滑音 + 指数衰减包络。 */
function tone(
  c: AudioContext,
  opts: {
    type?: OscillatorType;
    from: number;
    to?: number;
    dur: number;
    gain: number;
    delay?: number;
  },
): void {
  const t0 = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.from, t0);
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + opts.dur);
  g.gain.setValueAtTime(opts.gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.03);
}

/** 噪声脉冲:卡牌拍桌的"啪"、盖章的闷响都靠它补质感。 */
function noise(
  c: AudioContext,
  opts: { dur: number; gain: number; filter: BiquadFilterType; freq: number; delay?: number },
): void {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, Math.ceil(c.sampleRate * 0.25), c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + (opts.delay ?? 0);
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const g = c.createGain();
  src.buffer = noiseBuffer;
  filter.type = opts.filter;
  filter.frequency.value = opts.freq;
  g.gain.setValueAtTime(opts.gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(c.destination);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.03);
}

const recipes: Record<SfxName, (c: AudioContext) => void> = {
  // 木桌上轻轻一叩:所有按钮按压的统一触感。
  click: (c) => tone(c, { type: "triangle", from: 1500, to: 900, dur: 0.045, gain: 0.045 }),
  // 客户话术发出:短促下坠 pop。
  send: (c) => {
    tone(c, { from: 640, to: 180, dur: 0.11, gain: 0.16 });
    tone(c, { type: "triangle", from: 1250, to: 420, dur: 0.07, gain: 0.05 });
  },
  // 策略卡拍上桌面:低频闷响 + 纸面脆响,配合卡砖砸落动画。
  card: (c) => {
    tone(c, { from: 150, to: 52, dur: 0.16, gain: 0.42 });
    noise(c, { dur: 0.05, gain: 0.2, filter: "highpass", freq: 1900 });
  },
  // 拨号接通:两声真实回铃音(440+480Hz 双音)。
  dial: (c) => {
    for (const delay of [0, 0.22]) {
      tone(c, { from: 440, dur: 0.13, gain: 0.05, delay });
      tone(c, { from: 480, dur: 0.13, gain: 0.05, delay });
    }
  },
  // 结算盖章:与 stamp-slam 砸落帧同步的低频钝击。
  stamp: (c) => {
    tone(c, { from: 130, to: 42, dur: 0.2, gain: 0.5 });
    noise(c, { dur: 0.11, gain: 0.28, filter: "lowpass", freq: 420 });
  },
  // 挂机收口:下行双音,轻。
  end: (c) => {
    tone(c, { from: 760, to: 590, dur: 0.22, gain: 0.1 });
    tone(c, { from: 420, to: 320, dur: 0.24, gain: 0.08, delay: 0.1 });
  },
};

export function playSfx(name: SfxName): void {
  if (!sfxEnabled()) return;
  const c = getCtx();
  if (!c) return;
  try {
    recipes[name](c);
  } catch {
    // 音频设备被占用/被策略拦截:静默放弃,反馈不是关键路径。
  }
}

/**
 * 全局按钮按压声:在 main.tsx 绑定一次,事件捕获阶段监听 pointerdown。
 * 纯视觉的 DOM 都不需要逐个接线,整个应用立刻获得统一触感。
 */
export function initPointerSfx(): void {
  if (pointerSfxBound || typeof document === "undefined") return;
  pointerSfxBound = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target as Element | null;
      const btn = target?.closest?.("button");
      // 音效开关自身不响:关掉的那一下就该彻底安静。
      if (btn && !btn.classList.contains("sfx-toggle") && !(btn as HTMLButtonElement).disabled) {
        playSfx("click");
      }
    },
    { capture: true },
  );
}

/** 桌面震颤:出牌/落章时的 1–2 像素抖动,WAAPI 完事后自动消失,不留内联样式。 */
export function thump(el: HTMLElement | null): void {
  if (!el || reducedMotion()) return;
  try {
    el.animate?.(
      [
        { transform: "translate3d(0,0,0)" },
        { transform: "translate3d(1.6px,1.2px,0)" },
        { transform: "translate3d(-1.4px,0.6px,0)" },
        { transform: "translate3d(0.6px,-0.8px,0)" },
        { transform: "none" },
      ],
      { duration: 200, easing: "ease-out" },
    );
  } catch {
    // 老浏览器没有 Element.animate:跳过,动画类仍兜底。
  }
}
