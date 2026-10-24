import type {Clip} from '../project-model/timeline';
import {fontFamily} from '../project-model/text';

export function TextObject({clip}: {clip: Extract<Clip, {kind: 'text'}>}) {
  const style = clip.style;
  return <div style={{width: '100%', height: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    color: style.color, fontFamily: fontFamily(style.font), fontSize: style.fontSize, fontWeight: 600,
    textAlign: style.align, background: clip.boxBackground, WebkitTextStroke: `${style.outline}px #000`,
    paintOrder: 'stroke fill', textShadow: style.shadow ? '0 3px 10px #000' : undefined}}>{clip.text}</div>;
}
