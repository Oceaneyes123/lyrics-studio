import type {ObjectTransform} from '../../../packages/project-model/canvas';
import type {TimelineProject} from '../../../packages/project-model/timeline';
import {objectTransform, transformStyle, type CanvasClip} from '../../../packages/editor-core/canvas-transforms';

export function CanvasObject({project, clip, selected, live, select, editText}: {
  project: TimelineProject; clip: CanvasClip; selected: boolean; live?: ObjectTransform;
  select: (clip: CanvasClip, toggle?: boolean) => void; editText: (clip: CanvasClip) => void;
}) {
  const locked = clip.locked || project.tracks.find(t => t.id === clip.trackId)?.locked;
  return <div data-canvas-id={clip.id} role="button" tabIndex={0}
    aria-label={`Canvas ${clip.kind === 'visual' ? project.assets.find(a => a.id === clip.assetId)?.name : clip.text}`}
    aria-pressed={selected} aria-disabled={locked}
    className={`canvas-object ${selected ? 'selected' : ''} ${locked ? 'locked' : ''}`}
    style={{...transformStyle(live ?? objectTransform(project, clip)), opacity: 1}}
    onPointerDown={e => {if (!selected || e.ctrlKey || e.metaKey) select(clip, e.ctrlKey || e.metaKey);}}
    onDoubleClick={() => {if (!locked && clip.kind !== 'visual') editText(clip);}}
    onKeyDown={e => {if (e.key === 'Enter') {e.preventDefault(); select(clip, e.ctrlKey || e.metaKey);}}} />;
}
