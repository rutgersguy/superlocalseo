import { MapPin } from 'lucide-react';

/** Shared public mark: red location pin with the SuperLocalSEO wordmark. */
export function BrandWordmark({ light = false }: { light?: boolean }) {
  return (
    <span className={`brand-wordmark${light ? ' brand-wordmark--light' : ''}`}>
      <MapPin aria-hidden="true" fill="currentColor" />
      <span>SuperLocalSEO</span>
    </span>
  );
}
