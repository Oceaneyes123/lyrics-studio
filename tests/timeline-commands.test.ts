import {expect, it} from 'vitest';
import fixtures from './fixtures/v1-projects.json';
import {migrateTimeline} from '../packages/project-model/timeline';
import {changeTimeline, copyClips, deleteClips, groupClips, moveClips, pasteClips, selectedClips, splitClip, updateLine, lines} from '../packages/editor-core/timeline-commands';

const fixture = () => migrateTimeline(fixtures[2]);
it('atomically rejects editing any locked member of a multi-track group', () => {
  let p = fixture(); const ids = p.clips.slice(0, 2).map(c => c.id);
  p = groupClips(p, ids, 'group'); p.tracks[0].locked = true;
  const before = structuredClone(p);
  expect(selectedClips(p, [ids[1]])).toHaveLength(2);
  expect(() => moveClips(p, [ids[1]], 1000)).toThrow('Unlock');
  expect(p).toEqual(before); expect(() => deleteClips(p, [ids[1]])).toThrow('Unlock');
});
it('allows changing lock/mute/visibility but rejects direct locked track deletion or reorder', () => {
  const p = fixture(); p.tracks[0].locked = true;
  expect(changeTimeline(p, d => {d.tracks[0].muted = true;}).tracks[0].muted).toBe(true);
  expect(() => changeTimeline(p, d => {d.tracks.reverse();})).toThrow('Unlock');
  expect(() => changeTimeline(p, d => {d.tracks.shift();})).toThrow('Unlock');
});
it('moves a group with one delta and rejects an invalid destination without partial changes', () => {
  let p = fixture(); const ids = p.clips.slice(0, 2).map(c => c.id); p = groupClips(p, ids, 'group');
  const next = moveClips(p, [ids[0]], 500);
  expect(next.clips.slice(0, 2).map(c => c.startMs)).toEqual(p.clips.slice(0, 2).map(c => c.startMs + 500));
  expect(() => moveClips(p, ids, 0, 'track:lyrics', p.clips[0].trackId)).toThrow('incompatible');
});
it('ripple closes selected track intervals once and leaves audio/other tracks fixed', () => {
  const p = fixture(), first = p.clips[1];
  p.clips.push({...first, id: 'later', startMs: 20000, durationMs: 5000});
  const next = deleteClips(p, [first.id], true);
  expect(next.clips.find(c => c.id === 'later')!.startMs).toBe(5000);
  expect(next.clips.find(c => c.id === p.clips[0].id)!.startMs).toBe(1000);
  expect(next.durationMs).toBe(p.durationMs);
});
it('rejects ripple that intersects retained content or separates a remaining group', () => {
  const p = fixture(), first = p.clips[1];
  p.clips.push({...first, id: 'overlap', startMs: 10000, durationMs: 10000});
  expect(() => deleteClips(p, [first.id], true)).toThrow('retained');
  p.clips.at(-1)!.startMs = 20000; p.clips.at(-1)!.durationMs = 5000; p.clips.at(-1)!.groupId = 'remaining';
  p.clips[0].groupId = 'remaining';
  expect(() => deleteClips(p, [first.id], true)).toThrow('differently');
});
it('copies/pastes with fresh group/clip IDs and immutable shared media references', () => {
  let p = fixture(); const id = p.clips[2].id;
  p = groupClips(p, [id], 'old-group'); const clipboard = copyClips(p, [id]);
  const pasted = pasteClips(p, clipboard, 15000), clip = pasted.clips.at(-1)!;
  expect(clip.id).not.toBe(id); expect(clip.groupId).not.toBe('old-group'); expect(clip.startMs).toBe(15000);
  expect(pasted.assets).toEqual(p.assets); expect(p.clips).toHaveLength(5);
  expect(() => pasteClips({...p, id: '00000000-0000-4000-8000-000000000099'}, clipboard, 0)).toThrow('another project');
});
it('copies lyric occurrences independently and retains style when deleting a placement', () => {
  const p = fixture(), original = p.clips.find(c => c.kind === 'lyric')!;
  const pasted = pasteClips(p, copyClips(p, [original.id]), 10000);
  expect(pasted.lyricSource.lines).toHaveLength(p.lyricSource.lines.length + 1);
  const clip = pasted.clips.at(-1)!;
  expect(clip.kind === 'lyric' && clip.sourceLineId !== (original.kind === 'lyric' ? original.sourceLineId : '')).toBe(true);
  const deleted = deleteClips(p, [original.id]);
  expect(lines(deleted)[0].style).toEqual(original.kind === 'lyric' ? original.style : undefined);
  expect(lines(deleted)[0].startMs).toBeNull();
});
it('places untimed source text without duplicate timing arrays and splits source offsets non-destructively', () => {
  const p = migrateTimeline(fixtures[1]);
  const placed = changeTimeline(p, d => updateLine(d, 'line-5', l => {l.startMs = 10000; l.durationMs = 1000; l.status = 'manual';}));
  expect(lines(placed).at(-1)!.startMs).toBe(10000);
  expect(lines(placed).at(-1)!.style?.fontSize).toBe(64);
  expect('lines' in placed).toBe(false); expect('backgrounds' in placed).toBe(false);
  const media = fixture(), clip = media.clips[0]; const split = splitClip(media, clip.id, 3000);
  const right = split.clips.at(-1)!;
  expect(right.kind === 'audio' && right.sourceInMs).toBe(4000);
  expect(media.clips[0].durationMs).toBe(20000);
});
