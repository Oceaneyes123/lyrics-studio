import {parseProject, type Project} from '../project-model/model';
import {msToFrame, type ProofLine} from '../project-model/proof';

export function changeProject(project: Project, edit: (draft: Project) => void) {
  const next = structuredClone(project);
  edit(next);
  next.lines.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
  next.backgrounds.sort((a, b) => a.startMs - b.startMs);
  next.audioClips.sort((a, b) => a.startMs - b.startMs);
  return parseProject(next);
}

export function timeLine(line: ProofLine, startMs: number, endMs: number) {
  const oldStart = line.startMs ?? startMs;
  const trim = startMs - oldStart;
  line.words = line.words.flatMap(word => {
    const a = Math.max(0, word.startMs - trim), b = Math.min(endMs - startMs, word.endMs - trim);
    return b > a ? [{...word, startMs: a, endMs: b}] : [];
  });
  // Retain text if trimming removes words; require explicit word correction.
  if (line.words.map(w => w.text).join('') !== line.text) line.words = [];
  line.startMs = startMs; line.durationMs = endMs - startMs; line.status = 'manual';
}

export function moveLine(line: ProofLine, startMs: number) {line.startMs = startMs;}

export function splitLine(project: Project, identity: string, atMs: number, newId: string) {
  return changeProject(project, draft => {
    const index = draft.lines.findIndex(l => l.id === identity), line = draft.lines[index];
    if (!line || line.startMs === null || line.durationMs === null) throw new Error('Select a timed lyric');
    const relative = atMs - line.startMs;
    if (relative <= 0 || relative >= line.durationMs) throw new Error('Seek inside the lyric before splitting');
    if (!line.words.length) throw new Error('Add word timing before splitting lyrics');
    if (line.words.some(w => w.startMs < relative && w.endMs > relative)) throw new Error('Split between words, not inside a sung word');
    const left = line.words.filter(w => w.endMs <= relative), right = line.words.filter(w => w.startMs >= relative);
    if (!left.length || !right.length) throw new Error('Split between two words');
    const sourceId = line.sourceId ?? line.id;
    const second = {...line, id: newId, sourceId, startMs: atMs, durationMs: line.durationMs - relative,
      text: right.map(w => w.text).join(''), words: right.map(w => ({...w, startMs: w.startMs - relative, endMs: w.endMs - relative}))};
    line.sourceId = sourceId; line.durationMs = relative; line.words = left; line.text = left.map(w => w.text).join('');
    draft.lines.splice(index + 1, 0, second);
  });
}

export function snapTime(ms: number, project: Project, pixelsPerSecond: number, enabled: boolean, playheadMs = 0) {
  let value = msToFrame(ms, project.fps) * 1000 / project.fps;
  if (enabled) {
    const edges = [0, project.durationMs, playheadMs, ...project.lines.flatMap(l => l.startMs === null ? [] : [l.startMs, l.startMs + l.durationMs!]),
      ...project.backgrounds.flatMap(c => [c.startMs, c.startMs + c.durationMs])];
    const nearest = edges.reduce((a, b) => Math.abs(b - ms) < Math.abs(a - ms) ? b : a);
    if (Math.abs(nearest - ms) * pixelsPerSecond / 1000 < 8) value = nearest;
  }
  return Math.round(Math.max(0, Math.min(project.durationMs, value)));
}

export function mergeAlignment(project: Project, result: {sourceLyrics: string; audioHash: string; lines: Project['lines']}, replaceManual = false) {
  const audio = project.audioClips[0], asset = project.assets.find(a => a.id === audio?.assetId);
  if (result.sourceLyrics !== project.sourceLyrics || project.audioClips.length !== 1 || !asset || asset.hash !== result.audioHash ||
    audio.startMs || audio.sourceInMs || audio.durationMs !== asset.durationMs) throw new Error('Song or lyrics changed during alignment. Run alignment again.');
  const protectedIds = new Set(replaceManual ? [] : project.lines.filter(l => l.status === 'manual').map(l => l.sourceId ?? l.id));
  return changeProject(project, draft => {
    draft.lines = [...draft.lines.filter(l => protectedIds.has(l.sourceId ?? l.id)), ...result.lines.filter(l => !protectedIds.has(l.id))
      .map(line => ({...line, style: project.lines.find(old => old.id === line.id)?.style}))];
  });
}

export function splitMedia(project: Project, kind: 'audio' | 'video', identity: string, atMs: number, newId: string) {
  return changeProject(project, draft => {
    const clips = kind === 'audio' ? draft.audioClips : draft.backgrounds;
    const clip = clips.find(c => c.id === identity);
    if (!clip) throw new Error('Select a media clip');
    const delta = atMs - clip.startMs;
    if (delta <= 0 || delta >= clip.durationMs) throw new Error('Seek inside the selected clip first');
    const image = draft.assets.find(a => a.id === clip.assetId)?.kind === 'image';
    const remaining = clip.durationMs - delta;
    clips.push({...clip, id: newId, startMs: atMs, durationMs: remaining,
      sourceInMs: image ? 0 : clip.sourceInMs + delta, fadeInMs: 0, fadeOutMs: Math.min(clip.fadeOutMs, remaining)});
    clip.durationMs = delta; clip.fadeOutMs = 0; clip.fadeInMs = Math.min(clip.fadeInMs, delta);
  });
}
