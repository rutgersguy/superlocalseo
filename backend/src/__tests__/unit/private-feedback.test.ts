import { feedbackView, feedbackCsv, csvCell, feedbackUpdate } from '../../services/private_feedback';
describe('private feedback privacy and spreadsheet safety', () => {
  const input = { source: 'emr', contact_consent: true, contact_name: 'Full Name', contact_email: 'person@example.com', contact_phone: '+15551234567', follow_up_notes: 'Private operational note' };
  it('masks vendor contacts even if an unverified consent flag exists', () => {
    expect(feedbackView(input, false)).toMatchObject({ contactName: 'F*** N***', contactEmail: 'p***@example.com', contactPhone: '+15***' });
    expect(feedbackView(input, false).notes).toBeUndefined();
  });
  it('reveals native email only on explicit boolean consent', () => {
    expect(feedbackView({ ...input, source: 'native', contact_consent: false }, true).contactEmail).toBe('p***@example.com');
    expect(feedbackView({ ...input, source: 'native', contact_consent: true }, true).contactEmail).toBe('person@example.com');
    expect(feedbackView({ ...input, source: 'native', contact_consent: 'true' }, true).contactEmail).toBe('p***@example.com');
  });
  it.each(['=HYPERLINK("evil")', '+SUM(1)', '-1+1', '@SUM(1)', '  =1', '\ttext', '\n=2', '\uFEFF=1'])('neutralizes %s', value => {
    expect(csvCell(value).startsWith('"\'')).toBe(true);
  });
  it('escapes quotes/newlines and excludes notes from exports', () => {
    expect(csvCell('Hello, "world"\nOK')).toBe('"Hello, ""world""\nOK"');
    const csv = feedbackCsv([feedbackView(input, true)]);
    expect(csv).not.toContain('Private operational note');
    expect(csv).not.toContain('person@example.com');
  });
  it('rejects unsupported statuses, invalid assignees, missing version, and unknown write fields', () => {
    const valid = { version: 0, status: 'new', assignedUserId: null, notes: '' };
    expect(feedbackUpdate.safeParse(valid).success).toBe(true);
    for (const patch of [{ status: 'published' }, { assignedUserId: 'bad' }, { version: undefined }, { clientId: 'elsewhere' }]) {
      expect(feedbackUpdate.safeParse({ ...valid, ...patch }).success).toBe(false);
    }
  });
});
