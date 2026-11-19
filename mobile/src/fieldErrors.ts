import { ApiError } from '@/api/client';

/** API field errors ({phone: 'invalid_phone'}) → translated messages for the form. */
export function fieldErrors(err: unknown, t: (k: string) => string): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(err.fields)) {
    if (typeof v === 'string') out[k] = t(`fields.${v}`);
  }
  return out;
}
