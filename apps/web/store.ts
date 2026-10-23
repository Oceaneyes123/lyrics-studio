import {create} from 'zustand';
import {changeProject} from '../../packages/editor-core/commands';
import {parseProject, type Project} from '../../packages/project-model/model';

type State = {
  token: string;
  project: Project | null; past: Project[]; future: Project[]; dirty: boolean; version: number;
  open: (project: Project) => void;
  commit: (next: Project) => void;
  edit: (action: (draft: Project) => void) => void;
  saved: (project: Project, version: number) => void;
  undo: () => void; redo: () => void;
};
export const useEditor = create<State>((set, get) => ({
  token: '',
  project: null, past: [], future: [], dirty: false, version: 0,
  open: project => set({project: parseProject(project), past: [], future: [], dirty: false, version: get().version + 1}),
  commit: next => {
    const {project, past, version} = get(); if (!project) return;
    set({project: parseProject(next), past: [...past.slice(-49), project], future: [], dirty: true, version: version + 1});
  },
  edit: action => {const {project, commit} = get(); if (project) commit(changeProject(project, action));},
  saved: (saved, version) => {
    const current = get();
    if (current.project?.id !== saved.id) return;
    set({project: current.version === version ? saved : {...current.project!, revision: saved.revision}, dirty: current.version !== version});
  },
  undo: () => {
    const {past, project, future, version} = get(); if (!past.length || !project) return;
    set({project: {...past.at(-1)!, revision: project.revision}, past: past.slice(0, -1), future: [project, ...future], dirty: true, version: version + 1});
  },
  redo: () => {
    const {past, project, future, version} = get(); if (!future.length || !project) return;
    set({project: {...future[0], revision: project.revision}, past: [...past, project], future: future.slice(1), dirty: true, version: version + 1});
  },
}));

let token = '';
export async function sessionToken() {
  if (!token) {
    const response = await fetch('/api/session');
    if (!response.ok) throw new Error('Start the local API with npm run dev');
    token = (await response.json()).token;
    useEditor.setState({token});
  }
  return token;
}
export async function api<T>(route: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers); headers.set('x-local-token', await sessionToken());
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response = await fetch(`/api${route}`, {...options, headers});
  if (response.status === 403) {
    token = ''; headers.set('x-local-token', await sessionToken());
    response = await fetch(`/api${route}`, {...options, headers});
  }
  if (!response.ok) throw new Error((await response.json().catch(() => ({error: 'Local API unavailable'}))).error);
  return response.json();
}
export type Selection = {kind: 'lyric' | 'audio' | 'video'; id: string} | null;
