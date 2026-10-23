import {useCurrentFrame} from 'remotion';
import {wordProgress, type ProofLine} from '../project-model/proof';
import type {LyricStyle} from '../project-model/model';

export function LyricText({line, style, fps}: {line?: ProofLine; style?: LyricStyle; fps: number}) {
  const frame = useCurrentFrame();
  const relativeMs = line?.startMs === null || !line ? 0 : Math.max(0, frame * 1000 / fps - line.startMs);
  return <div data-proof-frame={frame} data-line-id={line?.id ?? ''} style={style ? {
    position: 'absolute', left: `${style.x}%`, top: `${style.y}%`, transform: 'translate(-50%, -50%)',
    width: '86%', whiteSpace: 'pre-wrap', textShadow: style.shadow ? '0 3px 10px #000' : undefined,
    WebkitTextStroke: `${style.outline}px #000`, paintOrder: 'stroke fill',
    color: style.color, fontFamily: style.font, fontSize: style.fontSize, fontWeight: 600, textAlign: style.align,
    opacity: line && style.fadeMs ? Math.min(1, relativeMs / style.fadeMs, (line.durationMs! - relativeMs) / style.fadeMs) : 1,
  } : {maxWidth: '100%'}}>
    {line?.words.length ? line.words.map((word, i) => {
      const progress = style?.karaoke === 'none' ? 0 : style?.karaoke === 'word' ?
        (relativeMs >= word.startMs ? 1 : 0) : wordProgress(word, relativeMs);
      return <span key={i} data-word-progress={progress.toFixed(4)} style={{position: 'relative', display: 'inline-block', whiteSpace: 'pre'}}>
        {word.text}<span aria-hidden style={{position: 'absolute', inset: 0, color: style?.activeColor ?? '#86edc6',
          clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`}}>{word.text}</span>
      </span>;
    }) : line?.text}
  </div>;
}
