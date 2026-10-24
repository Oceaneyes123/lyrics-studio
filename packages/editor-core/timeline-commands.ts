import {parseTimeline, timelineClipSchema, trackSchema, type TimelineProject, type Clip, type LyricClip} from '../project-model/timeline';
import {lyricLines, lyricTokens, type Project as LegacyProject} from '../project-model/model';
import {msToFrame, type ProofLine} from '../project-model/proof';
import type {VisualTransition} from '../project-model/effects';

export type Line = Omit<LegacyProject['lines'][number], 'words' | 'style'> & Pick<LyricClip, 'words' | 'style' | 'manualStart' | 'manualEnd' | 'animation' | 'textMotion' | 'transform' | 'locked' | 'hidden' | 'order'>;
export const audioClips = (p: TimelineProject) => p.clips.filter((c): c is Extract<Clip, {kind: 'audio'}> => c.kind === 'audio');
export const visualClips = (p: TimelineProject) => p.clips.filter((c): c is Extract<Clip, {kind: 'visual'}> => c.kind === 'visual').sort((a, b) => a.startMs - b.startMs);
export const lines = (p: TimelineProject): Line[] => {
  const placements = new Map(p.clips.filter(c => c.kind === 'lyric').map(c => [c.sourceLineId, c]));
  return p.lyricSource.lines.map(source => {
    const placement = placements.get(source.id);
    return placement ? {...placement, id: source.id} : {...source, status: 'unmatched', startMs: null, durationMs: null, words: []};
  });
};

export function changeTimeline(project: TimelineProject, edit: (draft: TimelineProject) => void) {
  const next = structuredClone(project); edit(next);
  if (next.alignmentSourceClipId && !next.clips.some(c => c.id === next.alignmentSourceClipId)) next.alignmentSourceClipId = null;
  for (const track of project.tracks.filter(track => track.locked)) {
    const replacement = next.tracks.find(t => t.id === track.id);
    const oldIndex = project.tracks.indexOf(track), newIndex = next.tracks.findIndex(t => t.id === track.id);
    const reordered = project.tracks.some((other, index) => {
      const moved = next.tracks.findIndex(t => t.id === other.id);
      return moved >= 0 && Math.sign(index - oldIndex) !== Math.sign(moved - newIndex);
    });
    if (!replacement || reordered ||
      JSON.stringify(project.transitions.filter(t => project.clips.some(c => c.trackId === track.id && (t.fromClipId === c.id || t.toClipId === c.id)))) !==
        JSON.stringify(next.transitions.filter(t => next.clips.some(c => c.trackId === track.id && (t.fromClipId === c.id || t.toClipId === c.id)))) ||
      JSON.stringify(project.clips.filter(c => c.trackId === track.id)) !== JSON.stringify(next.clips.filter(c => c.trackId === track.id)))
      throw new Error(`Unlock ${track.name} before editing its content or order`);
  }
  for (const clip of project.clips.filter(c => c.locked)) {
    const replacement = next.clips.find(c => c.id === clip.id);
    if (!replacement || JSON.stringify({...clip, locked: undefined}) !== JSON.stringify({...replacement, locked: undefined}))
      throw new Error('Unlock the object before editing it');
  }
  return parseTimeline(next);
}

