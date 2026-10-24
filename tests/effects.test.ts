import {expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import fixtures from './fixtures/v1-projects.json';
import {migrateTimeline, parseTimeline} from '../packages/project-model/timeline';
import {effectsSchema, transitionSchema} from '../packages/project-model/effects';
import {changeTimeline, copyClips, deleteClips, moveClips, pasteClips, visualClips} from '../packages/editor-core/timeline-commands';
import {filterStyle, maskStyle, transitionStyle} from '../packages/video-composition/effects';

function fixture() {
  const p = migrateTimeline(fixtures[2]), a = visualClips(p)[0];
  p.clips = p.clips.filter(c => c.kind !== 'visual');
  Object.assign(a, {startMs: 0, durationMs: 3000, sourceInMs: 0});
  const b = {...structuredClone(a), id: randomUUID(), startMs: 2000}; p.clips.push(a, b);
  p.transitions.push(transitionSchema.parse({id: randomUUID(), fromClipId: a.id, toClipId: b.id, type: 'dissolve', durationMs: 1000}));
  return {p: parseTimeline(p), a, b};
}
it('validates real pair overlap and blocks orphaning atomically', () => {
  const {p, a, b} = fixture();
  expect(() => moveClips(p, [b.id], 1500)).toThrow('Transition');
  expect(() => deleteClips(p, [a.id])).toThrow('transition');
  expect(() => changeTimeline(p, d => {d.transitions[0].durationMs = 1001;})).toThrow('overlap');
  expect(p.clips.find(c => c.id === b.id)!.startMs).toBe(2000);
});
it('copies partner references with new identities and protects locked transition settings', () => {
  const {p, a, b} = fixture(), next = pasteClips(p, copyClips(p, [a.id, b.id]), 10000);
  expect(next.transitions).toHaveLength(2); expect(next.transitions[1].fromClipId).not.toBe(a.id);
  expect(next.clips.some(c => c.id === next.transitions[1].toClipId)).toBe(true);
  p.tracks.find(t => t.id === a.trackId)!.locked = true;
  expect(() => changeTimeline(p, d => {d.transitions[0].type = 'slide';})).toThrow('Unlock');
});
it('samples every transition deterministically with neutral pre-roll and bounded ending', () => {
  const {p} = fixture(), transition = p.transitions[0];
  for (const type of ['dissolve', 'slide', 'zoom', 'wipe', 'blur'] as const) {
    const t = {...transition, type};
    expect(transitionStyle(t, -1, false).opacity).toBe(1);
    expect(transitionStyle(t, 1000, true).opacity).toBe(1);
    expect(transitionStyle(t, 1000, false).opacity).toBe(0);
    expect(transitionStyle(t, 500, true)).toEqual(transitionStyle(t, 500, true));
  }
  expect(transitionStyle({...transition, type: 'wipe'}, 500, true).clipPath).toContain('50%');
});
it('bounds filter cost and keeps masks separate from media transforms', () => {
  expect(() => effectsSchema.parse({blur: 51})).toThrow();
  expect(() => effectsSchema.parse({mask: {shape: 'rectangle', x: 80, width: 30}})).toThrow('canvas');
  const effects = effectsSchema.parse({brightness: .5, blur: 10, mask: {shape: 'ellipse', x: 10, y: 20, width: 80, height: 60}});
  expect(filterStyle(effects)).toContain('brightness(0.5)'); expect(maskStyle(effects.mask)).toBe('ellipse(40% 30% at 50% 50%)');
});
