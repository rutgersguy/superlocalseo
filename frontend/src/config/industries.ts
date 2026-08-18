/**
 * The industry picker, in one place.
 *
 * This list was duplicated verbatim in Onboarding.tsx and Settings.tsx, and it
 * also has to agree with `INDUSTRY_MAP` in the backend — which is what selects a
 * business's citation directories. Three copies of one list is three chances to
 * drift, and it had already drifted: #184 moved Real Estate into its own group
 * (so realtors get Zillow and Realtor.com rather than ZoomInfo and Clutch) and
 * added Property Management, neither of which the frontend copies knew about.
 *
 * The frontend cannot import from the backend, so this cannot be generated. It
 * must be kept in step with `backend/src/config/industry.config.ts` by hand —
 * hence one copy rather than two, and this note.
 */
export const INDUSTRY_GROUPS: Array<{ group: string; options: string[] }> = [
  { group: 'Home Services', options: ['Plumbing', 'HVAC', 'Electrical', 'Roofing', 'Landscaping', 'Cleaning', 'Pest Control', 'Painting', 'Flooring', 'Moving', 'General Contractor'] },
  { group: 'Health & Fitness', options: ['Personal Training', 'Gym / Fitness Studio', 'Physical Therapy', 'Chiropractic', 'Massage Therapy', 'Dental'] },
  { group: 'Legal', options: ['Law Firm', 'Family Law', 'Personal Injury'] },
  { group: 'Food & Beverage', options: ['Restaurant', 'Coffee Shop', 'Food Truck', 'Bakery'] },
  { group: 'Beauty & Personal Care', options: ['Hair Salon', 'Barbershop', 'Nail Salon', 'Med Spa'] },
  { group: 'Automotive', options: ['Auto Repair', 'Auto Detailing'] },
  { group: 'Professional Services', options: ['Accounting / CPA', 'Insurance', 'Veterinary', 'Photography', 'Tutoring'] },
  { group: 'Real Estate', options: ['Real Estate', 'Property Management'] },
  { group: 'Other', options: ['Other'] },
];
