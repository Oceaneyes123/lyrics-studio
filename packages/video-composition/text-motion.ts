import type {TextMotion} from '../project-model/text';
import {animatedValue} from './animation';
import type {Animation, AnimationProperty} from '../project-model/animation';

function tween(property: AnimationProperty, from: number, to: number, at: number, duration: number, easing: NonNullable<TextMotion>['entrance']['easing']) {
  const animation: Animation = {originMs: 0, curves: {[property]: [{timeMs: 0, value: from, easing}, {timeMs: duration, value: to, easing: 'linear'}]}};
  return animatedValue(animation, property, at, from);
}
export function textEnvelope(motion: TextMotion | undefined, at: number, duration: number) {
  let opacity = 1, scale = 1, offsetY = 0;
  if (!motion) return {opacity, scale, offsetY};
  for (const [enter, transition] of [[true, motion.entrance], [false, motion.exit]] as const) {
    const length = Math.min(duration, transition.durationMs); if (!length) continue;
    const elapsed = enter ? at : at - duration + length;
    opacity *= tween('opacity', enter ? 0 : 1, enter ? 1 : 0, elapsed, length, transition.easing);
    scale *= tween('scale', enter ? transition.scale : 1, enter ? 1 : transition.scale, elapsed, length, transition.easing);
    offsetY += tween('y', enter ? transition.offsetY : 0, enter ? 0 : transition.offsetY, elapsed, length, transition.easing);
  }
  return {opacity, scale, offsetY};
}
export function wordEmphasis(motion: TextMotion | undefined, at: number, start: number, end: number) {
  if (!motion || at < start || at >= end) return {scale: 1, offsetY: 0};
  const midpoint = (start + end) / 2, rising = at < midpoint;
  const elapsed = rising ? at - start : at - midpoint, length = (end - start) / 2;
  return {scale: tween('scale', rising ? 1 : motion.emphasis.scale, rising ? motion.emphasis.scale : 1, elapsed, length, 'ease-out'),
    offsetY: tween('y', rising ? 0 : motion.emphasis.offsetY, rising ? motion.emphasis.offsetY : 0, elapsed, length, 'ease-out')};
}
