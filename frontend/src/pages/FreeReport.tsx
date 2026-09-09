import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MapContainer, CircleMarker, TileLayer, Tooltip, ScaleControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './free-report.css';

type Business = { placeId: string; name: string; address: string | null; rating: number | null; reviewCount: number | null; collectedAt?: string | null };
type Area = { id: string; name: string; lat: number; lng: number };
type Point = { lat: number; lng: number; status: 'checked' | 'unavailable'; rank: number | null; checkedAt: string; collectedAt: string | null; resultCount: number; items: { placeId: string; name: string; rank: number }[] };
type Snapshot = { business: Business; generatedAt: string; profileCheckedAt: string; keyword: string; center: { label: string; lat: number; lng: number }; points: Point[]; summary: { checked: number; unavailable: number; found: number; averageWhenFound: number | null; counts: Record<string, number>; percentages: Record<string, number | null> }; ratingAction: string };
type Report = { status: string; snapshot: Snapshot | null; emailStatus: string | null; error: string | null };
async function request<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(`/api/free-reports${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000), credentials: 'omit' });
  const result = await r.json().catch(() => null);
  if (!r.ok || !result?.success) throw new Error(result?.error?.message ?? 'The report service is unavailable. Please try again.');
  return result.data;
}
const time = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { timeZoneName: 'short' }) : 'Not supplied by source';
const observation = (p: Point) => p.status === 'unavailable' ? 'Unavailable' : p.rank === null ? `Not found in ${p.resultCount} returned results` : `Rank ${p.rank} of ${p.resultCount} returned results`;
// Re-fit after responsive/print layout changes so all observations remain visible.
function FitSample({ points, center }: { points: Point[]; center: Snapshot['center'] }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      map.fitBounds([...points.map(p => [p.lat, p.lng] as [number, number]), [center.lat, center.lng]], { padding: [55, 65], maxZoom: 14, animate: false });
    };
    const observer = new ResizeObserver(fit); observer.observe(map.getContainer());
    window.addEventListener('beforeprint', fit); window.addEventListener('afterprint', fit); fit();
    return () => { observer.disconnect(); window.removeEventListener('beforeprint', fit); window.removeEventListener('afterprint', fit); };
  }, [map, points, center]);
  return null;
}
function SampleMap({ snapshot: s, selected, onSelect }: { snapshot: Snapshot; selected: number; onSelect: (index: number) => void }) {
  const [opacity, setOpacity] = useState(0.45);
  const [tileError, setTileError] = useState(false);
  return <>
    <div className="fr-map" role="region" aria-label="Map of the nine search points">
      <MapContainer center={[s.center.lat, s.center.lng]} zoom={12} scrollWheelZoom={false}>
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" referrerPolicy="strict-origin-when-cross-origin"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          eventHandlers={{ tileerror: () => setTileError(true), loading: () => setTileError(false) }} />
        <FitSample points={s.points} center={s.center} />
        <ScaleControl position="bottomleft" imperial={false} />
        {s.points.map((p, i) => <CircleMarker key={i} center={[p.lat, p.lng]} radius={28}
          pathOptions={{ color: selected === i ? '#182f56' : '#fff', weight: selected === i ? 4 : 2, fillColor: p.status === 'unavailable' ? '#64748b' : p.rank === null ? '#c27025' : '#2e8460', fillOpacity: opacity }}
          eventHandlers={{ click: () => onSelect(i) }}>
          <Tooltip permanent direction="center" className="fr-map-point"><span>{p.lat === s.center.lat && p.lng === s.center.lng ? `Center · ${i + 1}` : `Point ${i + 1}`}</span><strong>{p.status === 'unavailable' ? '?' : p.rank === null ? '—' : p.rank}</strong></Tooltip>
        </CircleMarker>)}
        <CircleMarker center={[s.center.lat, s.center.lng]} radius={34} pathOptions={{ color: '#182f56', weight: 2, dashArray: '4 4', fill: false }} interactive={false} />
      </MapContainer>
      <span className="fr-map-north" aria-label="North is up">↑ N</span>
    </div>
    {tileError && <p role="status">Some map tiles could not load. The point coordinates and observations are still available below.</p>}
    <div className="fr-map-legend"><span><i className="found" />Rank number = found</span><span><i className="missing" />— = not found</span><span><i className="unknown" />? = unavailable</span><span>Dashed ring = sample center</span></div>
    <label className="fr-map-opacity fr-no-print">Marker opacity <input type="range" min="20" max="80" value={Math.round(opacity * 100)} onChange={e => setOpacity(Number(e.target.value) / 100)} /> {Math.round(opacity * 100)}%</label>
  </>;
}
export default function FreeReport() {
  const { id } = useParams(); const navigate = useNavigate(); const [searchParams] = useSearchParams();
  const [business, setBusiness] = useState(''); const [city, setCity] = useState(''); const [keyword, setKeyword] = useState('');
  const [email, setEmail] = useState(''); const [consent, setConsent] = useState(false); const [honeypot, setHoneypot] = useState('');
  const [choices, setChoices] = useState<{ businesses: Business[]; areas: Area[] } | null>(null);
  const [placeId, setPlaceId] = useState(''); const [areaId, setAreaId] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState(4); const [stopped, setStopped] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex, nofollow'; document.head.appendChild(robots);
    const referrer = document.createElement('meta'); referrer.name = 'referrer'; referrer.content = 'no-referrer'; document.head.appendChild(referrer);
    return () => { robots.remove(); referrer.remove(); };
  }, []);
  useEffect(() => {
    if (!id) { setReport(null); return; }
    let cancelled = false; let timer: ReturnType<typeof setTimeout>; const started = Date.now();
    setError(''); setStopped(false);
    const poll = async () => {
      try {
        const data = await request<Report>(`/${id}`); if (cancelled) return; setReport(data); setError('');
        if (['queued', 'processing'].includes(data.status)) {
          if (Date.now() - started < 10 * 60000) timer = setTimeout(poll, 5000); else setStopped(true);
        }
      } catch (e) { if (!cancelled) { setError((e as Error).message); setStopped(true); } }
    };
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [id, retry]);
  async function search(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setChoices(null); setPlaceId(''); setAreaId('');
    try { setChoices(await request('/search', { business, city })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function generate(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const result = await request<{ id: string }>('', { placeId, areaId, keyword, email, consent, website: honeypot }); navigate(`/free-report/${result.id}`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const s = report?.snapshot; const point = s?.points[selected];
  return <div className="free-report"><header><Link to="/" className="fr-brand">SuperLocalSEO</Link><span>Local visibility report</span></header><main>
    {error && <p role="alert" className="fr-error">{error}</p>}
    {!id ? <>
      {searchParams.get('legacy') === '1' && <section className="fr-panel" aria-label="Report link update"><h2>Our reports have changed</h2><p>This link used our previous reporting system. Create a new report below using our current source checks and map sample. It will be a new snapshot, not a copy of the earlier report.</p></section>}
      <p className="fr-eyebrow">A clear starting point</p><h1>See how your business appears nearby.</h1>
      <p>Choose your Google listing, a city to sample, and one search phrase. Your report includes the available review rating and a nine-point Google Maps search sample. No traffic estimates or invented rankings.</p>
      <form onSubmit={search} className="fr-panel fr-form">
        <label>Business name<input required minLength={2} maxLength={150} value={business} onChange={e => setBusiness(e.target.value)} placeholder="Light Hawk Studios" /></label>
        <label>City and state abbreviation<input required minLength={2} maxLength={150} value={city} onChange={e => setCity(e.target.value)} placeholder="Atlanta, GA" /></label>
        <button disabled={busy}>{busy ? 'Please wait…' : 'Find my business'}</button>
      </form>
      {choices && <form onSubmit={generate} className="fr-panel fr-form">
        <h2>Confirm the listing and search area</h2>
        <fieldset><legend>Your Google business listing</legend>{choices.businesses.length ? choices.businesses.map(b => <label className="fr-option" key={b.placeId}><input type="radio" name="business" required checked={placeId === b.placeId} onChange={() => setPlaceId(b.placeId)} /><span><strong>{b.name}</strong><small>{b.address ?? 'No public street address returned'}</small></span></label>) : <p>No listing found. Refine the business name and city above.</p>}<small className="fr-attribution" translate="no">Google Maps</small></fieldset>
        <label>City to sample<select required value={areaId} onChange={e => setAreaId(e.target.value)}><option value="">Choose a city</option>{choices.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        {!choices.areas.length && <p>No supported city matched. Try the city name and two-letter state abbreviation.</p>}
        <p className="fr-note">The grid uses the selected city’s Census representative point, with points about 2 km apart. It samples the area around that point; it does not measure your entire service area or use a hidden business address.</p>
        <label>Search phrase<input required minLength={2} maxLength={100} placeholder="video production company" value={keyword} onChange={e => setKeyword(e.target.value)} /></label>
        <label>Email for your report link<input type="email" required maxLength={255} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="fr-honey" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={honeypot} onChange={e => setHoneypot(e.target.value)} /></label>
        <label className="fr-option"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>Email me this requested report. This does not subscribe me to marketing emails.</span></label>
        <button disabled={busy || !placeId || !areaId}>{busy ? 'Requesting report…' : 'Create my free report'}</button>
        <p className="fr-note">Results may take several minutes. Anyone with your report link can view the business results; your email is not included.</p>
      </form>}
    </> : <>
      {!s && <section className="fr-panel" aria-live="polite"><h1>{report?.status === 'failed' ? 'Report unavailable' : 'Preparing your report'}</h1><p>{report?.error ?? 'We are checking the selected business and collecting the map observations. You can keep this page open or use the report link emailed to you.'}</p>{report?.status === 'failed' && <Link to="/audit">Start a new report</Link>}{stopped && <><p>Automatic checking has stopped.</p><button onClick={() => setRetry(n => n + 1)}>Check again</button></>}</section>}
      {s && <>
        <div className="fr-title"><div><p className="fr-eyebrow">Your visibility snapshot</p><h1>{s.business.name}</h1><p>{s.business.address ?? 'No public street address returned. The scan area is selected separately.'}</p></div><button className="fr-no-print" onClick={() => window.print()}>Print / save PDF</button></div>
        <p>Completed {time(s.generatedAt)}. Search: <strong>{s.keyword}</strong>. Area: <strong>{s.center.label}</strong>.</p>
        <section className="fr-stats" aria-label="Report measurements"><article><strong>{s.business.rating === null ? 'Unknown' : `${s.business.rating.toFixed(1)} / 5`}</strong><span>Google review rating</span></article><article><strong>{s.business.reviewCount ?? 'Unknown'}</strong><span>Google reviews</span></article><article><strong>{s.summary.found} / {s.summary.checked}</strong><span>Found / successfully checked points</span></article><article><strong>{s.summary.averageWhenFound ?? 'Unknown'}</strong><span>Average rank when found ({s.summary.found} {s.summary.found === 1 ? 'point' : 'points'})</span></article></section>
        <p className="fr-note">Business information retrieved {time(s.profileCheckedAt)}; source collected {time(s.business.collectedAt)}. Counts and ratings are source observations at that time.</p>
        <section className="fr-panel fr-sample"><h2>Nine-point search sample</h2><p>North is at the top. Points are about 2 km apart around {s.center.label} ({s.center.lat}, {s.center.lng}). The dashed ring marks the city’s Census representative point, not your business location. The translucent markers show individual observations, not continuous ranking coverage. Select a marker or a point below to inspect its results.</p>
          <SampleMap snapshot={s} selected={selected} onSelect={setSelected} />
          <div className="fr-grid" aria-label="Sampled search points">{s.points.map((p, i) => <button key={i} className={p.status === 'unavailable' ? 'unknown' : p.rank === null ? 'missing' : 'found'} aria-pressed={selected === i} aria-label={`Point ${i + 1}: ${observation(p)}`} onClick={() => setSelected(i)}><small>Point {i + 1}</small><strong>{p.status === 'unavailable' ? '?' : p.rank ?? '—'}</strong><small>{p.status === 'unavailable' ? 'Unavailable' : p.rank === null ? 'Not found' : 'Rank'}</small></button>)}</div>
          <p>{s.summary.unavailable} unavailable checks are excluded from percentages and average rank. “Not found” means absent from the results returned for that point, not absent from Google.</p>
          <div className="fr-table-wrap"><table><caption>Observed results at each point</caption><thead><tr><th>Point</th><th>Coordinates</th><th>Observation</th><th>Retrieved</th><th>Source collected</th></tr></thead><tbody>{s.points.map((p, i) => <tr key={i}><th>{i + 1}</th><td>{p.lat}, {p.lng}</td><td>{observation(p)}</td><td>{time(p.checkedAt)}</td><td>{time(p.collectedAt)}</td></tr>)}</tbody></table></div>
          {point && <details className="fr-no-print"><summary>Inspect returned businesses at point {selected + 1}</summary><p>{observation(point)}</p><ol>{point.items.map(i => <li key={i.placeId}>#{i.rank} {i.name}{i.placeId === s.business.placeId ? ' — your selected listing' : ''}</li>)}</ol></details>}
        </section>
        <section className="fr-panel"><h2>Share of successfully checked points</h2><ul>{[['top3', 'Ranks 1–3'], ['fourToTen', 'Ranks 4–10'], ['elevenToTwenty', 'Ranks 11–20'], ['notFound', 'Not found in returned results']].map(([key, label]) => <li key={key}>{label}: <strong>{s.summary.counts[key]} {s.summary.counts[key] === 1 ? 'point' : 'points'} · {s.summary.percentages[key] === null ? 'Unknown' : `${s.summary.percentages[key]}%`}</strong></li>)}</ul><p className="fr-note">Denominator: {s.summary.checked} checked points. Percentages are rounded to one decimal and may not sum to exactly 100%. Average rank includes only points where your listing was found.</p></section>
        <section className="fr-panel"><h2>What to do next</h2><ul><li>{s.ratingAction}</li><li>Check that this phrase describes a service you offer and that the selected city is relevant to your customers.</li><li>{s.summary.unavailable ? 'Some checks were unavailable. Do not interpret them as poor rankings; repeat the sample later before drawing conclusions.' : 'Use this sample as a baseline. Compare the same phrase and points over time before judging progress.'}</li></ul></section>
        <section className="fr-panel fr-note"><h2>Sources and limits</h2><p>Business profile and Google Maps observations: DataForSEO. Area coordinates: U.S. Census Bureau 2025 Places Gazetteer. Searches requested up to 20 results per point, in English on desktop at zoom 14z. Actual returned counts are listed above. Exact Google place IDs identify your business; names alone are not used for matching.</p><p>Search results vary by time, query and location. This report does not measure traffic, leads, revenue, ranking causes, or your entire service area. Viewing this report does not regenerate its measurements.</p><p>Listing ID: {s.business.placeId}</p></section>
        {report?.emailStatus === 'failed' && <p className="fr-no-print">Email delivery was not confirmed. You can bookmark this report or print it.</p>}
        <section className="fr-panel fr-no-print"><h2>Keep track of what changes.</h2><p>Bring reviews and local visibility into one workspace.</p><Link to="/register">Explore SuperLocalSEO</Link> · <Link to="/audit">Create another report</Link></section>
      </>}
    </>}
  </main><footer><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><a href="https://www.google.com/intl/en-US/help/terms_maps/" rel="noreferrer">Google Maps terms</a><a href="https://policies.google.com/privacy" rel="noreferrer">Google privacy</a></footer></div>;
}
