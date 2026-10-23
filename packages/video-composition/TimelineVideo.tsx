import {AbsoluteFill, AnimatedImage, Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {msToFrame} from '../project-model/proof';
import type {TimelineProject} from '../project-model/timeline';
import {LyricText} from './LyricText';
import {usePinnedFont} from './ProofVideo';

export function TimelineVideo({project, assets = {}}: {project: TimelineProject; assets?: Record<string, string>}) {
  const frame = useCurrentFrame(); usePinnedFont();
  const source = (file: string) => assets[file] ?? staticFile(file);
  const activeLyrics = project.clips.filter(clip => clip.kind === 'lyric' &&
    project.tracks.find(track => track.id === clip.trackId)?.visible && frame >= msToFrame(clip.startMs, project.fps) && frame < msToFrame(clip.startMs + clip.durationMs, project.fps));
  return <AbsoluteFill data-proof-canvas style={{background: project.style.background}}>
    {project.tracks.map((track, layer) => project.clips.filter(clip => clip.trackId === track.id).map(clip => {
      const from = msToFrame(clip.startMs, project.fps), duration = Math.max(1, msToFrame(clip.startMs + clip.durationMs, project.fps) - from);
      if (clip.kind === 'lyric') return track.visible && frame >= from && frame < from + duration ?
        <LyricText key={clip.id} line={clip} style={clip.style ?? project.style} fps={project.fps} /> : null;
      const asset = project.assets.find(asset => asset.id === clip.assetId)!;
      if (clip.kind === 'audio') return track.muted ? null : <Sequence key={clip.id} from={from} durationInFrames={duration}>
        <Audio src={source(asset.file)} trimBefore={msToFrame(clip.sourceInMs, project.fps)} />
      </Sequence>;
      if (!track.visible || frame < from || frame >= from + duration) return null;
      const at = frame * 1000 / project.fps - clip.startMs;
      const opacity = clip.opacity * Math.min(1, clip.fadeInMs ? at / clip.fadeInMs : 1, clip.fadeOutMs ? (clip.durationMs - at) / clip.fadeOutMs : 1);
      const visual = {width: '100%', height: '100%', objectFit: clip.fit, transform: `translate(${clip.x}%, ${clip.y}%) scale(${clip.scale})`} as const;
      return <Sequence key={clip.id} from={from} durationInFrames={duration}>
        <AbsoluteFill data-visual-layer={layer} style={{overflow: 'hidden', opacity}}>
          {asset.file.endsWith('.gif') ? <AnimatedImage src={source(asset.file)} fit={clip.fit} loop style={visual} /> :
            asset.kind === 'image' ? <Img src={source(asset.file)} style={visual} /> :
              <OffthreadVideo src={source(asset.file)} muted trimBefore={msToFrame(clip.sourceInMs, project.fps)} style={visual} />}
        </AbsoluteFill>
      </Sequence>;
    }))}
    {!activeLyrics.length && <LyricText style={project.style} fps={project.fps} />}
  </AbsoluteFill>;
}
