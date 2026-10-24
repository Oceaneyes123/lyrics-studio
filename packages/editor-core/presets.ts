import {changeTimeline, updateLine} from './timeline-commands';
import type {TimelineProject} from '../project-model/timeline';
import type {StylePreset} from '../project-model/text';

export function applyPreset(project: TimelineProject, preset: StylePreset, lineId?: string) {
  const style = structuredClone(preset.style);
  if (style.font.startsWith('font:')) {
    const font = project.fonts.find(f => f.hash === preset.fontHash);
    if (!font) throw new Error('Import this preset’s original font into the project first');
    style.font = `font:${font.id}`;
  }
  return changeTimeline(project, draft => {
    if (lineId) updateLine(draft, lineId, line => {
      line.style = style; line.textMotion = structuredClone(preset.motion); line.animation = structuredClone(preset.animation);
    });
    else {
      if (preset.animation) throw new Error('Select a lyric line to apply a preset with clip keyframes');
      draft.style = style; draft.textMotion = structuredClone(preset.motion);
    }
  });
}
