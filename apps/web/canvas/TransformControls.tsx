import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import Moveable, {type OnDrag, type OnResize, type OnRotate} from 'react-moveable';
import type {ObjectTransform} from '../../../packages/project-model/canvas';
import type {TimelineProject} from '../../../packages/project-model/timeline';
import {objectTransform, type CanvasClip} from '../../../packages/editor-core/canvas-transforms';

export function TransformControls({project, clips, root, snapping, ratio, scale, start, preview, finish, constrainRotation}: {
  project: TimelineProject; clips: CanvasClip[]; root: HTMLDivElement | null; snapping: boolean; ratio: boolean; scale: number;
  constrainRotation: boolean;
  start: () => void; preview: (values: Record<string, ObjectTransform>) => void; finish: (cancel?: boolean) => void;
}) {
  const moveable = useRef<Moveable>(null), originals = useRef<Record<string, ObjectTransform>>({});
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {if (e.key === 'Escape') {finish(true); moveable.current?.stopDrag();}};
    const pointerCancel = () => {finish(true); moveable.current?.stopDrag();};
    window.addEventListener('keydown', cancel); window.addEventListener('pointercancel', pointerCancel);
    return () => {window.removeEventListener('keydown', cancel); window.removeEventListener('pointercancel', pointerCancel);};
  });
  const ids = clips.map(c => c.id).join('|');
  useLayoutEffect(() => {
    setTargets(Array.from(root?.querySelectorAll<HTMLElement>('[data-canvas-id]') ?? []).filter(el => clips.some(c => c.id === el.dataset.canvasId)));
  }, [root, ids]);
  useLayoutEffect(() => {moveable.current?.updateRect();}, [project, scale]);
  const begin = () => {originals.current = Object.fromEntries(clips.map(c => [c.id, objectTransform(project, c)])); start();};
  const id = (target: HTMLElement | SVGElement) => (target as HTMLElement).dataset.canvasId!;
  const drag = (events: OnDrag[]) => preview(Object.fromEntries(events.map(e => {
    const key = id(e.target), t = originals.current[key];
    return [key, {...t, x: t.x + e.beforeTranslate[0], y: t.y + e.beforeTranslate[1]}];
  })));
  const resize = (events: OnResize[]) => preview(Object.fromEntries(events.map(e => {
    const key = id(e.target), t = originals.current[key];
    return [key, {...t, width: Math.max(1, e.width), height: Math.max(1, e.height), x: t.x + e.drag.beforeTranslate[0], y: t.y + e.drag.beforeTranslate[1]}];
  })));
  const rotate = (events: OnRotate[]) => preview(Object.fromEntries(events.map(e => {
    const key = id(e.target), t = originals.current[key];
    return [key, {...t, rotation: e.beforeRotate, x: t.x + e.drag.beforeTranslate[0], y: t.y + e.drag.beforeTranslate[1]}];
  })));
  return <Moveable flushSync={flushSync} ref={moveable} target={targets.length === 1 ? targets[0] : targets} passDragArea dragTarget={targets.length > 1 ? root : undefined} draggable resizable rotatable origin={false} rotationPosition="bottom" zoom={1 / scale}
    keepRatio={ratio} throttleRotate={constrainRotation ? 45 : 1} snappable={snapping} snapDirections={{left: true, right: true, top: true, bottom: true, center: true, middle: true}}
    elementSnapDirections={{left: true, right: true, top: true, bottom: true, center: true, middle: true}}
    verticalGuidelines={[0, project.width / 2, project.width]} horizontalGuidelines={[0, project.height / 2, project.height]}
    elementGuidelines={Array.from(root?.querySelectorAll<HTMLElement>('[data-canvas-id]') ?? []).filter(el => !targets.includes(el))}
    snapThreshold={6 / scale} snapRotationDegrees={[0, 45, 90, 135, 180, 225, 270, 315]} snapRotationThreshold={5}
    onDragStart={e => {begin(); e.set([0, 0]);}} onDrag={e => drag([e])} onDragEnd={() => finish()}
    onResizeStart={e => {begin(); e.dragStart && e.dragStart.set([0, 0]);}}
    onResize={e => resize([e])} onResizeEnd={() => finish()}
    onRotateStart={e => {begin(); e.set(originals.current[id(e.target)].rotation); e.dragStart && e.dragStart.set([0, 0]);}}
    onRotate={e => rotate([e])} onRotateEnd={() => finish()}
    onDragGroupStart={e => {
      const input = e.inputEvent as PointerEvent;
      if (input.ctrlKey || input.metaKey || !clips.some(c => c.id === (input.target as HTMLElement).dataset.canvasId)) return false;
      begin(); e.events.forEach(event => event.set([0, 0]));
    }}
    onDragGroup={e => drag(e.events)} onDragGroupEnd={() => finish()}
    onResizeGroupStart={e => {begin(); e.events.forEach(event => {event.dragStart && event.dragStart.set([0, 0]);});}}
    onResizeGroup={e => resize(e.events)} onResizeGroupEnd={() => finish()}
    onRotateGroupStart={e => {begin(); e.events.forEach(event => {event.set(originals.current[id(event.target)].rotation); event.dragStart && event.dragStart.set([0, 0]);});}}
    onRotateGroup={e => rotate(e.events)} onRotateGroupEnd={() => finish()} />;
}
