import {z} from 'zod';
import {styleSchema} from './model';
import {animationSchema, easingSchema} from './animation';

export const textStyleSchema = styleSchema.extend({font: z.union([styleSchema.shape.font, z.string().regex(/^font:[a-f\d-]{36}$/)]).default('Inter')});
export const fontSchema = z.object({id: z.string().uuid(), name: z.string().min(1).max(255),
  file: z.string().regex(/^[a-f\d-]{36}\.(ttf|otf|woff|woff2)$/), hash: z.string().regex(/^[a-f\d]{64}$/),
  attribution: z.string().max(2000).optional()});
const transition = z.object({durationMs: z.number().int().min(0).max(5000).default(0),
  offsetY: z.number().min(-100).max(100).default(0), scale: z.number().min(.1).max(5).default(1), easing: easingSchema.default('ease-out')});
export const textMotionSchema = z.object({
  emphasis: z.object({scale: z.number().min(1).max(2).default(1), offsetY: z.number().min(-100).max(100).default(0)}).default({scale: 1, offsetY: 0}),
  entrance: transition.default({durationMs: 0, offsetY: 0, scale: 1, easing: 'ease-out'}),
  exit: transition.default({durationMs: 0, offsetY: 0, scale: 1, easing: 'ease-out'}),
  reveal: z.enum(['none', 'line', 'accumulate']).default('none'),
});
export const presetSchema = z.object({schemaVersion: z.literal(1), id: z.string().uuid(), name: z.string().trim().min(1).max(80),
  style: textStyleSchema, motion: textMotionSchema.optional(), animation: animationSchema.optional(),
  fontHash: z.string().regex(/^[a-f\d]{64}$/).optional()});
export type TextStyle = z.infer<typeof textStyleSchema>;
export type TextMotion = z.infer<typeof textMotionSchema>;
export type FontAsset = z.infer<typeof fontSchema>;
export type StylePreset = z.infer<typeof presetSchema>;
export const fontFamily = (font: string) => font.startsWith('font:') ? `project-font-${font.slice(5)}` : font;
