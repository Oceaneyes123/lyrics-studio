import type {ReactNode} from 'react';
import type {ObjectTransform} from '../project-model/canvas';
import {transformStyle} from '../editor-core/canvas-transforms';

export function ObjectRenderer({id, transform, children}: {id: string; transform?: ObjectTransform; children: ReactNode}) {
  return <div data-object-id={id} style={transform ? transformStyle(transform) : {position: 'absolute', inset: 0}}>{children}</div>;
}
