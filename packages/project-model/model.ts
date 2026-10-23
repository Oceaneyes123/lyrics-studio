import {z} from 'zod';
import {msToFrame, parseProofProject, type ProofLine} from './proof';

const ms = z.number().int().min(0).max(24 * 60 * 60 * 1000);
const id = z.string().uuid();
const color = z.string().regex(/^#[\da-f]{6}$/i);
export const styleSchema = z.object({
  font: z.enum(['Inter', 'Georgia', 'Arial']).default('Inter'),
  fontSize: z.number().min(16).max(200).default(52),
  color: color.default('#eef2f5'), activeColor: color.default('#86edc6'),
  background: color.default('#17212d'),
  align: z.enum(['left', 'center', 'right']).default('center'),
  x: z.number().min(0).max(100).default(50), y: z.number().min(5).max(95).default(72),
  outline: z.number().min(0).max(8).default(1), shadow: z.boolean().default(true),
  karaoke: z.enum(['none', 'word', 'progressive']).default('progressive'),
  fadeMs: ms.max(3000).default(0),
});
export const assetSchema = z.object({
  id, name: z.string().min(1).max(255),
  file: z.string().regex(/^[a-f\d-]+\.(wav|mp3|mp4|png|jpg|gif)$/),
  kind: z.enum(['audio', 'video', 'image']), durationMs: ms,
  width: z.number().int().nonnegative(), height: z.number().int().nonnegative(),
  hash: z.string().regex(/^[a-f\d]{64}$/),
});
export const clipSchema = z.object({
  id, assetId: id, startMs: ms, durationMs: ms.min(1), sourceInMs: ms,
  fit: z.enum(['cover', 'contain']).default('cover'),
  scale: z.number().min(.1).max(5).default(1),
  x: z.number().min(-100).max(100).default(0), y: z.number().min(-100).max(100).default(0),
  fadeInMs: ms.default(0), fadeOutMs: ms.default(0),
  layer: z.number().int().min(0).max(499).default(0),
  opacity: z.number().min(0).max(1).default(1),
});
export const lineSchema = z.object({
  id: z.string().min(1).max(120), text: z.string().min(1).max(2000),
  sourceId: z.string().max(120).optional(),
  status: z.enum(['manual', 'review', 'unmatched']), startMs: ms.nullable(), durationMs: ms.min(1).nullable(),
  words: z.array(z.object({text: z.string().min(1).max(2000), startMs: ms, endMs: ms})).max(500),
  reason: z.string().max(1000).optional(), score: z.number().min(0).max(1).optional(),
  style: styleSchema.optional(),
});
export const projectSchema = z.object({
  schemaVersion: z.literal(1), id, name: z.string().trim().min(1).max(120), revision: z.number().int().nonnegative(),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
  width: z.number().int().min(64).max(4096), height: z.number().int().min(64).max(4096),
  durationMs: ms.min(100), audioFile: z.string().max(255), sourceLyrics: z.string().max(100000),
  assets: z.array(assetSchema).max(300), audioClips: z.array(clipSchema).max(500),
  backgrounds: z.array(clipSchema).max(500), lines: z.array(lineSchema).max(2000), style: styleSchema,
});
export type Project = z.infer<typeof projectSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type MediaClip = z.infer<typeof clipSchema>;
export type LyricStyle = z.infer<typeof styleSchema>;

export function parseProject(value: unknown): Project {
  const p = projectSchema.parse(value);
  parseProofProject({...p, audioFile: p.audioFile || 'empty.wav'});
  if (new Set(p.assets.map(a => a.id)).size !== p.assets.length) throw new Error('Duplicate asset');
  const clipIds = new Set<string>();
  for (const [clips, audio] of [[p.audioClips, true], [p.backgrounds, false]] as const) {
    const sorted = [...clips].sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i], asset = p.assets.find(a => a.id === c.assetId);
      if (clipIds.has(c.id)) throw new Error('Duplicate clip');
      clipIds.add(c.id);
      if (!asset || (audio ? asset.kind !== 'audio' : asset.kind === 'audio')) throw new Error('Invalid clip asset');
      if (c.startMs + c.durationMs > p.durationMs ||
        (asset.kind !== 'image' && c.sourceInMs + c.durationMs > asset.durationMs + 1)) throw new Error('Clip exceeds media/project bounds');
      if (msToFrame(c.startMs + c.durationMs, p.fps) <= msToFrame(c.startMs, p.fps)) throw new Error('Clip must span at least one frame');
      if (c.fadeInMs > c.durationMs || c.fadeOutMs > c.durationMs) throw new Error('Fade exceeds clip duration');
      if (audio && i && sorted[i - 1].startMs + sorted[i - 1].durationMs > c.startMs) throw new Error('Audio clips cannot overlap');
      if (!audio && sorted.slice(0, i).filter(other => other.layer === c.layer && other.startMs + other.durationMs > c.startMs).length >= 2) throw new Error('Only two backgrounds per layer can crossfade');
    }
  }
  return p;
}

export function newProject(identity: string): Project {
  return parseProject({schemaVersion: 1, id: identity, name: 'Untitled lyric video', revision: 0,
    fps: 30, width: 1280, height: 720, durationMs: 30000, audioFile: '', sourceLyrics: '',
    assets: [], audioClips: [], backgrounds: [], lines: [], style: styleSchema.parse({})});
}

export function lyricLines(text: string): ProofLine[] {
  return text.split(/\r?\n/).flatMap((line, index) => !line.trim() || /^\s*(#|\[[^\]]+\]\s*$)/.test(line) ? [] :
    [{id: `line-${index + 1}`, text: line, startMs: null, durationMs: null, status: 'unmatched' as const, words: []}]);
}
