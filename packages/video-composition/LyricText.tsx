import {useCurrentFrame} from 'remotion';
import {wordProgress, type ProofLine} from '../project-model/proof';
import {fontFamily, type TextMotion, type TextStyle as LyricStyle} from '../project-model/text';
import type {Animation} from '../project-model/animation';
import {animatedColor, animatedValue} from './animation';
import {textEnvelope, wordEmphasis} from './text-motion';

export function LyricText({line, style, fps, animation, motion, boxed = false, objectId, canvasSize}: {line?: Omit<ProofLine, 'words'> & {words: (ProofLine['words'][number] & {untimed?: boolean})[]}; style?: LyricStyle; fps: number; animation?: Animation; motion?: TextMotion; boxed?: boolean; objectId?: string; canvasSize?: {width: number; height: number}}) {
  const frame = useCurrentFrame();
  const relativeMs = line?.startMs === null || !line ? 0 : Math.max(0, frame * 1000 / fps - line.startMs);
  const envelope = textEnvelope(motion, relativeMs, line?.durationMs ?? 1);
  const rows: {text: string; index: number}[][] = [[]];
  line?.words.forEach((word, index) => word.text.split('\n').forEach((text, part) => {
    if (part) rows.push([]); if (text) rows.at(-1)!.push({text, index});
  }));
  function renderWord(text: string, i: number) {
      const word = line!.words[i];
      const progress = word.untimed || style?.karaoke === 'none' ? 0 : style?.karaoke === 'word' ?
        (relativeMs >= word.startMs ? 1 : 0) : wordProgress(word, relativeMs);
      const emphasis = word.untimed ? {scale: 1, offsetY: 0} : wordEmphasis(motion, relativeMs, word.startMs, word.endMs);
      return <span key={i} data-word-progress={progress.toFixed(4)} style={{position: 'relative', display: 'inline-block', whiteSpace: 'pre',
        transform: `translateY(${emphasis.offsetY}px) scale(${emphasis.scale})`}}>
        {text}<span aria-hidden style={{position: 'absolute', inset: 0, color: animatedColor(animation, 'activeColor', relativeMs, style?.activeColor ?? '#86edc6'),
          clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`}}>{text}</span>
      </span>;
  }
  return <div data-object-id={objectId} data-proof-frame={frame} data-line-id={line?.id ?? ''} style={style ? {
    position: 'absolute', left: `${animatedValue(animation, 'x', relativeMs, style.x)}%`, top: `${animatedValue(animation, 'y', relativeMs, style.y)}%`,
    transform: `translate(-50%, -50%) translateY(${envelope.offsetY}px) rotate(${animatedValue(animation, 'rotation', relativeMs, 0)}deg) scale(${animatedValue(animation, 'scale', relativeMs, 1) * envelope.scale})`,
    width: '86%', whiteSpace: 'pre-wrap', textShadow: style.shadow ? '0 3px 10px #000' : undefined,
    WebkitTextStroke: `${style.outline}px #000`, paintOrder: 'stroke fill',
    color: animatedColor(animation, 'color', relativeMs, style.color), fontFamily: fontFamily(style.font), fontSize: animatedValue(animation, 'fontSize', relativeMs, style.fontSize), fontWeight: 600, textAlign: style.align,
    opacity: envelope.opacity * animatedValue(animation, 'opacity', relativeMs, 1) * (line && style.fadeMs ? Math.min(1, relativeMs / style.fadeMs, (line.durationMs! - relativeMs) / style.fadeMs) : 1),
    ...(boxed ? {position: 'relative', left: (animatedValue(animation, 'x', relativeMs, style.x) - style.x) * (canvasSize?.width ?? 0) / 100,
      top: (animatedValue(animation, 'y', relativeMs, style.y) - style.y) * (canvasSize?.height ?? 0) / 100, width: '100%',
      transform: `translateY(${envelope.offsetY}px) rotate(${animatedValue(animation, 'rotation', relativeMs, 0)}deg) scale(${animatedValue(animation, 'scale', relativeMs, 1) * envelope.scale})`, overflowWrap: 'anywhere'} : {}),
  } : {maxWidth: '100%'}}>
    {line?.words.length ? motion?.reveal && motion.reveal !== 'none' ? rows.map((row, i) => {
      const timed = row.map(w => line.words[w.index]).filter(w => !w.untimed);
      const start = Math.min(...timed.map(w => w.startMs)), end = Math.max(...timed.map(w => w.endMs));
      const visible = !timed.length || relativeMs >= start && (motion.reveal === 'accumulate' || relativeMs < end);
      return <span key={i} data-reveal-line={i} style={{display: 'block', minHeight: '1em', visibility: visible ? 'visible' : 'hidden'}}>{row.map(w => renderWord(w.text, w.index))}</span>;
    }) : line.words.map((word, i) => renderWord(word.text, i)) : line?.text}
  </div>;
}
