import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import fixtures from './fixtures/v1-projects.json';
import {parseProject} from '../packages/project-model/model';
import {legacyPlacement, migrateTimeline, parseTimeline, type LyricClip} from '../packages/project-model/timeline';

describe('V1 timeline migration baseline', () => {
  for (const fixture of fixtures) it(`preserves ${fixture.name} without mutating input`, () => {
    const before = JSON.stringify(fixture), old = parseProject(fixture);
    const next = migrateTimeline(fixture);
    expect(JSON.stringify(fixture)).toBe(before);
    expect(migrateTimeline(fixture)).toEqual(next);
    expect(migrateTimeline(next)).toEqual(next);
    expect(next.assets).toEqual(old.assets);
    expect(next.lyricSource.text).toBe(old.sourceLyrics);
    expect(next.revision).toBe(old.revision);
    expect(next.style).toEqual(old.style);
    expect(next.clips.length).toBe(old.audioClips.length + old.backgrounds.length + old.lines.filter(line => line.startMs !== null).length);
    for (const line of old.lines) {
      const actual = legacyPlacement(next, line.id)!;
      for (const key of ['id', 'text', 'startMs', 'durationMs', 'words', 'status', 'style', 'sourceId', 'reason'] as const)
        expect(actual[key], key).toEqual(line[key]);
    }
    for (const clip of [...old.audioClips, ...old.backgrounds]) {
      const migrated = next.clips.find(item => item.id === clip.id)!;
      const {layer: _layer, ...expected} = clip;
      expect(migrated).toMatchObject(expected);
      if (old.backgrounds.includes(clip)) expect(migrated.trackId).toBe(`track:visual:${clip.layer}`);
    }
    expect(next.tracks.every(track => !track.locked && !track.muted && track.visible)).toBe(true);
  });

  it('resolves old media/lyric ID collisions without changing source identity', () => {
    const old = parseProject(fixtures[2]); old.lines[0].id = old.audioClips[0].id;
    const next = migrateTimeline(old), lyric = next.clips.find(clip => clip.kind === 'lyric') as LyricClip;
    expect(lyric.id).toBe(`lyric:${old.audioClips[0].id}`);
    expect(lyric.sourceLineId).toBe(old.lines[0].id);
    expect(new Set(next.clips.map(clip => clip.id)).size).toBe(next.clips.length);
  });
  it('rejects missing/incompatible tracks and bad media references', () => {
    const source = migrateTimeline(fixtures[2]);
    for (const change of [
      (p: typeof source) => {p.clips[0].trackId = 'missing';},
      (p: typeof source) => {p.clips[0].trackId = 'track:lyrics';},
      (p: typeof source) => {if (p.clips[0].kind !== 'lyric') p.clips[0].assetId = '00000000-0000-4000-8000-000000000099';},
    ]) {const next = structuredClone(source); change(next); expect(() => parseTimeline(next)).toThrow();}
  });
  it('validates lyric overlap per track, allowing independent simultaneous lyric tracks', () => {
    const next = migrateTimeline(fixtures[1]);
    const first = next.clips[0];
    next.clips.push({...first, id: 'overlap'});
    expect(() => parseTimeline(next)).toThrow('same track');
    next.tracks.push({...next.tracks.at(-1)!, id: 'second-lyrics'});
    next.clips.at(-1)!.trackId = 'second-lyrics';
    expect(parseTimeline(next).clips).toHaveLength(3);
  });
  it('rejects malformed words, source references and future schemas', () => {
    const next = migrateTimeline(fixtures[2]);
    const lyric = next.clips.find(clip => clip.kind === 'lyric') as LyricClip;
    lyric.words[0].endMs = 10000; expect(() => parseTimeline(next)).toThrow('word');
    lyric.words = []; lyric.sourceLineId = 'absent'; expect(() => parseTimeline(next)).toThrow('source');
    expect(() => migrateTimeline({...next, schemaVersion: 999})).toThrow();
  });
  it('pins the normalized JSON fixture content across Windows line endings', () => {
    const bytes = readFileSync(new URL('./fixtures/v1-projects.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('0135d9cbacbdae1bae218ae0eee644982a0b36ad472b990cf54aa1ee09fa18e7');
  });
});
