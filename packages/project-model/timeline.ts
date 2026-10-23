import {z} from 'zod';
import {clipSchema, lineSchema, projectSchema, parseProject, type Project} from './model';
import {msToFrame} from './proof';

const identity = z.string().min(1).max(160);
export const trackSchema = z.object({id: identity, name: z.string().trim().min(1).max(120),
  kind: z.enum(['audio', 'visual', 'lyrics']), locked: z.boolean().default(false),
  muted: z.boolean().default(false), visible: z.boolean().default(true)});
const placement = {trackId: identity, groupId: identity.optional()};
const media = clipSchema.omit({layer: true}).extend({id: identity, ...placement});
export const timelineClipSchema = z.discriminatedUnion('kind', [
  media.extend({kind: z.literal('audio')}), media.extend({kind: z.literal('visual')}),
  lineSchema.extend({kind: z.literal('lyric'), ...placement, sourceLineId: identity,
    startMs: z.number().int().nonnegative(), durationMs: z.number().int().positive()}),
]);
const sourceLine = lineSchema.pick({id: true, text: true, reason: true, score: true, style: true});
export const timelineSchema = projectSchema.omit({schemaVersion: true, audioFile: true, sourceLyrics: true,
  audioClips: true, backgrounds: true, lines: true}).extend({schemaVersion: z.literal(2),
  tracks: z.array(trackSchema).max(1000), clips: z.array(timelineClipSchema).max(3000),
  lyricSource: z.object({text: z.string().max(100000), lines: z.array(sourceLine).max(2000)})}).strict();
export type TimelineProject = z.infer<typeof timelineSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Clip = z.infer<typeof timelineClipSchema>;
export type LyricClip = Extract<Clip, {kind: 'lyric'}>;

export function parseTimeline(value: unknown): TimelineProject {
  const project = timelineSchema.parse(value);
  if (project.width % 2 || project.height % 2) throw new Error('Canvas dimensions must be even');
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const tracks = new Map(project.tracks.map(track => [track.id, track]));
  const sourceIds = new Set(project.lyricSource.lines.map(line => line.id));
  if (assets.size !== project.assets.length || tracks.size !== project.tracks.length || sourceIds.size !== project.lyricSource.lines.length)
    throw new Error('Duplicate asset, track, or source identity');
  const identities = new Set<string>();
  for (const clip of project.clips) {
    if (identities.has(clip.id)) throw new Error('Duplicate clip');
    identities.add(clip.id);
    const track = tracks.get(clip.trackId);
    if (!track || track.kind !== (clip.kind === 'lyric' ? 'lyrics' : clip.kind)) throw new Error('Clip has an incompatible track');
    const end = clip.startMs + clip.durationMs;
    if (end > project.durationMs || msToFrame(end, project.fps) <= msToFrame(clip.startMs, project.fps))
      throw new Error('Clip exceeds project bounds or is shorter than one frame');
    if (clip.kind === 'lyric') {
      if (!clip.text.trim()) throw new Error('Lyric text cannot be blank');
      if (!sourceIds.has(clip.sourceLineId)) throw new Error('Lyric source is missing');
      if (clip.status === 'unmatched') throw new Error('An unmatched lyric cannot have a placement');
      let lastEnd = 0;
      for (const word of clip.words) {
        if (!word.text.trim() || word.startMs < lastEnd || word.startMs >= word.endMs || word.endMs > clip.durationMs) throw new Error('Invalid word timing');
        lastEnd = word.endMs;
      }
      if (clip.words.length && clip.words.map(word => word.text).join('') !== clip.text) throw new Error('Word text differs from lyric');
    } else {
      const asset = assets.get(clip.assetId);
      if (!asset || (clip.kind === 'audio' ? asset.kind !== 'audio' : asset.kind === 'audio')) throw new Error('Invalid clip asset');
      if (asset.kind !== 'image' && clip.sourceInMs + clip.durationMs > asset.durationMs + 1) throw new Error('Clip exceeds source bounds');
      if (clip.fadeInMs > clip.durationMs || clip.fadeOutMs > clip.durationMs) throw new Error('Fade exceeds clip duration');
    }
  }
  for (const track of project.tracks) {
    const clips = project.clips.filter(clip => clip.trackId === track.id).sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < clips.length; i++) {
      const active = clips.slice(0, i).filter(clip => clip.startMs + clip.durationMs > clips[i].startMs);
      if (track.kind === 'lyrics' && active.length) throw new Error('Lyrics on the same track cannot overlap');
      if (track.kind === 'visual' && active.length >= 2) throw new Error('Only two visuals per track can crossfade');
    }
  }
  return project;
}

export function migrateTimeline(value: unknown): TimelineProject {
  if ((value as {schemaVersion?: unknown})?.schemaVersion === 2) return parseTimeline(value);
  const legacy = parseProject(value);
  const {audioClips, backgrounds, lines, sourceLyrics, audioFile: _audioFile, ...common} = legacy;
  const visualLayers = [...new Set([0, ...backgrounds.map(clip => clip.layer)])].sort((a, b) => a - b);
  const tracks = [trackSchema.parse({id: 'track:audio', name: 'Song', kind: 'audio'}),
    ...visualLayers.map(layer => trackSchema.parse({id: `track:visual:${layer}`, name: `Layer ${layer + 1}`, kind: 'visual'})),
    trackSchema.parse({id: 'track:lyrics', name: 'Lyrics', kind: 'lyrics'})];
  const clips: Clip[] = [
    ...audioClips.map(clip => ({...clip, kind: 'audio' as const, trackId: 'track:audio'})),
    ...backgrounds.map(clip => ({...clip, kind: 'visual' as const, trackId: `track:visual:${clip.layer}`})),
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
  return parseTimeline({...common, schemaVersion: 2, tracks, clips,
    lyricSource: {text: sourceLyrics, lines: lines.map(line => ({id: line.id, text: line.text, reason: line.reason,
      score: line.score, ...(line.startMs === null && line.style ? {style: line.style} : {})}))}});
}

export function legacyPlacement(project: TimelineProject, id: string): Project['lines'][number] | undefined {
  const clip = project.clips.find(clip => clip.kind === 'lyric' && clip.sourceLineId === id);
  if (clip?.kind === 'lyric') return clip;
  const source = project.lyricSource.lines.find(line => line.id === id);
  return source ? {...source, startMs: null, durationMs: null, words: [], status: 'unmatched'} : undefined;
}
