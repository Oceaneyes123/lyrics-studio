import {z} from 'zod';
import {easingSchema} from './animation';

export const effectsSchema = z.object({brightness: z.number().min(0).max(2).default(1), contrast: z.number().min(0).max(2).default(1),
  saturation: z.number().min(0).max(3).default(1), hue: z.number().min(-180).max(180).default(0), blur: z.number().min(0).max(50).default(0),
  backgroundBlur: z.number().min(0).max(50).default(0),
  mask: z.object({shape: z.enum(['rectangle', 'ellipse']), x: z.number().min(0).max(100).default(0), y: z.number().min(0).max(100).default(0),
    width: z.number().min(1).max(100).default(100), height: z.number().min(1).max(100).default(100)}).refine(m => m.x + m.width <= 100 && m.y + m.height <= 100, 'Mask exceeds canvas').optional(),
});
export const transitionSchema = z.object({id: z.string().uuid(), fromClipId: z.string().min(1).max(160), toClipId: z.string().min(1).max(160),
  type: z.enum(['dissolve', 'slide', 'zoom', 'wipe', 'blur']), durationMs: z.number().int().min(1).max(5000),
  direction: z.enum(['left', 'right', 'up', 'down']).default('left'), amount: z.number().min(0).max(100).default(30),
  easing: easingSchema.default('ease-in-out')});
export type VisualEffects = z.infer<typeof effectsSchema>;
export type VisualTransition = z.infer<typeof transitionSchema>;