export function updateLine(project: TimelineProject, id: string, edit: (line: Line) => void, correction = true) {
  const source = project.lyricSource.lines.find(line => line.id === id);
  const line = lines(project).find(line => line.id === id);
  if (!source || !line) throw new Error('Lyric line is missing');
  const existing = project.clips.find(c => c.kind === 'lyric' && c.sourceLineId === id);
  const before = structuredClone(line);
  edit(line); source.text = line.text;
  if (correction && line.animation && line.startMs !== null && before.startMs !== null && line.startMs !== before.startMs &&
    line.startMs + (line.durationMs ?? 0) === before.startMs + (before.durationMs ?? 0))
    line.animation.originMs += line.startMs - before.startMs;
  if (line.text !== before.text) {
    const oldTokens = before.words.length ? before.words.map((w, index) => ({id: w.id ?? `${id}:word:${index}`, text: w.text})) : source.tokens ?? [];
    const texts = lyricTokens(line.text);
    source.tokens = texts.map((text, index) => {
      const sameCount = oldTokens.filter(t => t.text === text).length === texts.filter(t => t === text).length;
      const old = sameCount && oldTokens[index]?.text === text ? oldTokens[index] :
        oldTokens.filter(t => t.text === text).length === 1 && texts.filter(t => t === text).length === 1 ? oldTokens.find(t => t.text === text) : undefined;
      return {id: old?.id ?? crypto.randomUUID(), text};
    });
    const mapped = source.tokens.map(token => before.words.find(w => w.id === token.id));
    line.words = line.words.length && line.words.map(w => w.text).join('') === line.text ?
      line.words.map((w, index) => ({...w, id: source.tokens![index]?.id ?? crypto.randomUUID()})) :
      mapped.every(Boolean) ? mapped.map((w, index) => ({...w!, text: source.tokens![index].text})) : [];
    const pending = before.words.filter(w => (w.manualStart || w.manualEnd) && !line.words.some(current => current.id === w.id));
    if (pending.length) {
      source.unresolvedCorrections = [...new Map([...(source.unresolvedCorrections ?? []), ...pending].map(w => [w.id ?? `${w.text}:${w.startMs}:${w.endMs}`, w])).values()];
      source.reason = line.reason = 'Text changed: token corrections are retained while words await timing or review. Explicit replacement clears them.';
    }
  }
  if (correction && line.status === 'manual') {
    if (line.startMs !== before.startMs) line.manualStart = true;
    if (line.startMs !== null && (line.startMs + (line.durationMs ?? 0)) !== (before.startMs ?? 0) + (before.durationMs ?? 0)) line.manualEnd = true;
    line.words.forEach((word, index) => {
      const old = before.words[index];
      word.id ??= old?.text === word.text ? old.id : crypto.randomUUID();
      if (!old || old.startMs !== word.startMs) word.manualStart = true;
      if (!old || old.endMs !== word.endMs) word.manualEnd = true;
    });
  }
  project.clips = project.clips.filter(c => c.id !== existing?.id);
  if (line.startMs !== null && line.durationMs !== null) {
    let track = existing ? project.tracks.find(track => track.id === existing.trackId) : project.tracks.find(track => track.kind === 'lyrics');
    if (!track) {track = trackSchema.parse({id: crypto.randomUUID(), name: 'Lyrics', kind: 'lyrics'}); project.tracks.push(track);}
    project.clips.push(timelineClipSchema.parse({...line, id: existing?.id ?? crypto.randomUUID(), kind: 'lyric', trackId: track.id,
      sourceLineId: id, groupId: existing?.groupId}));
    delete source.style;
    delete source.textMotion; delete source.animation;
  } else {
    source.style = line.style; source.reason = line.reason; source.score = line.score;
    source.textMotion = line.textMotion; source.animation = line.animation;
  }
}

