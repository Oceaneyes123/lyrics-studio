import {expect, it} from 'vitest';
import {animationSchema} from '../packages/project-model/animation';
import {animatedValue} from '../packages/video-composition/animation';
import fixtures from './fixtures/v1-projects.json';
import {migrateTimeline} from '../packages/project-model/timeline';
import {moveClips, splitClip, visualClips} from '../packages/editor-core/timeline-commands';

it('holds endpoints and deterministically interpolates eased segments', () => {
  const animation = animationSchema.parse({curves: {x: [{timeMs: 100, value: 0, easing: 'ease-in'}, {timeMs: 1100, value: 100}]}});
  expect(animatedValue(animation, 'x', 0, 9)).toBe(0);
  expect(animatedValue(animation, 'x', 600, 9)).toBe(25);
  expect(animatedValue(animation, 'x', 5000, 9)).toBe(100);
  expect(animatedValue(animation, 'opacity', 500, .3)).toBe(.3);
  expect(animatedValue({...animation, originMs: 500}, 'x', 100, 9)).toBe(25);
});
it('retains a curve through split, movement, and frame-rate sampling', () => {
  const project = migrateTimeline(fixtures[2]), clip = visualClips(project)[0];
  clip.animation = animationSchema.parse({curves: {x: [{timeMs: 0, value: 0, easing: 'ease-in-out'}, {timeMs: 4000, value: 100}]}});
  const original = structuredClone(clip), split = splitClip(project, clip.id, clip.startMs + 1000);
  const right = visualClips(split).find(c => c.id !== clip.id && c.assetId === clip.assetId && c.startMs === clip.startMs + 1000)!;
  for (const fps of [24, 25, 30]) for (const frame of [0, 5, 15]) {
    const at = frame * 1000 / fps;
    expect(animatedValue(right.animation, 'x', at, 0)).toBeCloseTo(animatedValue(original.animation, 'x', at + 1000, 0));
  }
  const moved = moveClips(split, [right.id], 100);
  expect(moved.clips.find(c => c.id === right.id)!.animation).toEqual(right.animation);
});
it('steps at the following key for hold easing and rejects invalid curves', () => {
  const animation = animationSchema.parse({curves: {opacity: [{timeMs: 0, value: 0, easing: 'hold'}, {timeMs: 1000, value: 1}]}});
  expect(animatedValue(animation, 'opacity', 999, 9)).toBe(0); expect(animatedValue(animation, 'opacity', 1000, 9)).toBe(1);
  expect(() => animationSchema.parse({curves: {opacity: [{timeMs: 0, value: 2}]}})).toThrow();
  expect(() => animationSchema.parse({curves: {x: [{timeMs: 0, value: 0}, {timeMs: 0, value: 1}]}})).toThrow();
});
it('allows authoring keys in the exposed head after extending a clip to the left', () => {
  const animation = animationSchema.parse({originMs: -1000, curves: {x: [{timeMs: -1000, value: -50}, {timeMs: 0, value: 0}]}});
  expect(animatedValue(animation, 'x', 500, 9)).toBe(-25);
  expect(animatedValue(animation, 'x', 1000, 9)).toBe(0);
});
