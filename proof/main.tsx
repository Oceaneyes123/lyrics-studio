import {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Player, type PlayerRef} from '@remotion/player';
import {ProofVideo} from '../packages/video-composition/ProofVideo';
import {durationFrames, parseProofProject, type ProofProject} from '../packages/project-model/proof';

function App({project}: {project: ProofProject}) {
  const player = useRef<PlayerRef>(null);
  const [frame, setFrame] = useState(0);
  const seek = (next: number) => {
    const target = Math.max(0, Math.min(durationFrames(project) - 1, next));
    player.current?.pause();
    player.current?.seekTo(target);
    setFrame(target);
  };
  return <main style={{maxWidth: 1280, margin: '32px auto', fontFamily: 'sans-serif'}}>
    <h1>Lyrics Studio — M0 technical proof</h1>
    <p>Shared preview/export composition. Automatic timings require review.</p>
    <Player ref={player} component={ProofVideo} inputProps={{project}} controls
      compositionWidth={project.width} compositionHeight={project.height}
      durationInFrames={durationFrames(project)} fps={project.fps}
      style={{width: '100%', aspectRatio: `${project.width}/${project.height}`}} />
    <p><label>Frame <input aria-label="Frame" type="number" value={frame} min={0}
      max={durationFrames(project) - 1} onChange={e => seek(Number(e.target.value))} /></label>{' '}
      <button onClick={() => seek((player.current?.getCurrentFrame() ?? frame) - 1)}>Previous frame</button>{' '}
      <button onClick={() => seek((player.current?.getCurrentFrame() ?? frame) + 1)}>Next frame</button></p>
    <p>{project.lines.filter(l => l.startMs !== null).length}/{project.lines.length} timed lines.</p>
    <ul>{project.lines.filter(l => l.startMs === null).map(l => <li key={l.id}>Unmatched: {l.text}</li>)}</ul>
  </main>;
}

const requested = new URLSearchParams(location.search).get('fixture');
const fixture = requested && ['alignment', 'local'].includes(requested) ? requested : 'marker';
fetch(`/${fixture}.project.json`).then(response => {
  if (!response.ok) throw new Error('Prepare the proof fixture first (see README).');
  return response.json();
}).then(parseProofProject).then(project => createRoot(document.getElementById('root')!).render(<App project={project} />))
  .catch(error => {document.getElementById('root')!.textContent = String(error);});
