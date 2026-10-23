import {Composition, registerRoot} from 'remotion';
import {TimelineVideo} from '../../packages/video-composition/TimelineVideo';
import {newProject} from '../../packages/project-model/model';
import {migrateTimeline} from '../../packages/project-model/timeline';
import {durationFrames} from '../../packages/project-model/proof';
const fallback = migrateTimeline(newProject('00000000-0000-4000-8000-000000000000'));
function Root() {
  return <Composition id="LyricsEditor" component={TimelineVideo} defaultProps={{project: fallback, assets: {} as Record<string, string>}}
    width={1280} height={720} fps={30} durationInFrames={900}
    calculateMetadata={({props}) => {
      const project = migrateTimeline(props.project);
      return {width: project.width, height: project.height, fps: project.fps,
        durationInFrames: durationFrames(project), props: {...props, project}};
    }} />;
}
registerRoot(Root);
