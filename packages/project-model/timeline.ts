import {z} from 'zod';
import {transformSchema} from './canvas';
import {clipSchema, lineSchema, projectSchema, parseProject, lyricTokens, type Project} from './model';
import {msToFrame} from './proof';
import {animationSchema} from './animation';
import {fontSchema, textMotionSchema, textStyleSchema} from './text';
import {effectsSchema, transitionSchema} from './effects';
import {audioProcessingSchema, processedMixSchema} from './audio-processing';

const identity = z.string().min(1).max(160);
export const gainDbSchema = z.number().min(-60).max(6).default(0);
export const trackSchema = z.object({id: identity, name: z.string().trim().min(1).max(120),
  kind: z.enum(['audio', 'visual', 'lyrics']), locked: z.boolean().default(false),
  muted: z.boolean().default(false), visible: z.boolean().default(true), gainDb: gainDbSchema, solo: z.boolean().default(false)});
const placement = {trackId: identity, groupId: identity.optional(), animation: animationSchema.optional(), transform: transformSchema.optional(), locked: z.boolean().optional(), hidden: z.boolean().optional(), order: z.number().int().min(-100000).max(100000).optional()};
const word = lineSchema.shape.words.element.extend({id: identity.optional(),
  manualStart: z.boolean().optional(), manualEnd: z.boolean().optional(), untimed: z.boolean().optional()});
