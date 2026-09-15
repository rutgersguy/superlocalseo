import { optionalWebsiteSchema } from '../../utils/website';
it.each([
 ['example.com', 'https://example.com'],
 [' www.example.com/services ', 'https://www.example.com/services'],
 ['https://example.com/path?q=1', 'https://example.com/path?q=1'],
 ['http://example.com', 'http://example.com'],
 ['//example.com', 'https://example.com'],
 ['', ''], ['   ', ''], [undefined, undefined],
])('normalizes optional website %s', (input, expected) => {
 expect(optionalWebsiteSchema.parse(input)).toBe(expected);
});
it.each(['not a website', 'javascript:alert(1)', 'ftp://example.com', 'https://', 'https://user:password@example.com'])('rejects invalid web address %s', input => {
 expect(optionalWebsiteSchema.safeParse(input).success).toBe(false);
});
