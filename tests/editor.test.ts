import {describe, expect, it, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {newProject, parseProject, lyricLines, clipSchema} from '../packages/project-model/model';
import {changeProject, moveLine, splitLine, timeLine, mergeAlignment, splitMedia} from '../packages/editor-core/commands';
import {api, useEditor} from '../apps/web/store';
import {visualClips} from '../packages/editor-core/timeline-commands';

function fixture() {
  const project = newProject(randomUUID());
  project.lines = [{id: 'line-1', text: 'Sing again', status: 'manual', startMs: 1000, durationMs: 2000,
    words: [{text: 'Sing ', startMs: 0, endMs: 1000}, {text: 'again', startMs: 1000, endMs: 2000}]}];
  return project;
}
describe('Editor invariants and history', () => {
  it('refreshes an expired local capability once without losing the save body', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({token: 'old'})))
      .mockResolvedValueOnce(new Response('{}', {status: 403}))
      .mockResolvedValueOnce(new Response(JSON.stringify({token: 'new'})))
      .mockResolvedValueOnce(new Response(JSON.stringify({saved: true})));
    vi.stubGlobal('fetch', fetch);
    try {
      expect(await api('/projects/test', {method: 'PUT', body: '{"name":"Keep edits"}'})).toEqual({saved: true});
      expect(fetch.mock.calls[3][1].body).toBe('{"name":"Keep edits"}');
      expect(fetch.mock.calls[3][1].headers.get('x-local-token')).toBe('new');
      expect(useEditor.getState().token).toBe('new');
    } finally {vi.unstubAllGlobals();}
  });
  it('moves a lyric without changing word offsets', () => {
    const source = fixture(), next = changeProject(source, d => moveLine(d.lines[0], 5000));
    expect(next.lines[0].words).toEqual(source.lines[0].words);
    expect(source.lines[0].startMs).toBe(1000);
  });
  it('trims without scaling word times or losing original text', () => {
    const p = changeProject(fixture(), d => timeLine(d.lines[0], 2000, 3000));
    expect(p.lines[0].text).toBe('Sing again'); expect(p.lines[0].words).toEqual([]);
  });
  it('splits between words and rebases the second fragment', () => {
    const p = splitLine(fixture(), 'line-1', 2000, 'fragment');
    expect(p.lines.map(l => l.text)).toEqual(['Sing ', 'again']);
    expect(p.lines[1].words[0]).toEqual({text: 'again', startMs: 0, endMs: 1000});
    expect(p.lines.every(l => l.sourceId === 'line-1')).toBe(true);
  });
  it('rejects splitting through a word', () => expect(() => splitLine(fixture(), 'line-1', 1500, 'fragment')).toThrow('inside a sung word'));
  it('rejects overlapping lyrics, bad word times, and missing media', () => {
    expect(() => changeProject(fixture(), d => d.lines.push({...d.lines[0], id: 'other'}))).toThrow();
    expect(() => changeProject(fixture(), d => {d.lines[0].words[1].startMs = 900;})).toThrow();
    expect(() => changeProject(fixture(), d => d.audioClips.push(clipSchema.parse({id: randomUUID(), assetId: randomUUID(), startMs: 0, durationMs: 1000, sourceInMs: 0})))).toThrow('asset');
  });
  it('keeps repeated source lines and excludes headings from sung clips', () => {
    const lines = lyricLines('[Chorus]\nSing again\n\n[Chorus]\nSing again');
    expect(lines.map(l => l.id)).toEqual(['line-2', 'line-5']); expect(lines.every(l => l.startMs === null)).toBe(true);
  });
  it('undo/redo keeps the current disk revision and resets redo after a new edit', () => {
    const store = useEditor.getState(); store.open(fixture()); store.edit(d => {d.name = 'Edited';});
    store.saved({...useEditor.getState().project!, revision: 4}, useEditor.getState().version);
    store.undo(); expect(useEditor.getState().project?.revision).toBe(4); expect(useEditor.getState().project?.name).toBe('Untitled lyric video');
    store.redo(); expect(useEditor.getState().project?.name).toBe('Edited');
    store.undo(); store.edit(d => {d.name = 'Different';}); expect(useEditor.getState().future).toEqual([]);
  });
  it('late save acknowledgement preserves newer edits', () => {
    const store = useEditor.getState(); store.open(fixture()); store.edit(d => {d.name = 'First';});
    const snapshot = useEditor.getState(); store.edit(d => {d.name = 'Second';});
    store.saved({...snapshot.project!, revision: 1}, snapshot.version);
    expect(useEditor.getState().dirty).toBe(true); expect(useEditor.getState().project?.name).toBe('Second');
    expect(useEditor.getState().project?.revision).toBe(1);
  });
  it('a save completing after project switch cannot change the new project revision', () => {
    const store = useEditor.getState(), old = fixture(); store.open(old);
    const version = useEditor.getState().version, next = fixture(); store.open(next);
    store.saved({...old, revision: 9}, version);
    expect(useEditor.getState().project?.id).toBe(next.id); expect(useEditor.getState().project?.revision).toBe(0);
  });
  it('preserves manually split source lines when applying new alignment', () => {
    const p = splitLine(fixture(), 'line-1', 2000, 'fragment');
    const assetId = randomUUID(); p.sourceLyrics = 'Sing again';
    p.assets = [{id: assetId, name: 'song.wav', file: `${assetId}.wav`, kind: 'audio', durationMs: p.durationMs, width: 0, height: 0, hash: 'a'.repeat(64)}];
    p.audioClips = [clipSchema.parse({id: randomUUID(), assetId, startMs: 0, sourceInMs: 0, durationMs: p.durationMs})];
    const result = {sourceLyrics: p.sourceLyrics, audioHash: 'a'.repeat(64), lines: fixture().lines};
    expect(mergeAlignment(p, result).lines).toEqual(p.lines);
    expect(mergeAlignment(p, result, true).lines).toEqual(result.lines);
    p.lines[0].status = 'review'; p.lines[0].style = {...p.style, color: '#ff0000'};
    expect(mergeAlignment(p, result, true).lines[0].style?.color).toBe('#ff0000');
    p.audioClips[0].sourceInMs = 1000;
    expect(() => mergeAlignment(p, result)).toThrow('changed during alignment');
  });
  it('splits media non-destructively and advances the right source offset', () => {
    const p = fixture(), assetId = randomUUID(), clipId = randomUUID();
    p.assets = [{id: assetId, name: 'song.wav', file: `${assetId}.wav`, kind: 'audio', durationMs: 30000, width: 0, height: 0, hash: 'c'.repeat(64)}];
    p.audioClips = [clipSchema.parse({id: clipId, assetId, startMs: 1000, durationMs: 4000, sourceInMs: 2000})];
    const next = splitMedia(p, 'audio', clipId, 3000, randomUUID());
    expect(next.audioClips.map(c => [c.startMs, c.durationMs, c.sourceInMs])).toEqual([[1000, 2000, 2000], [3000, 2000, 4000]]);
    expect(p.audioClips).toHaveLength(1);
  });
  it('rejects three overlapping backgrounds on one layer even when an earlier short clip ended', () => {
    const p = fixture(), assetId = randomUUID();
    p.assets = [{id: assetId, name: 'image.png', file: `${assetId}.png`, kind: 'image', durationMs: 0, width: 32, height: 32, hash: 'b'.repeat(64)}];
    p.backgrounds = [[0, 20000], [1000, 1000], [3000, 10000], [4000, 1000]].map(([startMs, durationMs]) =>
      clipSchema.parse({id: randomUUID(), assetId, startMs, durationMs, sourceInMs: 0}));
    expect(() => parseProject(p)).toThrow('Only two backgrounds');
  });
  it('allows simultaneous visual layers and preserves their order, opacity, and split settings', () => {
    const p = fixture(), assetId = randomUUID();
    p.assets = [{id: assetId, name: 'image.png', file: `${assetId}.png`, kind: 'image', durationMs: 0, width: 32, height: 32, hash: 'b'.repeat(64)}];
    p.backgrounds = [2, 0, 1].map(layer => clipSchema.parse({id: randomUUID(), assetId, layer, opacity: .5,
      startMs: 1000, durationMs: 4000, sourceInMs: 0}));
    expect(parseProject(p).backgrounds.map(c => c.layer)).toEqual([2, 0, 1]);
    const split = splitMedia(p, 'video', p.backgrounds[0].id, 3000, randomUUID());
    expect(split.backgrounds.filter(c => c.layer === 2)).toHaveLength(2);
    expect(split.backgrounds.every(c => c.opacity === .5)).toBe(true);
    const store = useEditor.getState(); store.open(p);
    store.edit(d => {visualClips(d)[0].trackId = 'track:visual:1'; visualClips(d)[0].startMs = 2000;});
    store.undo(); expect(visualClips(useEditor.getState().project!)[0].trackId).toBe('track:visual:2');
    store.redo(); expect(visualClips(useEditor.getState().project!).find(c => c.id === p.backgrounds[0].id)?.startMs).toBe(2000);
    expect(() => changeProject(p, d => {d.backgrounds[0].opacity = 1.01;})).toThrow();
    expect(() => changeProject(p, d => {d.backgrounds[0].layer = -.5;})).toThrow();
  });
  it('loads legacy clips as fully opaque Layer 1 without rewriting source data', () => {
    const id = randomUUID();
    const legacy = {id, assetId: randomUUID(), startMs: 0, durationMs: 1000, sourceInMs: 0};
    expect(clipSchema.parse(legacy)).toMatchObject({layer: 0, opacity: 1});
    expect(legacy).not.toHaveProperty('layer');
  });
  it('rejects unknown schema versions and invalid dimensions', () => {
    expect(() => parseProject({...fixture(), schemaVersion: 99})).toThrow();
    expect(() => parseProject({...fixture(), width: 721})).toThrow();
  });
});
