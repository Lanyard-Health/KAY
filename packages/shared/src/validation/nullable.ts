import { z } from 'zod';

/**
 * Wraps every field in a .partial() schema to also accept null → undefined.
 * Use this instead of schema.partial() for update endpoints where the frontend
 * may send null for cleared fields.
 *
 * The generic signature preserves the original schema's named property types
 * so consumers can access parsed fields with dot notation.
 */
export function nullablePartial<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): ReturnType<z.ZodObject<T>['partial']> {
  const partial = schema.partial();
  const nullableShape: Record<string, z.ZodTypeAny> = {};
  for (const [key, field] of Object.entries(partial.shape)) {
    nullableShape[key] = z.union([field as z.ZodTypeAny, z.null()])
      .optional()
      .transform(val => val === null ? undefined : val);
  }
  // Runtime: each field accepts null and transforms it to undefined.
  // Type: matches schema.partial() — null→undefined is transparent to callers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return z.object(nullableShape) as any;
}
