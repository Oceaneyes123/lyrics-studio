import type {VisualEffects, VisualTransition} from '../project-model/effects';
import {animatedValue} from './animation';

export function filterStyle(effects: VisualEffects | undefined) {
  return effects ? `brightness(${effects.brightness}) contrast(${effects.contrast}) saturate(${effects.saturation}) hue-rotate(${effects.hue}deg) blur(${effects.blur}px)` : undefined;
}
export function maskStyle(mask: VisualEffects['mask']) {
  if (!mask) return undefined;
  return mask.shape === 'rectangle' ? `inset(${mask.y}% ${100 - mask.x - mask.width}% ${100 - mask.y - mask.height}% ${mask.x}%)` :
    `ellipse(${mask.width / 2}% ${mask.height / 2}% at ${mask.x + mask.width / 2}% ${mask.y + mask.height / 2}%)`;
}
export function transitionStyle(transition: VisualTransition, atMs: number, entering: boolean) {
  const progress = animatedValue({originMs: 0, curves: {opacity: [{timeMs: 0, value: 0, easing: transition.easing},
    {timeMs: transition.durationMs, value: 1, easing: 'linear'}]}}, 'opacity', atMs, 1);
  if (atMs < 0) return {opacity: 1, transform: '', clipPath: undefined, filter: undefined};
  const sign = transition.direction === 'left' || transition.direction === 'up' ? -1 : 1;
  const axis = transition.direction === 'left' || transition.direction === 'right' ? 'X' : 'Y';
  const remaining = entering ? 1 - progress : progress;
  let opacity = entering ? progress : 1 - progress, transform = '', clipPath: string | undefined, filter: string | undefined;
  if (transition.type === 'slide') {
    opacity = entering ? 1 : progress >= 1 ? 0 : 1;
    transform = `translate${axis}(${(entering ? -sign : sign) * remaining * transition.amount}%)`;
  }
  if (transition.type === 'zoom') transform = `scale(${Math.max(.1, 1 + (entering ? 1 : -1) * remaining * transition.amount / 100)})`;
  if (transition.type === 'blur') filter = `blur(${remaining * transition.amount / 2}px)`;
  if (transition.type === 'wipe') {
    opacity = entering ? 1 : progress >= 1 ? 0 : 1;
    if (entering) {
      const inset = `${(1 - progress) * 100}%`;
      clipPath = transition.direction === 'left' ? `inset(0 0 0 ${inset})` : transition.direction === 'right' ? `inset(0 ${inset} 0 0)` :
        transition.direction === 'up' ? `inset(${inset} 0 0 0)` : `inset(0 0 ${inset} 0)`;
    }
  }
  return {opacity, transform, clipPath, filter};
}
