import { useState } from 'react';
import { apiFetch } from '../services/api';

export default function FeedbackFollowUp({ feedback, assignees, onSaved }: {
  feedback: { id: string; status: string; assignedUserId: string | null; notes?: string; version: number };
  assignees: Array<{ id: string; email: string }>;
  onSaved: () => Promise<unknown>;
}) {
  const [status, setStatus] = useState(feedback.status);
  const [assignedUserId, setAssignedUserId] = useState(feedback.assignedUserId ?? '');
  const [notes, setNotes] = useState(feedback.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try {
      await apiFetch(`/reviews/feedback/${feedback.id}`, { method: 'PATCH', body: JSON.stringify({ version: feedback.version, status, assignedUserId: assignedUserId || null, notes }) });
      await onSaved(); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save follow-up.'); }
    finally { setBusy(false); }
  }
  return <details className="mt-3 border-t border-slate-100 pt-3">
    <summary className="cursor-pointer text-sm font-medium text-slate-700">Manage follow-up</summary>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Follow-up status<select disabled={busy} value={status} onChange={e => { setStatus(e.target.value); setSaved(false); }} className="mt-1 block w-full rounded border-slate-300"><option value="new">New</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select></label>
      <label className="text-sm">Assigned teammate<select disabled={busy} value={assignedUserId} onChange={e => { setAssignedUserId(e.target.value); setSaved(false); }} className="mt-1 block w-full rounded border-slate-300"><option value="">Unassigned</option>{assignedUserId && !assignees.some(a => a.id === assignedUserId) && <option value={assignedUserId} disabled>Former teammate — reassign</option>}{assignees.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">Internal notes<textarea disabled={busy} value={notes} onChange={e => { setNotes(e.target.value); setSaved(false); }} maxLength={4000} rows={3} className="mt-1 block w-full rounded border-slate-300" /><span className="text-xs text-slate-500">Visible to account owners and admins. Keep sensitive personal details out of notes.</span></label>
    </div>
    <button disabled={busy} onClick={save} className="mt-3 rounded bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save follow-up'}</button>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {saved && <p role="status" className="mt-2 text-sm text-green-700">Follow-up saved.</p>}
  </details>;
}
