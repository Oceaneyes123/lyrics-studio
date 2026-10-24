import {z} from 'zod';

// Positions describe the unrotated top-left in project pixels; scale never changes the layout box.
export const transformSchema = z.object({
  x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000),
  width: z.number().positive().max(100000), height: z.number().positive().max(100000),
  rotation: z.number().min(-36000).max(36000).default(0),
  scaleX: z.number().min(.001).max(100).default(1), scaleY: z.number().min(.001).max(100).default(1),
  anchorX: z.number().min(0).max(1).default(.5), anchorY: z.number().min(0).max(1).default(.5),
  opacity: z.number().min(0).max(1).default(1), flipX: z.boolean().default(false), flipY: z.boolean().default(false),
  fit: z.enum(['cover', 'contain']).default('contain'),
});
export type ObjectTransform = z.infer<typeof transformSchema>;