const media = clipSchema.omit({layer: true}).extend({id: identity, ...placement, rotation: z.number().min(-3600).max(3600).default(0), gainDb: gainDbSchema, muted: z.boolean().default(false)});
export const timelineClipSchema = z.discriminatedUnion('kind', [
  media.extend({kind: z.literal('audio')}), media.extend({kind: z.literal('visual'), audioEnabled: z.boolean().default(false), effects: effectsSchema.optional()}),
  z.object({id: identity, kind: z.literal('text'), ...placement, text: z.string().min(1).max(10000),
    startMs: z.number().int().nonnegative(), durationMs: z.number().int().positive(), style: textStyleSchema,
    boxBackground: z.string().regex(/^#[a-f\d]{6}$/i).optional()}),
  lineSchema.extend({kind: z.literal('lyric'), ...placement, sourceLineId: identity,
    style: textStyleSchema.optional(), textMotion: textMotionSchema.optional(),
    words: z.array(word).max(500), manualStart: z.boolean().optional(), manualEnd: z.boolean().optional(),
    startMs: z.number().int().nonnegative(), durationMs: z.number().int().positive()}),
]);
const sourceLine = lineSchema.pick({id: true, text: true, reason: true, score: true, style: true}).extend({
  style: textStyleSchema.optional(),
  textMotion: textMotionSchema.optional(), animation: animationSchema.optional(),
  alignmentId: identity.optional(),
  tokens: z.array(z.object({id: identity, text: z.string().min(1)})).max(2000).optional(),
  unresolvedCorrections: z.array(word).max(500).optional(),
});
export const timelineSchema = projectSchema.omit({schemaVersion: true, audioFile: true, sourceLyrics: true,
  audioClips: true, backgrounds: true, lines: true}).extend({schemaVersion: z.literal(4),
  tracks: z.array(trackSchema).max(1000), clips: z.array(timelineClipSchema).max(3000),
  lyricSource: z.object({text: z.string().max(100000), lines: z.array(sourceLine).max(2000)}),
  style: textStyleSchema, fonts: z.array(fontSchema).max(100).default([]), textMotion: textMotionSchema.optional(),
  transitions: z.array(transitionSchema).max(1000).default([]),
  audioProcessing: audioProcessingSchema.optional(), processedMix: processedMixSchema.optional(),
  masterGainDb: gainDbSchema, alignmentSourceClipId: identity.nullable().default(null)}).strict();
export type TimelineProject = z.infer<typeof timelineSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Clip = z.infer<typeof timelineClipSchema>;
export type LyricClip = Extract<Clip, {kind: 'lyric'}>;

export function parseTimeline(value: unknown): TimelineProject {
  const project = timelineSchema.parse(value);
  if (project.width % 2 || project.height % 2) throw new Error('Canvas dimensions must be even');
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const tracks = new Map(project.tracks.map(track => [track.id, track]));
  if (new Set(project.fonts.map(f => f.id)).size !== project.fonts.length) throw new Error('Duplicate font');
  for (const style of [project.style, ...project.clips.filter(c => c.kind === 'lyric' || c.kind === 'text').map(c => c.style), ...project.lyricSource.lines.map(l => l.style)]) {
    if (style?.font.startsWith('font:') && !project.fonts.some(f => f.id === style.font.slice(5))) throw new Error('Style font is missing from this project');
  }
  const sourceIds = new Set(project.lyricSource.lines.map(line => line.id));
  if (assets.size !== project.assets.length || tracks.size !== project.tracks.length || sourceIds.size !== project.lyricSource.lines.length)
    throw new Error('Duplicate asset, track, or source identity');
  const identities = new Set<string>(), placedSources = new Set<string>();
  for (const source of project.lyricSource.lines) {
    const clip = project.clips.find(c => c.kind === 'lyric' && c.sourceLineId === source.id);
    source.tokens ??= (clip?.kind === 'lyric' && clip.words.length ? clip.words.map(w => w.text) : lyricTokens(source.text)).map((text, index) => ({id: `${source.id}:word:${index}`, text}));
    if (source.tokens.map(t => t.text).join('') !== source.text || new Set(source.tokens.map(t => t.id)).size !== source.tokens.length)
      throw new Error('Invalid source token occurrences');
    if (clip?.kind === 'lyric') clip.words.forEach((word, index) => {word.id ??= source.tokens?.[index]?.id;});
  }
  for (const clip of project.clips) {
    if (identities.has(clip.id)) throw new Error('Duplicate clip');
    identities.add(clip.id);
    const track = tracks.get(clip.trackId);
    if (!track || track.kind !== (clip.kind === 'lyric' ? 'lyrics' : clip.kind === 'text' ? 'visual' : clip.kind)) throw new Error('Clip has an incompatible track');
    const end = clip.startMs + clip.durationMs;
    if (end > project.durationMs || msToFrame(end, project.fps) <= msToFrame(clip.startMs, project.fps))
      throw new Error('Clip exceeds project bounds or is shorter than one frame');
    if (clip.kind === 'lyric') {
      clip.words.forEach((word, index) => {word.id ??= `${clip.sourceLineId}:word:${index}`;});
      if (!clip.text.trim()) throw new Error('Lyric text cannot be blank');
      if (!sourceIds.has(clip.sourceLineId)) throw new Error('Lyric source is missing');
      if (placedSources.has(clip.sourceLineId)) throw new Error('Each lyric occurrence needs a unique source identity');
      placedSources.add(clip.sourceLineId);
      if (clip.status === 'unmatched') throw new Error('An unmatched lyric cannot have a placement');
      let lastEnd = 0;
      for (const word of clip.words) {
        if (!word.text.trim()) throw new Error('Word text cannot be blank');
        if (word.untimed) continue;
        if (!word.text.trim() || word.startMs < lastEnd || word.startMs >= word.endMs || word.endMs > clip.durationMs) throw new Error('Invalid word timing');
        lastEnd = word.endMs;
      }
      if (clip.words.length && clip.words.map(word => word.text).join('') !== clip.text) throw new Error('Word text differs from lyric');
    } else if (clip.kind !== 'text') {
      const asset = assets.get(clip.assetId);
      if (!asset || (clip.kind === 'audio' ? asset.kind !== 'audio' : asset.kind === 'audio')) throw new Error('Invalid clip asset');
      if (clip.kind === 'visual' && clip.audioEnabled && asset.kind !== 'video') throw new Error('Only video clips have embedded audio');
      if (asset.kind !== 'image' && clip.sourceInMs + clip.durationMs > asset.durationMs + 1) throw new Error('Clip exceeds source bounds');
      if (clip.fadeInMs > clip.durationMs || clip.fadeOutMs > clip.durationMs) throw new Error('Fade exceeds clip duration');
    }
  }
  for (const track of project.tracks) {
    const clips = project.clips.filter(clip => clip.trackId === track.id).sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < clips.length; i++) {
      const active = clips.slice(0, i).filter(clip => clip.startMs + clip.durationMs > clips[i].startMs);
      if (track.kind === 'lyrics' && active.length) throw new Error('Lyrics on the same track cannot overlap');
      if (track.kind === 'visual' && clips[i].kind === 'visual' && active.filter(c => c.kind === 'visual').length >= 2) throw new Error('Only two visuals per track can crossfade');
    }
  }
  if (project.alignmentSourceClipId && !project.clips.some(c => c.id === project.alignmentSourceClipId && c.kind === 'audio'))
    throw new Error('Alignment source must reference an audio clip');
  if (new Set(project.transitions.map(t => t.id)).size !== project.transitions.length ||
    new Set(project.transitions.map(t => t.fromClipId)).size !== project.transitions.length ||
    new Set(project.transitions.map(t => t.toClipId)).size !== project.transitions.length) throw new Error('Duplicate transition partner');
  for (const transition of project.transitions) {
    const from = project.clips.find(c => c.id === transition.fromClipId), to = project.clips.find(c => c.id === transition.toClipId);
    if (!from || !to || from.kind !== 'visual' || to.kind !== 'visual' || from.trackId !== to.trackId || from.id === to.id)
      throw new Error('Remove the transition before deleting or changing its partners');
    const neighbors = project.clips.filter(c => c.trackId === from.trackId && c.kind === 'visual').sort((a, b) => a.startMs - b.startMs);
    const overlap = Math.min(from.startMs + from.durationMs, to.startMs + to.durationMs) - to.startMs;
    if (neighbors[neighbors.indexOf(from) + 1]?.id !== to.id || to.startMs + to.durationMs < from.startMs + from.durationMs || transition.durationMs > overlap)
      throw new Error('Transition needs adjacent overlapping clips and a duration within their overlap; remove or adjust it first');
  }
  const ducking = project.audioProcessing?.ducking;
  if (ducking && (!tracks.has(ducking.triggerTrackId) || tracks.get(ducking.triggerTrackId)!.kind === 'lyrics' ||
    new Set(ducking.targetTrackIds).size !== ducking.targetTrackIds.length || ducking.targetTrackIds.some(id => id === ducking.triggerTrackId || !tracks.has(id) || tracks.get(id)!.kind === 'lyrics')))
    throw new Error('Choose distinct existing audio trigger and target tracks, or disable ducking before deleting them');
  return project;
}

function preserveLegacyManualTiming(project: TimelineProject) {
  for (const clip of project.clips) if (clip.kind === 'lyric' && clip.status === 'manual' &&
    !clip.manualStart && !clip.manualEnd && !clip.words.some(w => w.manualStart || w.manualEnd)) {
    clip.manualStart = clip.manualEnd = true;
    clip.words.forEach(word => {word.manualStart = word.manualEnd = true;});
  }
  return project;
}
export function migrateTimeline(value: unknown): TimelineProject {
  if ((value as {schemaVersion?: unknown})?.schemaVersion === 4) return parseTimeline(value);
  if ((value as {schemaVersion?: unknown})?.schemaVersion === 3) return parseTimeline({...value as object, schemaVersion: 4});
  if ((value as {schemaVersion?: unknown})?.schemaVersion === 2) {
    const current = value as TimelineProject;
    return preserveLegacyManualTiming(parseTimeline(Object.prototype.hasOwnProperty.call(current, 'alignmentSourceClipId') ? {...current, schemaVersion: 4} : {...current, schemaVersion: 4,
      alignmentSourceClipId: Array.isArray(current.clips) ? current.clips.find(c => c.kind === 'audio')?.id ?? null : null}));
  }
  const legacy = parseProject(value);
  const {audioClips, backgrounds, lines, sourceLyrics, audioFile: _audioFile, ...common} = legacy;
  const visualLayers = [...new Set([0, ...backgrounds.map(clip => clip.layer)])].sort((a, b) => a - b);
  const tracks = [trackSchema.parse({id: 'track:audio', name: 'Song', kind: 'audio'}),
    ...visualLayers.map(layer => trackSchema.parse({id: `track:visual:${layer}`, name: `Layer ${layer + 1}`, kind: 'visual'})),
    trackSchema.parse({id: 'track:lyrics', name: 'Lyrics', kind: 'lyrics'})];
  const clips: Clip[] = [
    ...audioClips.map(clip => timelineClipSchema.parse({...clip, kind: 'audio', trackId: 'track:audio'})),
    ...backgrounds.map(clip => timelineClipSchema.parse({...clip, kind: 'visual', trackId: `track:visual:${clip.layer}`})),
  ];
  const occupied = new Set(clips.map(clip => clip.id));
  for (const line of lines) {
    if (line.startMs === null || line.durationMs === null) continue;
    let id = line.id;
    while (occupied.has(id)) id = `lyric:${id}`;
    occupied.add(id);
    clips.push({...line, id, kind: 'lyric', trackId: 'track:lyrics', sourceLineId: line.id,
      startMs: line.startMs, durationMs: line.durationMs});
  }
  return preserveLegacyManualTiming(parseTimeline({...common, schemaVersion: 4, tracks, clips, alignmentSourceClipId: audioClips[0]?.id ?? null,
    lyricSource: {text: sourceLyrics, lines: lines.map(line => ({id: line.id, text: line.text, reason: line.reason,
      score: line.score, ...(line.startMs === null && line.style ? {style: line.style} : {})}))}}));
}

export function legacyPlacement(project: TimelineProject, id: string): (Omit<Project['lines'][number], 'style'> & Pick<LyricClip, 'style'>) | undefined {
  const clip = project.clips.find(clip => clip.kind === 'lyric' && clip.sourceLineId === id);
  if (clip?.kind === 'lyric') return clip;
  const source = project.lyricSource.lines.find(line => line.id === id);
  return source ? {...source, startMs: null, durationMs: null, words: [], status: 'unmatched'} : undefined;
}
