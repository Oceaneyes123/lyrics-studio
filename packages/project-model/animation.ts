import {z} from 'zod';

export const animationProperties = ['x', 'y', 'rotation', 'scale', 'opacity', 'fontSize'] as const;
export const propertyBounds = {x: [-100, 100], y: [-100, 100], rotation: [-3600, 3600], scale: [.1, 5], opacity: [0, 1], fontSize: [16, 200]} as const;
export const easingSchema = z.enum(['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out']);
const keySchema = z.object({timeMs: z.number().int().min(-86400000).max(86400000), value: z.number().finite(), easing: easingSchema.default('linear')});
export const colorProperties = ['color', 'activeColor'] as const;
export type ColorProperty = typeof colorProperties[number];
const colorKeySchema = keySchema.extend({value: z.string().regex(/^#[a-f\d]{6}$/i)});
export const animationSchema = z.object({originMs: z.number().int().min(-86400000).max(86400000).default(0),
  colors: z.partialRecord(z.enum(colorProperties), z.array(colorKeySchema).min(1).max(1000)).optional(),
  curves: z.partialRecord(z.enum(animationProperties), z.array(keySchema).min(1).max(1000))}).superRefine((animation, context) => {
  for (const property of animationProperties) {
    const keys = animation.curves[property] ?? [], [min, max] = propertyBounds[property];
    keys.forEach((key, index) => {
      if (key.value < min || key.value > max || index > 0 && key.timeMs <= keys[index - 1].timeMs)
        context.addIssue({code: 'custom', message: 'Keyframes need bounded values and unique increasing times', path: ['curves', property, index]});
    });
  }
  for (const property of colorProperties) (animation.colors?.[property] ?? []).forEach((key, index, keys) => {
    if (index && key.timeMs <= keys[index - 1].timeMs) context.addIssue({code: 'custom', message: 'Color keys need unique increasing times', path: ['colors', property, index]});
  });
});
export type Animation = z.infer<typeof animationSchema>;
export type AnimationProperty = typeof animationProperties[number];
