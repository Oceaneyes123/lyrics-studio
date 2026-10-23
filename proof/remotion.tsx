import {Composition, registerRoot} from 'remotion';
import {ProofVideo} from '../packages/video-composition/ProofVideo';
import {durationFrames, parseProofProject} from '../packages/project-model/proof';

const fallback = parseProofProject({schemaVersion: 1, id: 'empty', fps: 30, width: 1280,
  height: 720, durationMs: 1000, audioFile: 'marker.wav', lines: []});

function Root() {
  return <Composition id="LyricsProof" component={ProofVideo} defaultProps={{project: fallback}}
    width={1280} height={720} fps={30} durationInFrames={30}
    calculateMetadata={({props}) => {
      const project = parseProofProject(props.project);
      return {width: project.width, height: project.height, fps: project.fps,
        durationInFrames: durationFrames(project), props: {project}};
    }} />;
}
registerRoot(Root);
