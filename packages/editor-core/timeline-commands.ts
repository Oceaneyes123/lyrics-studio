import {parseTimeline, timelineClipSchema, trackSchema, type TimelineProject, type Clip} from '../project-model/timeline';
import {lyricLines, type Project as LegacyProject} from '../project-model/model';
import {msToFrame, type ProofLine} from '../project-model/proof';

export type Line = LegacyProject['lines'][number];
export const audioClips = (p: TimelineProject) => p.clips.filter((c): c is Extract<Clip, {kind: 'audio'}> => c.kind === 'audio');
export const visualClips = (p: TimelineProject) => p.clips.filter((c): c is Extract<Clip, {kind: 'visual'}> => c.kind === 'visual');
export const lines = (p: TimelineProject): Line[] => p.lyricSource.lines.map(source => {
  const placement = p.clips.find(c => c.kind === 'lyric' && c.sourceLineId === source.id);
  return placement?.kind === 'lyric' ? {...placement, id: source.id} : {...source, status: 'unmatched', startMs: null, durationMs: null, words: []};
});

export function changeTimeline(project: TimelineProject, edit: (draft: TimelineProject) => void) {
  const next = structuredClone(project); edit(next);
  for (const track of project.tracks.filter(track => track.locked)) {
    const replacement = next.tracks.find(t => t.id === track.id);
    if (!replacement || project.tracks.indexOf(track) !== next.tracks.findIndex(t => t.id === track.id) ||
      JSON.stringify(project.clips.filter(c => c.trackId === track.id)) !== JSON.stringify(next.clips.filter(c => c.trackId === track.id)))
      throw new Error(`Unlock ${track.name} before editing its content or order`);
  }
  return parseTimeline(next);
}

export function updateLine(project: TimelineProject, id: string, edit: (line: Line) => void) {
  const source = project.lyricSource.lines.find(line => line.id === id);
  const line = lines(project).find(line => line.id === id);
  if (!source || !line) throw new Error('Lyric line is missing');
  const existing = project.clips.find(c => c.kind === 'lyric' && c.sourceLineId === id);
  edit(line); source.text = line.text;
  project.clips = project.clips.filter(c => c.id !== existing?.id);
  if (line.startMs !== null && line.durationMs !== null) {
    let track = existing ? project.tracks.find(track => track.id === existing.trackId) : project.tracks.find(track => track.kind === 'lyrics');
    if (!track) {track = trackSchema.parse({id: crypto.randomUUID(), name: 'Lyrics', kind: 'lyrics'}); project.tracks.push(track);}
    project.clips.push(timelineClipSchema.parse({...line, id: existing?.id ?? crypto.randomUUID(), kind: 'lyric', trackId: track.id,
      sourceLineId: id, groupId: existing?.groupId}));
    delete source.style;
  } else {
    source.style = line.style; source.reason = line.reason; source.score = line.score;
  }
}

export function setLyrics(project: TimelineProject, text: string) {
  project.clips = project.clips.filter(c => c.kind !== 'lyric');
  project.lyricSource = {text, lines: lyricLines(text).map(({id, text}) => ({id, text}))};
}

