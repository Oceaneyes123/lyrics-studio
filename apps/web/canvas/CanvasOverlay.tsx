import type {ObjectTransform} from '../../../packages/project-model/canvas';
import type {TimelineProject} from '../../../packages/project-model/timeline';
import type {CanvasClip} from '../../../packages/editor-core/canvas-transforms';
import {CanvasObject} from './CanvasObject';

export function CanvasOverlay({project, objects, selectedIds, live, select, editText, setRoot}: {
  project: TimelineProject; objects: CanvasClip[]; selectedIds: string[]; live: Record<string, ObjectTransform>;
  select: (clip: CanvasClip | null, toggle?: boolean) => void; editText: (clip: CanvasClip) => void;
  setRoot: (root: HTMLDivElement | null) => void;
}) {
  return <div ref={setRoot} className="canvas-overlay" onPointerDown={e => {if (e.target === e.currentTarget) select(null);}}>
    {objects.map(clip => <CanvasObject key={clip.id} {...{project, clip, select, editText}} selected={selectedIds.includes(clip.id)} live={live[clip.id]} />)}
  </div>;
}