export function setLyrics(project: TimelineProject, text: string) {
  project.clips = project.clips.filter(c => c.kind !== 'lyric');
  project.lyricSource = {text, lines: lyricLines(text).map(({id, text}) => ({id, text}))};
}
export function reviseLyrics(project: TimelineProject, text: string) {
  const previous = project.lyricSource.lines, incoming = lyricLines(text), used = new Set<string>();
  const next: TimelineProject['lyricSource']['lines'] = incoming.map(line => {
    const sameCount = previous.filter(old => old.text === line.text).length === incoming.filter(l => l.text === line.text).length;
    const samePosition = sameCount ? previous.find(old => (old.alignmentId ?? old.id) === line.id && old.text === line.text) : undefined;
    const unique = previous.filter(old => old.text === line.text);
    const old = samePosition ?? (unique.length === 1 && incoming.filter(l => l.text === line.text).length === 1 ? unique[0] : undefined);
    if (old && !used.has(old.id)) {used.add(old.id); return {...old, alignmentId: line.id};}
    return {id: crypto.randomUUID(), text: line.text, alignmentId: line.id};
  });
  for (const old of previous.filter(old => !used.has(old.id))) {
    const clip = project.clips.find(c => c.kind === 'lyric' && c.sourceLineId === old.id);
    if (clip?.kind === 'lyric' && (clip.status === 'manual' || clip.sourceId || clip.manualStart || clip.manualEnd || clip.words.some(w => w.manualStart || w.manualEnd)) || old.unresolvedCorrections?.length) {
      used.add(old.id); next.push({...old, alignmentId: undefined,
        reason: 'This corrected occurrence was removed from pasted text and retained for review.'});
      if (clip?.kind === 'lyric') clip.reason = next.at(-1)!.reason;
    }
  }
  project.clips = project.clips.filter(c => c.kind !== 'lyric' || used.has(c.sourceLineId));
  project.lyricSource = {text, lines: next};
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
      if (clip.kind === 'lyric' && deltaMs) {clip.status = 'manual'; clip.manualStart = clip.manualEnd = true;}
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
      source.textMotion = clip.textMotion; source.animation = clip.animation;
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
export type ClipClipboard = {projectId: string; clips: Clip[]; transitions: VisualTransition[]};
export function copyClips(project: TimelineProject, ids: string[]): ClipClipboard {
  const clips = selectedClips(project, ids), selected = new Set(clips.map(c => c.id));
  return {projectId: project.id, clips: structuredClone(clips),
    transitions: structuredClone(project.transitions.filter(t => selected.has(t.fromClipId) && selected.has(t.toClipId)))};
}
export function pasteClips(project: TimelineProject, clipboard: ClipClipboard, atMs: number) {
  if (clipboard.projectId !== project.id) throw new Error('Clipboard belongs to another project');
  if (!clipboard.clips.length) return project;
  const start = Math.min(...clipboard.clips.map(c => c.startMs)), groups = new Map<string, string>(), identities = new Map<string, string>();
  return changeTimeline(project, draft => {
    for (const original of clipboard.clips) {
      const clip = structuredClone(original); clip.id = crypto.randomUUID(); clip.startMs += atMs - start;
      identities.set(original.id, clip.id);
      if (clip.groupId) {if (!groups.has(clip.groupId)) groups.set(clip.groupId, crypto.randomUUID()); clip.groupId = groups.get(clip.groupId);}
      if (clip.kind === 'lyric') {
        clip.status = 'manual'; clip.sourceLineId = crypto.randomUUID();
        clip.manualStart = clip.manualEnd = true;
        clip.words = clip.words.map(w => ({...w, id: crypto.randomUUID(), manualStart: true, manualEnd: true}));
        draft.lyricSource.lines.push({id: clip.sourceLineId, text: clip.text, tokens: clip.words.length ? clip.words.map(({id, text}) => ({id: id!, text})) : undefined});
      }
      draft.clips.push(clip);
    }
    draft.transitions.push(...clipboard.transitions.map(t => ({...t, id: crypto.randomUUID(), fromClipId: identities.get(t.fromClipId)!, toClipId: identities.get(t.toClipId)!})));
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
    if (right.animation) right.animation.originMs += delta;
    if (left.kind === 'lyric' && right.kind === 'lyric') {
      if (!left.words.length || left.words.some(word => word.untimed || word.startMs < delta && word.endMs > delta)) throw new Error('Split between timed words');
      const words = left.words; left.words = words.filter(w => w.endMs <= delta);
      right.words = words.filter(w => w.startMs >= delta).map(w => ({...w, startMs: w.startMs - delta, endMs: w.endMs - delta}));
      if (!left.words.length || !right.words.length) throw new Error('Split between two words');
      left.text = left.words.map(w => w.text).join(''); right.text = right.words.map(w => w.text).join('');
      left.sourceId ??= left.sourceLineId; right.sourceId = left.sourceId;
      right.sourceLineId = crypto.randomUUID(); right.status = left.status = 'manual';
      Object.assign(draft.lyricSource.lines.find(line => line.id === left.sourceLineId)!, {text: left.text,
        tokens: left.words.map(({id, text}) => ({id: id!, text}))});
      draft.lyricSource.lines.push({id: right.sourceLineId, text: right.text, tokens: right.words.map(({id, text}) => ({id: id!, text}))});
    } else if (left.kind !== 'lyric' && right.kind !== 'lyric' && left.kind !== 'text' && right.kind !== 'text') {
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
export function alignmentReference(project: TimelineProject) {
  const clip = audioClips(project).find(clip => clip.id === project.alignmentSourceClipId), asset = project.assets.find(asset => asset.id === clip?.assetId);
  if (!clip || !asset) throw new Error('Select song audio as the alignment reference');
  if (clip.sourceInMs || clip.durationMs !== asset.durationMs) throw new Error('Align the complete original song before trimming or splitting its audio');
  return {clip, asset, mapping: {clipId: clip.id, startMs: clip.startMs, sourceInMs: clip.sourceInMs, durationMs: clip.durationMs}};
}
export type AlignmentResult = {sourceLyrics: string; audioHash: string; lines: ProofLine[];
  reference?: ReturnType<typeof alignmentReference>['mapping']};
export function applyAlignment(project: TimelineProject, result: AlignmentResult, replace = false) {
  const {clip: reference, asset, mapping} = alignmentReference(project);
  if (result.audioHash !== asset.hash || result.sourceLyrics !== project.lyricSource.text ||
    (result.reference ? (['clipId', 'startMs', 'sourceInMs', 'durationMs'] as const).some(key => result.reference![key] !== mapping[key]) : reference.startMs !== 0))
    throw new Error('Song or lyrics changed during alignment. Run alignment again.');
  return changeTimeline(project, draft => {
    const protectedIds = new Set(replace ? [] : lines(draft).filter(line => line.sourceId || line.status === 'manual' &&
      (!line.manualStart && !line.manualEnd && !line.words.some(w => w.manualStart || w.manualEnd)))
      .map(line => line.sourceId ?? line.id));
    const previous = lines(draft);
    if (replace) setLyrics(draft, draft.lyricSource.text);
    for (const resultLine of result.lines) {
      const source = draft.lyricSource.lines.find(line => (line.alignmentId ?? line.id) === resultLine.id);
      if (!source || protectedIds.has(source.id) || protectedIds.has(resultLine.id)) continue;
      const targetId = source.id, old = previous.find(line => line.id === targetId);
      const candidate = structuredClone(draft);
      updateLine(candidate, targetId, line => {
        const style = previous.find(old => old.id === targetId)?.style;
        Object.assign(line, resultLine, {id: targetId}); line.style = style;
        if (line.startMs !== null) line.startMs += reference.startMs;
        if (!replace && old && (old.status === 'manual' || old.manualStart || old.manualEnd || old.words.some(w => w.manualStart || w.manualEnd))) {
          if (line.startMs === null || line.durationMs === null || old.startMs === null) {Object.assign(line, old); return;}
          const end = old.manualEnd ? old.startMs + old.durationMs! : line.startMs + line.durationMs;
          if (old.manualStart) line.startMs = old.startMs;
          line.durationMs = end - line.startMs;
          line.manualStart = old.manualStart; line.manualEnd = old.manualEnd;
          if (line.words.length !== old.words.length || line.words.some((w, i) => w.text !== old.words[i].text)) {Object.assign(line, old); return;}
          line.words = line.words.map((word, i) => ({...word, id: old.words[i].id,
            startMs: old.words[i].manualStart ? old.words[i].startMs : word.startMs,
            endMs: old.words[i].manualEnd ? old.words[i].endMs : word.endMs,
            manualStart: old.words[i].manualStart, manualEnd: old.words[i].manualEnd, untimed: old.words[i].untimed}));
          const automaticFieldsChanged = line.startMs !== old.startMs || line.durationMs !== old.durationMs ||
            line.words.some((w, i) => w.startMs !== old.words[i].startMs || w.endMs !== old.words[i].endMs);
          line.status = automaticFieldsChanged ? 'review' : old.status;
        }
      }, false);
      try {parseTimeline(candidate); Object.assign(draft, candidate);}
      catch (error) {
        if (replace) throw error;
        const source = draft.lyricSource.lines.find(line => line.id === targetId)!;
        source.reason = 'Alignment conflicts with retained timing. Review this line or explicitly replace corrections.';
        const retained = draft.clips.find(c => c.kind === 'lyric' && c.sourceLineId === targetId);
        if (retained?.kind === 'lyric') retained.reason = source.reason;
      }
    }
  });
}
