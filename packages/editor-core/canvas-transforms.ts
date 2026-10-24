import {transformSchema, type ObjectTransform} from '../project-model/canvas';
import {msToFrame} from '../project-model/proof';
import type {Clip, TimelineProject} from '../project-model/timeline';

export type CanvasClip = Exclude<Clip, {kind: 'audio'}>;
export function objectTransform(project: TimelineProject, clip: CanvasClip): ObjectTransform {
  if (clip.transform) return clip.transform;
  if (clip.kind === 'visual') return transformSchema.parse({
    x: project.width * (clip.x / 100 + (1 - clip.scale) / 2),
    y: project.height * (clip.y / 100 + (1 - clip.scale) / 2),
    width: project.width * clip.scale, height: project.height * clip.scale, rotation: clip.rotation,
    opacity: clip.opacity, fit: clip.fit,
  });
  const style = clip.style ?? project.style, width = project.width * .86;
  const height = style.fontSize * 1.4 * clip.text.split('\n').length;
  return transformSchema.parse({x: project.width * style.x / 100 - width / 2,
    y: project.height * style.y / 100 - height / 2, width, height});
}
export function visibleObjects(project: TimelineProject, frame: number): CanvasClip[] {
  return project.tracks.filter(t => t.visible).flatMap(t => project.clips.filter((c): c is CanvasClip =>
    c.kind !== 'audio' && c.trackId === t.id && !c.hidden && frame >= msToFrame(c.startMs, project.fps) &&
    frame < msToFrame(c.startMs + c.durationMs, project.fps)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.startMs - b.startMs));
}
export function remapCanvas(project: TimelineProject, width: number, height: number) {
  const sx = width / project.width, sy = height / project.height;
  for (const clip of project.clips) if (clip.transform) {
    const t = clip.transform; t.x *= sx; t.y *= sy; t.width *= sx; t.height *= sy;
  }
  project.width = width; project.height = height;
}
export function transformStyle(t: ObjectTransform) {
  return {position: 'absolute' as const, left: t.x, top: t.y, width: t.width, height: t.height,
    opacity: t.opacity, transformOrigin: `${t.anchorX * 100}% ${t.anchorY * 100}%`,
    transform: `rotate(${t.rotation}deg) scale(${t.scaleX * (t.flipX ? -1 : 1)}, ${t.scaleY * (t.flipY ? -1 : 1)})`};
}
