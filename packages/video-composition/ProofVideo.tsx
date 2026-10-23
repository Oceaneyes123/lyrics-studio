import {useEffect, useState} from 'react';
import {AbsoluteFill, AnimatedImage, Audio, Img, OffthreadVideo, Sequence, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame} from 'remotion';
import {lineAtFrame, wordProgress, type ProofProject} from '../project-model/proof';
import {msToFrame} from '../project-model/proof';
import type {Project} from '../project-model/model';
import '@fontsource/inter/600.css';

export function usePinnedFont() {
  const [fontHandle] = useState(() => delayRender('Load local Inter font'));
  const [fontError, setFontError] = useState<Error | null>(null);
  useEffect(() => {
    document.fonts.load('600 52px Inter').then(fonts => {
      if (!fonts.length) throw new Error('Bundled Inter font could not be loaded');
      continueRender(fontHandle);
    }).catch(error => {
      const failure = new Error('Bundled Inter font could not be loaded', {cause: error});
      setFontError(failure); cancelRender(failure);
    });
  }, [fontHandle]);
  if (fontError) throw fontError;
}

export function ProofVideo({project, assets = {}}: {project: ProofProject | Project; assets?: Record<string, string>}) {
  const frame = useCurrentFrame(); usePinnedFont();
  const editor = 'assets' in project ? project as Project : null;
  const source = (file: string) => assets[file] ?? staticFile(file);
  const line = lineAtFrame(project, frame);
  const style = editor ? editor.lines.find(l => l.id === line?.id)?.style ?? editor.style : undefined;
  const relativeMs = line?.startMs === null || !line ? 0 : Math.max(0, frame * 1000 / project.fps - line.startMs);
  return (
    <AbsoluteFill data-proof-canvas style={{background: editor?.style.background ?? '#101820', color: style?.color ?? '#eef2f5', fontFamily: style?.font ?? 'Inter', fontWeight: 600,
      alignItems: 'center', justifyContent: 'center', fontSize: style?.fontSize ?? 52, padding: editor ? 0 : 72, textAlign: style?.align ?? 'center'}}>
      {editor ? editor.audioClips.map(clip => {
        const asset = editor.assets.find(a => a.id === clip.assetId)!;
        return <Sequence key={clip.id} from={msToFrame(clip.startMs, project.fps)}
          durationInFrames={Math.max(1, msToFrame(clip.startMs + clip.durationMs, project.fps) - msToFrame(clip.startMs, project.fps))}>
          <Audio src={source(asset.file)} trimBefore={msToFrame(clip.sourceInMs, project.fps)} />
        </Sequence>;
      }) : <Audio src={source(project.audioFile)} />}
      {editor?.backgrounds.slice().sort((a, b) => a.layer - b.layer || a.startMs - b.startMs).map(clip => {
        const asset = editor.assets.find(a => a.id === clip.assetId)!;
        const at = frame * 1000 / project.fps - clip.startMs;
        if (at < 0 || at >= clip.durationMs) return null;
        const opacity = clip.opacity * Math.min(1, clip.fadeInMs ? at / clip.fadeInMs : 1, clip.fadeOutMs ? (clip.durationMs - at) / clip.fadeOutMs : 1);
        const visual = {width: '100%', height: '100%', objectFit: clip.fit,
          transform: `translate(${clip.x}%, ${clip.y}%) scale(${clip.scale})`} as const;
        return <Sequence key={clip.id} from={msToFrame(clip.startMs, project.fps)} durationInFrames={Math.max(1, msToFrame(clip.durationMs, project.fps))}>
          <AbsoluteFill data-visual-layer={clip.layer} style={{overflow: 'hidden', opacity}}>
            {asset.file.endsWith('.gif') ? <AnimatedImage src={source(asset.file)} fit={clip.fit} loop style={visual} /> :
              asset.kind === 'image' ? <Img src={source(asset.file)} style={visual} /> :
              <OffthreadVideo src={source(asset.file)} muted trimBefore={msToFrame(clip.sourceInMs, project.fps)} style={visual} />}
          </AbsoluteFill>
        </Sequence>;
      })}
      <div data-proof-frame={frame} data-line-id={line?.id ?? ''} style={editor ? {
        position: 'absolute', left: `${style!.x}%`, top: `${style!.y}%`, transform: 'translate(-50%, -50%)',
        width: '86%', whiteSpace: 'pre-wrap', textShadow: style!.shadow ? '0 3px 10px #000' : undefined,
        WebkitTextStroke: `${style!.outline}px #000`, paintOrder: 'stroke fill',
        opacity: line && style!.fadeMs ? Math.min(1, relativeMs / style!.fadeMs, (line.durationMs! - relativeMs) / style!.fadeMs) : 1,
      } : {maxWidth: '100%'}}>
        {line?.words.length ? line.words.map((word, i) => {
          const progress = style?.karaoke === 'none' ? 0 : style?.karaoke === 'word' ?
            (relativeMs >= word.startMs ? 1 : 0) : wordProgress(word, relativeMs);
          return <span key={i} data-word-progress={progress.toFixed(4)}
            style={{position: 'relative', display: 'inline-block', whiteSpace: 'pre'}}>
            {word.text}
            <span aria-hidden style={{position: 'absolute', inset: 0, color: style?.activeColor ?? '#86edc6',
              clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`}}>{word.text}</span>
          </span>;
        }) : line?.text}
      </div>
    </AbsoluteFill>
  );
}