export function selectedClips(project: TimelineProject, ids: string[], individual = false) {
  const selected = new Set(ids), groups = new Set(project.clips.filter(c => selected.has(c.id)).map(c => c.groupId).filter(Boolean));
  return project.clips.filter(c => selected.has(c.id) || (!individual && c.groupId && groups.has(c.groupId)));
}
export function moveClips(project: TimelineProject, ids: string[], deltaMs: number, targetTrackId?: string, primaryTrackId?: string) {
  const selected = selectedClips(project, ids);
  return changeTimeline(project, draft => {
    for (const clip of draft.clips.filter(c => selected.some(s => s.id === c.id))) {
      clip.startMs += deltaMs;
      if (targetTrackId && clip.trackId === primaryTrackId) clip.trackId = targetTrackId;
    }
  });
}
export function deleteClips(project: TimelineProject, ids: string[], ripple = false) {
  const selected = selectedClips(project, ids), deleted = new Set(selected.map(c => c.id));
  const shifts = new Map<string, number>();
  if (ripple) for (const track of project.tracks) {
    const spans: [number, number][] = [];
    for (const clip of selected.filter(c => c.trackId === track.id).sort((a, b) => a.startMs - b.startMs)) {
      const end = clip.startMs + clip.durationMs, previous = spans.at(-1);
      if (previous && clip.startMs <= previous[1]) previous[1] = Math.max(previous[1], end);
      else spans.push([clip.startMs, end]);
    }
    for (const clip of project.clips.filter(c => c.trackId === track.id && !deleted.has(c.id))) {
      if (spans.some(([a, b]) => clip.startMs < b && clip.startMs + clip.durationMs > a)) throw new Error('Ripple would cut a retained clip. Trim or ordinary-delete first.');
      shifts.set(clip.id, spans.filter(([, end]) => end <= clip.startMs).reduce((sum, [a, b]) => sum + b - a, 0));
    }
  }
  for (const clip of project.clips.filter(c => !deleted.has(c.id) && c.groupId)) {
    if (project.clips.some(other => other.groupId === clip.groupId && !deleted.has(other.id) && (shifts.get(other.id) ?? 0) !== (shifts.get(clip.id) ?? 0)))
      throw new Error('Ripple would move grouped clips differently. Ungroup first.');
  }
  return changeTimeline(project, draft => {
    for (const clip of draft.clips.filter(c => deleted.has(c.id))) if (clip.kind === 'lyric') {
      const source = draft.lyricSource.lines.find(line => line.id === clip.sourceLineId)!;
      source.style = clip.style;
    }
    draft.clips = draft.clips.filter(c => !deleted.has(c.id));
    for (const clip of draft.clips) clip.startMs -= shifts.get(clip.id) ?? 0;
  });
}
export function groupClips(project: TimelineProject, ids: string[], groupId: string | null) {
  const selected = new Set(selectedClips(project, ids).map(c => c.id));
  return changeTimeline(project, draft => {for (const clip of draft.clips) if (selected.has(clip.id)) {
    if (groupId) clip.groupId = groupId; else delete clip.groupId;
  }});
}
export type ClipClipboard = {projectId: string; clips: Clip[]};
export function copyClips(project: TimelineProject, ids: string[]): ClipClipboard {
  return {projectId: project.id, clips: structuredClone(selectedClips(project, ids))};
}
export function pasteClips(project: TimelineProject, clipboard: ClipClipboard, atMs: number) {
  if (clipboard.projectId !== project.id) throw new Error('Clipboard belongs to another project');
  if (!clipboard.clips.length) return project;
  const start = Math.min(...clipboard.clips.map(c => c.startMs)), groups = new Map<string, string>();
  return changeTimeline(project, draft => {
    for (const original of clipboard.clips) {
      const clip = structuredClone(original); clip.id = crypto.randomUUID(); clip.startMs += atMs - start;
      if (clip.groupId) {if (!groups.has(clip.groupId)) groups.set(clip.groupId, crypto.randomUUID()); clip.groupId = groups.get(clip.groupId);}
      if (clip.kind === 'lyric') {
        clip.status = 'manual'; clip.sourceLineId = crypto.randomUUID();
        draft.lyricSource.lines.push({id: clip.sourceLineId, text: clip.text});
      }
      draft.clips.push(clip);
    }
  });
}
export function splitClip(project: TimelineProject, id: string, atMs: number) {
  const clip = project.clips.find(c => c.id === id);
  if (!clip) throw new Error('Select a clip first');
  const delta = atMs - clip.startMs;
  if (delta <= 0 || delta >= clip.durationMs) throw new Error('Seek inside the selected clip first');
  return changeTimeline(project, draft => {
    const left = draft.clips.find(c => c.id === id)!, right = structuredClone(left);
    right.id = crypto.randomUUID(); right.startMs = atMs; right.durationMs -= delta; left.durationMs = delta;
    if (left.kind === 'lyric' && right.kind === 'lyric') {
      if (!left.words.length || left.words.some(word => word.startMs < delta && word.endMs > delta)) throw new Error('Split between timed words');
      const words = left.words; left.words = words.filter(w => w.endMs <= delta);
      right.words = words.filter(w => w.startMs >= delta).map(w => ({...w, startMs: w.startMs - delta, endMs: w.endMs - delta}));
      if (!left.words.length || !right.words.length) throw new Error('Split between two words');
      left.text = left.words.map(w => w.text).join(''); right.text = right.words.map(w => w.text).join('');
      left.sourceId ??= left.sourceLineId; right.sourceId = left.sourceId;
      right.sourceLineId = crypto.randomUUID(); right.status = left.status = 'manual';
      draft.lyricSource.lines.find(line => line.id === left.sourceLineId)!.text = left.text;
      draft.lyricSource.lines.push({id: right.sourceLineId, text: right.text});
    } else if (left.kind !== 'lyric' && right.kind !== 'lyric') {
      if (draft.assets.find(a => a.id === right.assetId)?.kind !== 'image') right.sourceInMs += delta;
      left.fadeOutMs = 0; left.fadeInMs = Math.min(left.fadeInMs, left.durationMs);
      right.fadeInMs = 0; right.fadeOutMs = Math.min(right.fadeOutMs, right.durationMs);
    }
    draft.clips.push(right);
  });
}
export function snapTimeline(ms: number, project: TimelineProject, zoom: number, enabled: boolean, playhead = 0) {
  let value = msToFrame(ms, project.fps) * 1000 / project.fps;
  if (enabled) {
    const edges = [0, project.durationMs, playhead, ...project.clips.flatMap(c => [c.startMs, c.startMs + c.durationMs])];
    const nearest = edges.reduce((a, b) => Math.abs(b - ms) < Math.abs(a - ms) ? b : a);
    if (Math.abs(nearest - ms) * zoom / 1000 < 8) value = nearest;
  }
  return Math.round(Math.max(0, Math.min(project.durationMs, value)));
}
export function applyAlignment(project: TimelineProject, result: {sourceLyrics: string; audioHash: string; lines: ProofLine[]}, replace = false) {
  const reference = audioClips(project)[0], asset = project.assets.find(a => a.id === reference?.assetId);
  if (!reference || !asset || result.audioHash !== asset.hash || result.sourceLyrics !== project.lyricSource.text ||
    reference.sourceInMs || reference.startMs || reference.durationMs !== asset.durationMs) throw new Error('Song or lyrics changed during alignment. Run alignment again.');
  return changeTimeline(project, draft => {
    const protectedIds = new Set(replace ? [] : lines(draft).filter(line => line.status === 'manual').map(line => line.sourceId ?? line.id));
    for (const resultLine of result.lines) {
      if (protectedIds.has(resultLine.id)) continue;
      if (!draft.lyricSource.lines.some(line => line.id === resultLine.id)) continue;
      updateLine(draft, resultLine.id, line => {const style = line.style; Object.assign(line, resultLine); line.style = style;});
    }
  });
}
