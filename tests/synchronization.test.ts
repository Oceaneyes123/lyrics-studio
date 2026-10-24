import {expect, it} from 'vitest';
import fixtures from './fixtures/v1-projects.json';
import {migrateTimeline, parseTimeline} from '../packages/project-model/timeline';
import {alignmentReference, applyAlignment, lines, reviseLyrics, setLyrics, updateLine} from '../packages/editor-core/timeline-commands';
import {applyTaps, loopFrames, wordBoundary} from '../packages/editor-core/synchronization';

function fixture() {
  const project = migrateTimeline(fixtures[2]); setLyrics(project, 'Sing again');
  const audio = project.clips.find(c => c.kind === 'audio')!;
  if (audio.kind === 'audio') Object.assign(audio, {startMs: 0, sourceInMs: 0, durationMs: project.assets.find(a => a.id === audio.assetId)!.durationMs});
  const {asset, mapping} = alignmentReference(project);
  const result = {sourceLyrics: 'Sing again', audioHash: asset.hash, reference: mapping,
    lines: [{id: 'line-1', text: 'Sing again', startMs: 1000, durationMs: 2000, status: 'review' as const,
      words: [{text: 'Sing ', startMs: 0, endMs: 700}, {text: 'again', startMs: 1000, endMs: 1800}]}]};
  return {project: applyAlignment(project, result), result};
}
it('retains an edited word field while accepting other updated engine fields', () => {
  const {project, result} = fixture(); const id = lines(project)[0].words[0].id;
  updateLine(project, 'line-1', line => wordBoundary(line, 0, 'endMs', 600));
  result.lines[0].words[1].startMs = 1100;
  const line = lines(applyAlignment(project, result))[0];
  expect(line.words[0]).toMatchObject({id, endMs: 600, manualEnd: true});
  expect(line.words[1].startMs).toBe(1100);
  expect(line.status).toBe('review');
});
it('retains corrections made after a job starts and reports a conflicting rerun', () => {
  const {project, result} = fixture();
  updateLine(project, 'line-1', line => wordBoundary(line, 0, 'endMs', 900));
  result.lines[0].words[1].startMs = 800;
  const line = lines(applyAlignment(project, result))[0];
  expect(line.words[0].endMs).toBe(900); expect(line.reason).toContain('conflicts');
  expect(lines(applyAlignment(project, result, true))[0].words[0].endMs).toBe(700);
});
it('clamps handles to neighbors and leaves real gaps', () => {
  const {project} = fixture(), line = lines(project)[0];
  wordBoundary(line, 0, 'endMs', 5000); expect(line.words[0].endMs).toBe(1000);
  wordBoundary(line, 1, 'startMs', -1); expect(line.words[1].startMs).toBe(1000);
  wordBoundary(line, 0, 'startMs', 5000); expect(line.words[0].startMs).toBe(999);
});
it('converts half-open line intervals to inclusive Player bounds', () => {
  const {project} = fixture(); expect(loopFrames(lines(project)[0], 30)).toEqual({inFrame: 30, outFrame: 89});
  expect(loopFrames(undefined, 30)).toBeUndefined();
});
it('applies pending taps atomically, preserves untapped source and rejects reverse taps and locks', () => {
  const {project} = fixture(); setLyrics(project, 'First\nSecond\nThird');
  const ids = lines(project).map(l => l.id), next = applyTaps(project, ids, [1000, 2000], 3000);
  expect(lines(next).map(l => l.startMs)).toEqual([1000, 2000, null]);
  expect(lines(project).every(l => l.startMs === null)).toBe(true);
  expect(() => applyTaps(project, ids, [2000, 1000], 3000)).toThrow('advance');
  next.tracks.find(t => t.kind === 'lyrics')!.locked = true;
  expect(() => applyTaps(next, ids, [1500, 2200], 3000)).toThrow('Unlock');
});
it('retains unchanged occurrence identities when pasted text gains a line', () => {
  const {project, result} = fixture();
  updateLine(project, 'line-1', l => wordBoundary(l, 0, 'endMs', 600));
  reviseLyrics(project, 'New line\nSing again');
  const source = project.lyricSource.lines[1]; expect(source.id).toBe('line-1'); expect(source.alignmentId).toBe('line-2');
  const next = applyAlignment(project, {...result, sourceLyrics: project.lyricSource.text,
    lines: [{...result.lines[0], id: 'line-2'}]});
  expect(lines(next).find(l => l.id === source.id)!.words[0].endMs).toBe(600);
});
it('keeps removed corrected tokens and occurrences available for explicit review', () => {
  const {project} = fixture();
  updateLine(project, 'line-1', l => wordBoundary(l, 0, 'endMs', 600));
  const token = lines(project)[0].words[1].id;
  updateLine(project, 'line-1', l => {l.text = 'again'; l.status = 'manual';});
  expect(project.lyricSource.lines[0].unresolvedCorrections?.[0].endMs).toBe(600);
  expect(lines(project)[0].words[0].id).toBe(token);
  reviseLyrics(project, 'New line');
  expect(lines(project).find(l => l.id === 'line-1')!.reason).toContain('retained');
});
it('preserves explicitly untimed words through reruns without inventing a highlight', () => {
  const {project, result} = fixture();
  updateLine(project, 'line-1', l => {l.words[0].untimed = true; l.words[0].manualStart = l.words[0].manualEnd = true; l.status = 'manual';});
  expect(lines(applyAlignment(project, result))[0].words[0].untimed).toBe(true);
});
it('keeps placement corrections even after approximate word spacing needs review', () => {
  const {project, result} = fixture();
  updateLine(project, 'line-1', l => {l.startMs = 900; l.durationMs = 2100; l.status = 'manual';});
  updateLine(project, 'line-1', l => {l.status = 'review';});
  expect(lines(applyAlignment(project, result))[0].startMs).toBe(900);
});
it('ignores former timing on explicitly untimed neighbors when clamping a word', () => {
  const {project} = fixture(), line = lines(project)[0]; line.words[0].untimed = true;
  wordBoundary(line, 1, 'startMs', 200); expect(line.words[1].startMs).toBe(200);
});
it('keeps corrections for unchanged tokens when inserted words require new timing', () => {
  const {project, result} = fixture(); updateLine(project, 'line-1', l => wordBoundary(l, 0, 'endMs', 600));
  const token = lines(project)[0].words[0].id;
  updateLine(project, 'line-1', l => {l.text = 'Sing a song again'; l.words = []; l.status = 'manual';});
  expect(project.lyricSource.lines[0].tokens![0].id).toBe(token);
  expect(project.lyricSource.lines[0].unresolvedCorrections).toContainEqual(expect.objectContaining({id: token, endMs: 600, manualEnd: true}));
  expect(applyAlignment(project, result).lyricSource.lines[0].unresolvedCorrections).toEqual(project.lyricSource.lines[0].unresolvedCorrections);
});
it('preserves unambiguous CJK token occurrences and their correction records', () => {
  const {project} = fixture();
  updateLine(project, 'line-1', l => {l.text = '歌を'; l.status = 'manual'; l.words = [{text: '歌', startMs: 0, endMs: 500}, {text: 'を', startMs: 600, endMs: 1000}];});
  const token = lines(project)[0].words[0].id;
  updateLine(project, 'line-1', l => {l.text = '歌声を'; l.words = []; l.status = 'manual';});
  expect(project.lyricSource.lines[0].tokens![0].id).toBe(token);
  expect(project.lyricSource.lines[0].unresolvedCorrections).toContainEqual(expect.objectContaining({id: token, endMs: 500}));
});
it('round-trips long untimed CJK source lines within the existing text bound', () => {
  const project = migrateTimeline(fixtures[1]); setLyrics(project, '歌'.repeat(600));
  const parsed = parseTimeline(project); expect(parsed.lyricSource.lines[0].tokens).toHaveLength(600);
  expect(parseTimeline(parsed)).toEqual(parsed);
});
