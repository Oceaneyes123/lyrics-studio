import {createRoot} from 'react-dom/client';
import {createRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {TimelineVideo} from '../packages/video-composition/TimelineVideo';
import {newProject} from '../packages/project-model/model';
import {migrateTimeline, type TimelineProject} from '../packages/project-model/timeline';
import {durationFrames} from '../packages/project-model/proof';

const player = createRef<PlayerRef>();
declare global {interface Window {advancedVisual: {load: (props: {project: TimelineProject; assets?: Record<string, string>}) => void; seek: (frame: number) => void}}}
function Harness() {
  const [props, setProps] = useState<{project: TimelineProject; assets?: Record<string, string>}>({project: migrateTimeline(newProject('00000000-0000-4000-8000-000000000000'))});
  window.advancedVisual = {load: setProps, seek: frame => player.current!.seekTo(frame)};
  return <Player ref={player} component={TimelineVideo} inputProps={props} compositionWidth={props.project.width}
    compositionHeight={props.project.height} durationInFrames={durationFrames(props.project)} fps={props.project.fps}
    style={{width: props.project.width, height: props.project.height}} />;
}
createRoot(document.getElementById('root')!).render(<Harness />);
