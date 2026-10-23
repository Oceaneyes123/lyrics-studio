import {createRoot} from 'react-dom/client';
import {createRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {ProofVideo} from '../packages/video-composition/ProofVideo';
import {newProject, type Project} from '../packages/project-model/model';
import {durationFrames} from '../packages/project-model/proof';

const player = createRef<PlayerRef>();
declare global {
  interface Window {
    acceptance: {load: (project: Project) => void; seek: (frame: number) => void};
  }
}
function Harness() {
  const [project, setProject] = useState(newProject('00000000-0000-4000-8000-000000000000'));
  window.acceptance = {load: setProject, seek: frame => player.current!.seekTo(frame)};
  return <Player ref={player} component={ProofVideo} inputProps={{project}}
    compositionWidth={project.width} compositionHeight={project.height} durationInFrames={durationFrames(project)}
    fps={project.fps} style={{width: project.width, height: project.height}} />;
}
createRoot(document.getElementById('root')!).render(<Harness />);
