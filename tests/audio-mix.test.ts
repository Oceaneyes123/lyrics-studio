import {expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import fixtures from './fixtures/v1-projects.json';
import {migrateTimeline, parseTimeline, timelineClipSchema, trackSchema} from '../packages/project-model/timeline';
import {audioGain} from '../packages/video-composition/audio';
import {alignmentReference, applyAlignment, audioClips, changeTimeline, deleteClips, lines, setLyrics, splitClip, updateLine} from '../packages/editor-core/timeline-commands';

function fixture() {
  const p = migrateTimeline(fixtures[2]); p.durationMs = 40000;
  const first = audioClips(p)[0]; first.startMs = 0; first.sourceInMs = 0; first.durationMs = 30000;
  const track = trackSchema.parse({id: 'music', kind: 'audio', name: 'Music'}); p.tracks.push(track);
  p.clips.push(timelineClipSchema.parse({...first, id: randomUUID(), trackId: track.id}));
  return parseTimeline(p);
}
it('multiplies independent dB controls once and respects frame-rounded clip boundaries', () => {
  const p = fixture(), clip = audioClips(p)[0], track = p.tracks.find(t => t.id === clip.trackId)!;
  p.masterGainDb = -6; track.gainDb = -6; clip.gainDb = 6;
  expect(audioGain(p, clip, 1000)).toBeCloseTo(Math.pow(10, -6 / 20));
  clip.startMs = 167; clip.durationMs = 1000;
  expect(audioGain(p, clip, 5 * 1000 / 30)).toBeGreaterThan(0);
  expect(audioGain(p, clip, 35 * 1000 / 30)).toBe(0);
});
it('mutes exactly, applies track solo, and ignores solo on non-audio lyric tracks', () => {
  const p = fixture(), [a, b] = audioClips(p);
  expect(audioGain(p, a, 1000)).toBe(1); p.tracks.find(t => t.id === b.trackId)!.solo = true;
  expect(audioGain(p, a, 1000)).toBe(0); expect(audioGain(p, b, 1000)).toBe(1);
  b.muted = true; expect(audioGain(p, b, 1000)).toBe(0);
  p.tracks.find(t => t.id === b.trackId)!.solo = false; p.tracks.find(t => t.kind === 'lyrics')!.solo = true;
  expect(audioGain(p, a, 1000)).toBe(1);
});
it('keeps clip fades independent of source trims and uses the lower overlapping envelope', () => {
  const p = fixture(), clip = audioClips(p)[0];
  clip.startMs = 1000; clip.sourceInMs = 2000; clip.durationMs = 2000; clip.fadeInMs = 1500; clip.fadeOutMs = 1500;
  expect(audioGain(p, clip, 1000)).toBe(0);
  expect(audioGain(p, clip, 2000)).toBeCloseTo(2 / 3);
  expect(audioGain(p, clip, 2500)).toBeCloseTo(1 / 3);
});
it('video audio is opt-in and visibility is independent of audio mute', () => {
  const p = fixture(), clip = p.clips.find(c => c.kind === 'visual' && p.assets.find(a => a.id === c.assetId)?.kind === 'video')!;
  expect(audioGain(p, clip, 3000)).toBe(0);
  if (clip.kind !== 'visual') throw new Error('Expected video'); clip.audioEnabled = true;
  p.tracks.find(t => t.id === clip.trackId)!.visible = false;
  expect(audioGain(p, clip, 3000)).toBe(1);
  p.tracks.find(t => t.id === clip.trackId)!.muted = true; expect(audioGain(p, clip, 3000)).toBe(0);
});
it('binds alignment to a specific song while allowing music/SFX and mix edits', () => {
  const p = fixture(); setLyrics(p, 'Sing again');
  const {clip, asset, mapping} = alignmentReference(p);
  const result = {sourceLyrics: p.lyricSource.text, audioHash: asset.hash, reference: mapping,
    lines: [{id: 'line-1', text: 'Sing again', status: 'review' as const, startMs: 1000, durationMs: 2000, words: []}]};
  p.masterGainDb = -3; p.tracks[0].muted = true;
  expect(lines(applyAlignment(p, result))[0].startMs).toBe(1000);
  clip.startMs = 1000;
  expect(() => applyAlignment(p, result)).toThrow('changed');
  const shifted = {...result, reference: alignmentReference(p).mapping};
  expect(lines(applyAlignment(p, shifted))[0].startMs).toBe(2000);
  p.alignmentSourceClipId = audioClips(p)[1].id;
  expect(() => applyAlignment(p, shifted)).toThrow('changed');
});
it('deleting the reference keeps lyrics and never silently selects the music bed', () => {
  const p = fixture(); const next = deleteClips(p, [p.alignmentSourceClipId!]);
  expect(next.alignmentSourceClipId).toBeNull(); expect(next.lyricSource).toEqual(p.lyricSource);
  expect(() => alignmentReference(next)).toThrow('Select song');
});
it('explicit full replacement removes manual fragments while ordinary reruns preserve them', () => {
  let p = fixture(); setLyrics(p, 'Sing again');
  updateLine(p, 'line-1', l => {l.status = 'manual'; l.startMs = 1000; l.durationMs = 2000;
    l.words = [{text: 'Sing ', startMs: 0, endMs: 1000}, {text: 'again', startMs: 1000, endMs: 2000}];});
  const clip = p.clips.find(c => c.kind === 'lyric')!; p = splitClip(p, clip.id, 2000);
  const {asset, mapping} = alignmentReference(p);
  const result = {sourceLyrics: 'Sing again', audioHash: asset.hash, reference: mapping,
    lines: [{id: 'line-1', text: 'Sing again', status: 'review' as const, startMs: 5000, durationMs: 2000, words: []}]};
  expect(lines(applyAlignment(p, result))).toHaveLength(2);
  expect(lines(applyAlignment(p, result, true))).toHaveLength(1);
  expect(lines(applyAlignment(p, result, true))[0].startMs).toBe(5000);
});
it('adding tracks around a locked track preserves relative order and is allowed', () => {
  const p = fixture(); p.tracks.find(t => t.kind === 'lyrics')!.locked = true;
  expect(changeTimeline(p, d => d.tracks.unshift(trackSchema.parse({id: 'extra', kind: 'audio', name: 'Extra'}))).tracks).toHaveLength(p.tracks.length + 1);
});
