import {describe, expect, it} from 'vitest';
import {durationFrames, lineAtFrame, msToFrame, parseProofProject, wordProgress} from '../packages/project-model/proof';

const fixture = () => ({schemaVersion: 1, id: 'test', fps: 30, width: 1280, height: 720,
  durationMs: 10000, audioFile: 'marker.wav', lines: [{id: 'line-1', text: 'Sing again',
    status: 'manual', startMs: 1000, durationMs: 2000,
    words: [{text: 'Sing ', startMs: 0, endMs: 1000}, {text: 'again', startMs: 1000, endMs: 2000}]}]});

describe('M0 timing and validation', () => {
  it.each([24, 25, 30])('uses shared half-open frame boundaries at %i FPS', fps => {
    const p = parseProofProject({...fixture(), fps});
    expect(lineAtFrame(p, fps - 1)).toBeUndefined();
    expect(lineAtFrame(p, fps)?.id).toBe('line-1');
    expect(lineAtFrame(p, fps * 3 - 1)?.id).toBe('line-1');
    expect(lineAtFrame(p, fps * 3)).toBeUndefined();
    expect(durationFrames(p)).toBe(fps * 10);
  });
  it('uses nearest boundary rounding without accumulating frame duration error', () => {
    expect(msToFrame(1017, 30)).toBe(31);
    expect(msToFrame(1999, 30)).toBe(60);
  });
  it('clamps progress before, during and after a word', () => {
    const word = {text: 'Sing', startMs: 100, endMs: 300};
    expect([-1, 100, 200, 300, 500].map(t => wordProgress(word, t))).toEqual([0, 0, .5, 1, 1]);
  });
  it('keeps unmatched lines without inventing timing', () => {
    const p = parseProofProject({...fixture(), lines: [{id: 'untimed', text: 'Missing', status: 'unmatched',
      startMs: null, durationMs: null, words: []}]});
    expect(lineAtFrame(p, 100)).toBeUndefined();
  });
  it.each([
    () => null,
    () => ({...fixture(), schemaVersion: 2}),
    () => ({...fixture(), audioFile: '../private.wav'}),
    () => ({...fixture(), fps: 0}),
    () => ({...fixture(), durationMs: Infinity}),
    () => ({...fixture(), lines: [{...fixture().lines[0], durationMs: 1}]}),
    () => ({...fixture(), lines: [fixture().lines[0], {...fixture().lines[0], id: 'other'}]}),
    () => ({...fixture(), lines: [{...fixture().lines[0], words: [{text: 'Sing again', startMs: 0, endMs: 5000}]}]}),
    () => ({...fixture(), lines: [{...fixture().lines[0], words: [{text: 'Wrong', startMs: 0, endMs: 1000}]}]}),
  ])('rejects unsafe or inconsistent inputs %#', invalid => expect(() => parseProofProject(invalid())).toThrow());
});
