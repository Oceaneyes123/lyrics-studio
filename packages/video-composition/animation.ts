import {Easing, interpolate, interpolateColors} from 'remotion';
import type {Animation, AnimationProperty, ColorProperty} from '../project-model/animation';

const easing = {linear: Easing.linear, hold: (_: number) => 0,
  'ease-in': Easing.in(Easing.quad), 'ease-out': Easing.out(Easing.quad), 'ease-in-out': Easing.inOut(Easing.quad)};
export function animatedValue(animation: Animation | undefined, property: AnimationProperty, atMs: number, fallback: number) {
  const keys = animation?.curves[property]; if (!keys?.length) return fallback;
  const at = atMs + animation!.originMs;
  if (at <= keys[0].timeMs) return keys[0].value;
  const next = keys.findIndex(key => key.timeMs > at);
  if (next === -1) return keys.at(-1)!.value;
  const a = keys[next - 1], b = keys[next];
  return interpolate(at, [a.timeMs, b.timeMs], [a.value, b.value], {easing: easing[a.easing], extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
}
export function animatedColor(animation: Animation | undefined, property: ColorProperty, atMs: number, fallback: string) {
  const keys = animation?.colors?.[property]; if (!keys?.length) return fallback;
  const at = atMs + animation!.originMs;
  if (at <= keys[0].timeMs) return keys[0].value;
  const next = keys.findIndex(key => key.timeMs > at); if (next < 0) return keys.at(-1)!.value;
  const a = keys[next - 1], b = keys[next];
  const progress = interpolate(at, [a.timeMs, b.timeMs], [0, 1], {easing: easing[a.easing], extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return interpolateColors(progress, [0, 1], [a.value, b.value]);
}
