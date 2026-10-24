import {z} from 'zod';
import type {TimelineProject} from './timeline';

export const duckingSchema = z.object({triggerTrackId: z.string().min(1), targetTrackIds: z.array(z.string().min(1)).min(1).max(1000),
  thresholdDb: z.number().min(-60).max(0).default(-30), reductionDb: z.number().min(0).max(30).default(12),
  attackMs: z.number().int().min(1).max(2000).default(30), releaseMs: z.number().int().min(1).max(5000).default(300)});
export const normalizationSchema = z.object({integratedLufs: z.number().min(-36).max(-5).default(-16),
  truePeakDb: z.number().min(-9).max(-1).default(-1.5), loudnessRange: z.number().min(1).max(20).default(11)});
export const audioProcessingSchema = z.object({ducking: duckingSchema.optional(), normalization: normalizationSchema.optional()});
export const loudnessSchema = z.object({integratedLufs: z.number().finite().nullable(), truePeakDb: z.number().finite().nullable(),
  loudnessRange: z.number().finite().nullable()});
export const processedMixSchema = z.object({id: z.string().regex(/^[a-f\d]{64}$/), key: z.string().regex(/^[a-f\d]{64}$/),
  file: z.string().regex(/^[a-f\d]{64}\.wav$/), hash: z.string().regex(/^[a-f\d]{64}$/),
  signature: z.string().max(1000000), before: loudnessSchema, after: loudnessSchema,
  envelope: z.object({stepMs: z.literal(10), windows: z.number().int().nonnegative(), maxReductionDb: z.number().min(0).max(30)}).optional(),
}).refine(mix => mix.id === mix.key && mix.file === `${mix.key}.wav`, 'Invalid processed mix identity');
export type Ducking = z.infer<typeof duckingSchema>;
export type ProcessedMix = z.infer<typeof processedMixSchema>;
export type Loudness = z.infer<typeof loudnessSchema>;
export const processingEnabled = (project: TimelineProject) => Boolean(project.audioProcessing?.ducking || project.audioProcessing?.normalization);
export function mixSignature(project: TimelineProject) {
  const clips = project.clips.filter(c => c.kind === 'audio' || c.kind === 'visual' && c.audioEnabled).map(clip => {
    if ((clip.kind === 'lyric' || clip.kind === 'text')) throw new Error('Expected audio source');
    return {id: clip.id, trackId: clip.trackId, assetId: clip.assetId, hash: project.assets.find(a => a.id === clip.assetId)?.hash,
      startMs: clip.startMs, durationMs: clip.durationMs, sourceInMs: clip.sourceInMs, gainDb: clip.gainDb, muted: clip.muted,
      fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs};
  }).sort((a, b) => a.id.localeCompare(b.id));
  const trackIds = new Set(clips.map(c => c.trackId));
  const tracks = project.tracks.filter(t => trackIds.has(t.id)).map(({id, gainDb, muted, solo}) => ({id, gainDb, muted, solo})).sort((a, b) => a.id.localeCompare(b.id));
  const settings = project.audioProcessing;
  return JSON.stringify({version: 1, durationMs: project.durationMs, fps: project.fps, masterGainDb: project.masterGainDb, clips, tracks,
    ducking: settings?.ducking ? {...settings.ducking, targetTrackIds: [...settings.ducking.targetTrackIds].sort()} : undefined, normalization: settings?.normalization});
}
export const currentProcessedMix = (project: TimelineProject) => processingEnabled(project) && project.processedMix?.signature === mixSignature(project) ? project.processedMix : undefined;
export function duckingEnvelope(rms: number[], settings: Ducking) {
  let reduction = 0;
  return rms.map(value => {
    const target = value > Math.pow(10, settings.thresholdDb / 20) ? settings.reductionDb : 0;
    const time = target > reduction ? settings.attackMs : settings.releaseMs;
    reduction += (target - reduction) * (1 - Math.exp(-Math.LN10 * 10 / time));
    return Math.max(0, Math.min(settings.reductionDb, reduction));
  });
}
