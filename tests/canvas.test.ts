import {expect, it} from 'vitest';
import {newProject} from '../packages/project-model/model';
import {migrateTimeline, parseTimeline, timelineClipSchema} from '../packages/project-model/timeline';
import {transformSchema} from '../packages/project-model/canvas';
import {objectTransform, remapCanvas, transformStyle, visibleObjects} from '../packages/editor-core/canvas-transforms';
import {changeTimeline, copyClips, pasteClips, splitClip, updateLine} from '../packages/editor-core/timeline-commands';
import {useEditor} from '../apps/web/store';
import fixtures from './fixtures/v1-projects.json';

const fixture = () => {
  const p = migrateTimeline(newProject('00000000-0000-4000-8000-000000000001'));
  p.clips.push(timelineClipSchema.parse({id: 'title', kind: 'text', text: 'Canvas title',
    trackId: 'track:visual:0', startMs: 0, durationMs: 3000, style: p.style}));
  return p;
};
it('migrates V3 without changing legacy transforms, styles, IDs or timings', () => {
  const current = migrateTimeline(fixtures[2]), old = {...current, schemaVersion: 3}, bytes = JSON.stringify(old);
  const next = migrateTimeline(old); expect(next).toEqual({...current, schemaVersion: 4});
  expect(next.clips.every(c => !c.transform)).toBe(true); expect(JSON.stringify(old)).toBe(bytes);
});
it('validates finite transforms and text track compatibility', () => {
  const p = fixture(); expect(parseTimeline(p).clips).toHaveLength(1);
  for (const values of [{width: 0}, {x: NaN}, {opacity: 2}, {scaleX: 0}, {anchorX: 2}]) {
    p.clips[0].transform = {...objectTransform(p, p.clips[0] as never), ...values};
    expect(() => parseTimeline(p)).toThrow();
  }
  delete p.clips[0].transform; p.clips[0].trackId = 'track:audio'; expect(() => parseTimeline(p)).toThrow('incompatible');
});
it('allows multiple text overlays without weakening two-media crossfade validation', () => {
  const p = fixture(); p.clips.push(...[1, 2, 3].map(i => ({...p.clips[0], id: `text${i}`})));
  expect(parseTimeline(p).clips).toHaveLength(4);
  const media = migrateTimeline(fixtures[2]); const original = media.clips.find(c => c.kind === 'visual')!;
  media.clips.push({...original, id: 'second-media'}, {...original, id: 'third-media'});
  expect(() => parseTimeline(media)).toThrow('two visuals');
});
it('remaps saved pixel boxes independently on each canvas axis', () => {
  const p = fixture(); p.clips[0].transform = transformSchema.parse({x: 100, y: 60, width: 400, height: 120, rotation: 37});
  remapCanvas(p, p.width * 2, p.height * 3);
  expect(p.clips[0].transform).toMatchObject({x: 200, y: 180, width: 800, height: 360, rotation: 37});
});
it('keeps lyric source, karaoke timing and transforms through ordinary line edits', () => {
  const p = migrateTimeline(fixtures[2]), clip = p.clips.find(c => c.kind === 'lyric')!;
  if (clip.kind !== 'lyric') throw new Error('Missing fixture');
  const timing = structuredClone(clip.words), source = structuredClone(p.lyricSource);
  const next = changeTimeline(p, d => {d.clips.find(c => c.id === clip.id)!.transform = transformSchema.parse({x: 10, y: 20, width: 400, height: 80});});
  expect(next.lyricSource).toEqual(source); expect(next.clips.find(c => c.id === clip.id)).toMatchObject({words: timing});
  updateLine(next, clip.sourceLineId, l => {l.style = {...next.style, color: '#ffffff'};});
  expect(next.clips.find(c => c.id === clip.id)?.transform?.x).toBe(10);
});
it('round-trips independent text through copy, split, undo and redo', () => {
  const p = fixture(); p.clips[0].transform = transformSchema.parse({x: 10, y: 10, width: 300, height: 100});
  const pasted = pasteClips(p, copyClips(p, ['title']), 4000);
  expect(pasted.clips[1].transform).toEqual(p.clips[0].transform);
  const split = splitClip(pasted, 'title', 1000); expect(split.clips.at(-1)).toMatchObject({kind: 'text', startMs: 1000, durationMs: 2000});
  useEditor.getState().open(p); useEditor.getState().commit(split); expect(useEditor.getState().past).toHaveLength(1);
  useEditor.getState().undo(); expect(useEditor.getState().project).toEqual(p);
  useEditor.getState().redo(); expect(useEditor.getState().project).toEqual(split);
});
it('enforces object locks in shared commands and permits unlocking', () => {
  const p = fixture(); p.clips[0].locked = true;
  expect(() => changeTimeline(p, d => {d.clips[0].startMs = 100;})).toThrow('Unlock');
  expect(() => splitClip(p, 'title', 1000)).toThrow('Unlock');
  expect(changeTimeline(p, d => {d.clips[0].locked = false;}).clips[0].locked).toBe(false);
});
it('matches frame boundaries, hidden state and ordered visible objects', () => {
  const p = fixture(); p.clips.push({...p.clips[0], id: 'hidden', hidden: true});
  expect(visibleObjects(p, 0).map(c => c.id)).toEqual(['title']); expect(visibleObjects(p, 90)).toEqual([]);
  p.tracks.find(t => t.id === 'track:visual:0')!.visible = false; expect(visibleObjects(p, 0)).toEqual([]);
});
it('evaluates anchors, flips and nonuniform scale once in shared placement', () => {
  const t = transformSchema.parse({x: 10, y: 20, width: 300, height: 100, rotation: 45, anchorX: 0, scaleX: 2, flipY: true});
  expect(transformStyle(t)).toMatchObject({left: 10, top: 20, width: 300, height: 100, transformOrigin: '0% 50%', transform: 'rotate(45deg) scale(2, -1)'});
});
