import {AbsoluteFill, AnimatedImage, Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {msToFrame} from '../project-model/proof';
import type {TimelineProject} from '../project-model/timeline';
import {ObjectRenderer} from './ObjectRenderer';
import {TextObject} from './TextObject';
import {objectTransform} from '../editor-core/canvas-transforms';
import {LyricText} from './LyricText';
import {usePinnedFont} from './ProofVideo';
import {audioGain} from './audio';
import {animatedValue} from './animation';
import {useProjectFonts} from './fonts';
import {filterStyle, maskStyle, transitionStyle} from './effects';
import {currentProcessedMix} from '../project-model/audio-processing';

export function TimelineVideo({project, assets = {}}: {project: TimelineProject; assets?: Record<string, string>}) {
  const frame = useCurrentFrame(); usePinnedFont(); useProjectFonts(project.fonts, assets);
  const source = (file: string) => assets[file] ?? staticFile(file);
  const processed = currentProcessedMix(project);
  const activeLyrics = project.clips.filter(clip => clip.kind === 'lyric' &&
    project.tracks.find(track => track.id === clip.trackId)?.visible && frame >= msToFrame(clip.startMs, project.fps) && frame < msToFrame(clip.startMs + clip.durationMs, project.fps));
  return <AbsoluteFill data-proof-canvas style={{background: project.style.background}}>
    {processed && <Audio src={source(processed.file)} volume={1} useWebAudioApi />}
    {project.tracks.map((track, layer) => project.clips.filter(clip => clip.trackId === track.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.startMs - b.startMs).map(clip => {
      const from = msToFrame(clip.startMs, project.fps), duration = Math.max(1, msToFrame(clip.startMs + clip.durationMs, project.fps) - from);
      if (clip.hidden && (clip.kind !== 'visual' || !clip.audioEnabled)) return null;
      if (clip.kind === 'text') return track.visible && frame >= from && frame < from + duration ?
        <ObjectRenderer key={clip.id} id={clip.id} transform={objectTransform(project, clip)}><TextObject clip={clip} /></ObjectRenderer> : null;
      if (clip.kind === 'lyric') return track.visible && frame >= from && frame < from + duration ?
        clip.transform ? <ObjectRenderer key={clip.id} id={clip.id} transform={clip.transform}><div style={{height: '100%', display: 'flex', alignItems: 'center'}}><LyricText boxed canvasSize={project} line={clip} style={clip.style ?? project.style} fps={project.fps} animation={clip.animation} motion={clip.textMotion ?? project.textMotion} /></div></ObjectRenderer> :
        <LyricText key={clip.id} objectId={clip.id} line={clip} style={clip.style ?? project.style} fps={project.fps} animation={clip.animation} motion={clip.textMotion ?? project.textMotion} /> : null;
      const asset = project.assets.find(asset => asset.id === clip.assetId)!;
      const volume = processed ? 0 : audioGain(project, clip, frame * 1000 / project.fps);
      if (clip.kind === 'audio') return processed ? null : <Sequence key={clip.id} from={from} durationInFrames={duration}>
        <Audio src={source(asset.file)} trimBefore={msToFrame(clip.sourceInMs, project.fps)} volume={volume} useWebAudioApi />
      </Sequence>;
      if ((!track.visible && !clip.audioEnabled) || frame < from || frame >= from + duration) return null;
      const at = Math.max(0, frame * 1000 / project.fps - clip.startMs);
      const value = (property: 'x' | 'y' | 'rotation' | 'scale' | 'opacity') => animatedValue(clip.animation, property, at, clip.transform ? (property === 'scale' || property === 'opacity' ? 1 : 0) : clip[property]);
      const opacity = value('opacity') * Math.min(1, clip.fadeInMs ? at / clip.fadeInMs : 1, clip.fadeOutMs ? (clip.durationMs - at) / clip.fadeOutMs : 1);
      const visual = {width: '100%', height: '100%', objectFit: clip.transform?.fit ?? clip.fit, transform: `translate(${value('x')}%, ${value('y')}%) rotate(${value('rotation')}deg) scale(${value('scale')})`} as const;
      const transitions = project.transitions.filter(t => t.fromClipId === clip.id || t.toClipId === clip.id).map(t =>
        transitionStyle(t, frame * 1000 / project.fps - project.clips.find(c => c.id === t.toClipId)!.startMs, t.toClipId === clip.id));
      const media = (background = false) => {
        const style = background ? {...visual, objectFit: 'cover' as const, transform: 'scale(1.04)'} : visual;
        return asset.file.endsWith('.gif') ? <AnimatedImage src={source(asset.file)} fit={background ? 'cover' : clip.transform?.fit ?? clip.fit} loop style={style} /> :
          asset.kind === 'image' ? <Img src={source(asset.file)} style={style} /> :
            <OffthreadVideo src={source(asset.file)} muted={background || volume === 0} volume={background ? 0 : volume} useWebAudioApi trimBefore={msToFrame(clip.sourceInMs, project.fps)} style={style} />;
      };
      return <Sequence key={clip.id} from={from} durationInFrames={duration}>
        <ObjectRenderer id={clip.id} transform={clip.transform}><AbsoluteFill data-visual-layer={layer} style={{overflow: 'hidden', opacity: track.visible && !clip.hidden ? opacity * transitions.reduce((value, t) => value * t.opacity, 1) : 0,
          transform: transitions.map(t => t.transform).join(' '), filter: transitions.map(t => t.filter).filter(Boolean).join(' ') || undefined,
          clipPath: transitions.find(t => t.clipPath)?.clipPath}}>
          <AbsoluteFill style={{clipPath: maskStyle(clip.effects?.mask)}}>
            {Boolean(clip.effects?.backgroundBlur) && <AbsoluteFill style={{filter: filterStyle({...clip.effects!, blur: clip.effects!.backgroundBlur})}}>{media(true)}</AbsoluteFill>}
            <AbsoluteFill style={{filter: filterStyle(clip.effects)}}>{media()}</AbsoluteFill>
          </AbsoluteFill>
        </AbsoluteFill></ObjectRenderer>
      </Sequence>;
    }))}
    {!activeLyrics.length && <LyricText style={project.style} fps={project.fps} />}
  </AbsoluteFill>;
}
