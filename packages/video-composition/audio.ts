import type {Clip, TimelineProject} from '../project-model/timeline';
import {msToFrame} from '../project-model/proof';

export const hasAudio = (clip: Clip) => clip.kind === 'audio' || (clip.kind === 'visual' && clip.audioEnabled);
export function audioGain(project: TimelineProject, clip: Clip, atMs: number) {
  if (!hasAudio(clip) || (clip.kind === 'lyric' || clip.kind === 'text')) return 0;
  const track = project.tracks.find(track => track.id === clip.trackId);
  const start = msToFrame(clip.startMs, project.fps) * 1000 / project.fps;
  const end = msToFrame(clip.startMs + clip.durationMs, project.fps) * 1000 / project.fps;
  if (!track || track.muted || clip.muted || atMs < start || atMs >= end) return 0;
  const solo = project.tracks.some(track => track.solo && project.clips.some(c => c.trackId === track.id && hasAudio(c)));
  if (solo && !track.solo) return 0;
  const elapsed = atMs - start;
  const fade = Math.max(0, Math.min(1, clip.fadeInMs ? elapsed / clip.fadeInMs : 1,
    clip.fadeOutMs ? (end - atMs) / clip.fadeOutMs : 1));
  return Math.pow(10, (project.masterGainDb + track.gainDb + clip.gainDb) / 20) * fade;
}
