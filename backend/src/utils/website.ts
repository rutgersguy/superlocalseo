import { z } from 'zod';

/** Accept familiar domain/path input while storing an absolute web URL. */
export function normalizeWebsite(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export const optionalWebsiteSchema = z.preprocess(normalizeWebsite,
  z.union([z.literal(''), z.string().url().refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }, 'Enter a valid http or https website address')]).optional());
