import {msToFrame} from '../project-model/proof';
import {changeTimeline, lines, updateLine, type Line} from './timeline-commands';
import type {TimelineProject} from '../project-model/timeline';

export function loopFrames(line: Line | undefined, fps: number) {
  if (line?.startMs === null || line?.startMs === undefined || !line.durationMs) return undefined;
  return {inFrame: msToFrame(line.startMs, fps), outFrame: Math.max(msToFrame(line.startMs, fps), msToFrame(line.startMs + line.durationMs, fps) - 1)};
}
export function wordBoundary(line: Line, index: number, edge: 'startMs' | 'endMs', value: number) {
  const word = line.words[index]; if (!word || !line.durationMs) throw new Error('Select a timed word');
  const min = edge === 'startMs' ? line.words.slice(0, index).reverse().find(w => !w.untimed)?.endMs ?? 0 : word.startMs + 1;
  const max = edge === 'endMs' ? line.words.slice(index + 1).find(w => !w.untimed)?.startMs ?? line.durationMs : word.endMs - 1;
  word[edge] = Math.round(Math.max(min, Math.min(max, value))); line.status = 'manual';
}
export function applyTaps(project: TimelineProject, ids: string[], taps: number[], endMs: number) {
  if (!taps.length || taps.length > ids.length) throw new Error('Tap at least one line');
  const ends = [...taps.slice(1), endMs];
  return changeTimeline(project, draft => taps.forEach((start, index) => {
    if (!lines(draft).some(l => l.id === ids[index])) throw new Error('Lyrics changed while tapping');
    if (msToFrame(ends[index], project.fps) <= msToFrame(start, project.fps)) throw new Error('Each tap must advance by at least one frame');
    updateLine(draft, ids[index], line => {line.startMs = start; line.durationMs = ends[index] - start;
      line.words = []; line.status = 'manual';});
  }));
}
