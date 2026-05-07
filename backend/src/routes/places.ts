import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { config } from '../config';
import { ok } from '../utils/response';

const router = Router();

router.get('/cities', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q || q.length < 2) { ok(res, []); return; }

    if (!config.googlePlacesApiKey) { ok(res, []); return; }

    const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    url.searchParams.set('input', q);
    url.searchParams.set('types', '(cities)');
    url.searchParams.set('components', 'country:us');
    url.searchParams.set('key', config.googlePlacesApiKey);

    const r = await fetch(url.toString());
    if (!r.ok) { ok(res, []); return; }

    const data = await r.json() as {
      predictions?: Array<{
        structured_formatting: { main_text: string; secondary_text: string };
      }>;
    };

    const results = (data.predictions ?? []).map((p) => {
      const city = p.structured_formatting.main_text;
      // secondary_text is like "Oklahoma, USA" or "Oklahoma City, OK, USA"
      const parts = p.structured_formatting.secondary_text.split(',').map((s) => s.trim());
      // State abbreviation is the second-to-last part when 3 parts exist, else first part
      const stateRaw = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
      const state = stateRaw.length === 2 ? stateRaw : null;
      return {
        city,
        state,
        label: state ? `${city}, ${state}` : city,
      };
    }).filter((r) => r.city);

    ok(res, results);
  } catch (e) {
    next(e);
  }
});

export default router;
