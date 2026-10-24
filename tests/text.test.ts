import {expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import fixtures from './fixtures/v1-projects.json';
import {migrateTimeline, parseTimeline} from '../packages/project-model/timeline';
import {presetSchema, textMotionSchema} from '../packages/project-model/text';
import {applyPreset} from '../packages/editor-core/presets';
import {textEnvelope, wordEmphasis} from '../packages/video-composition/text-motion';
import {animatedColor} from '../packages/video-composition/animation';
import {lines, updateLine} from '../packages/editor-core/timeline-commands';

it('copies presets by value and rebinds font dependencies by content hash', () => {
  const project = migrateTimeline(fixtures[2]), id = randomUUID(), hash = 'a'.repeat(64);
  const preset = presetSchema.parse({schemaVersion: 1, id: randomUUID(), name: 'Imported font', style: {...project.style, font: `font:${randomUUID()}`}, fontHash: hash});
  expect(() => applyPreset(project, preset)).toThrow('original font');
  project.fonts.push({id, name: 'font.woff2', file: `${id}.woff2`, hash});
  const next = applyPreset(project, preset); expect(next.style.font).toBe(`font:${id}`);
  preset.style.fontSize = 100; expect(next.style.fontSize).not.toBe(100);
  expect(() => parseTimeline({...next, fonts: []})).toThrow('font');
});
it('keeps clip template values while unplacing and replacing a lyric', () => {
  const project = migrateTimeline(fixtures[2]), line = lines(project)[0];
  const preset = presetSchema.parse({schemaVersion: 1, id: randomUUID(), name: 'Pulse', style: project.style,
    motion: textMotionSchema.parse({emphasis: {scale: 1.5}}), animation: {curves: {opacity: [{timeMs: 0, value: .5}]}}});
  const next = applyPreset(project, preset, line.id);
  updateLine(next, line.id, l => {l.startMs = l.durationMs = null;});
  expect(lines(parseTimeline(next))[0].textMotion?.emphasis.scale).toBe(1.5);
  updateLine(next, line.id, l => {l.startMs = line.startMs; l.durationMs = line.durationMs; l.words = []; l.status = 'manual';});
  expect(lines(parseTimeline(next))[0].animation?.curves.opacity?.[0].value).toBe(.5);
});
it('uses word intervals and returns to neutral inside gaps', () => {
  const motion = textMotionSchema.parse({emphasis: {scale: 1.5, offsetY: -10}, entrance: {durationMs: 200, offsetY: 20}, exit: {durationMs: 200}});
  expect(wordEmphasis(motion, 500, 0, 1000)).toEqual({scale: 1.5, offsetY: -10});
  expect(wordEmphasis(motion, 1100, 0, 1000)).toEqual({scale: 1, offsetY: 0});
  expect(textEnvelope(motion, 0, 2000)).toMatchObject({opacity: 0, offsetY: 20});
  expect(textEnvelope(motion, 1000, 2000)).toMatchObject({opacity: 1, offsetY: 0});
  expect(textEnvelope(motion, 2000, 2000).opacity).toBe(0);
});
it('samples lyric color curves with the same saved time origin', () => {
  const animation = {originMs: 500, curves: {}, colors: {color: [{timeMs: 0, value: '#000000', easing: 'hold' as const}, {timeMs: 1000, value: '#ffffff', easing: 'linear' as const}]}};
  expect(animatedColor(animation, 'color', 0, '#ff0000')).toMatch(/0,0,0|0, 0, 0|#000000/);
  expect(animatedColor(animation, 'color', 500, '#ff0000')).toBe('#ffffff');
});
it('accepts explicitly supplied word timing when text and placement change together', () => {
  const project = migrateTimeline(fixtures[2]), line = lines(project)[0];
  updateLine(project, line.id, l => {l.text = 'New text'; l.words = [{text: 'New ', startMs: 0, endMs: 300}, {text: 'text', startMs: 400, endMs: 700}];});
  expect(lines(project)[0].words).toHaveLength(2);
});
