/**
 * Guards the two matching gates in citation scanning (#174).
 *
 * Both cases here were found by measuring against 34 real businesses, not
 * imagined — each one produced a wrong answer that a customer would have acted
 * on:
 *
 *   - `profiles.superlawyers.com` was counted as a Lawyers.com listing, because
 *     the host check was a substring test and "superlawyers.com" contains
 *     "lawyers.com".
 *   - `yellowpages.com/phoenix-az/plomeros` (a category page) was counted as a
 *     Yellow Pages listing for a plumbing company.
 *
 * A false "listed" tells a customer a citation exists when it does not, so they
 * never create it. A false "not_found" tells them to create a listing they
 * already have, and duplicate listings actively damage local ranking. Both
 * directions are harmful, which is why these gates are tested rather than
 * trusted.
 */
import { hostMatches, urlMentionsBusiness, extractPhone } from '../../services/citation_scan.service';

describe('hostMatches', () => {
  it('rejects a domain that merely contains the target as a substring', () => {
    // The real regression: three law firms were credited with Lawyers.com
    // listings they did not have.
    expect(hostMatches('https://profiles.superlawyers.com/illinois/chicago/lawfirm/malman-law/x', 'lawyers.com')).toBe(false);
  });

  it('accepts the domain itself and its subdomains', () => {
    expect(hostMatches('https://www.lawyers.com/chicago/illinois/malman-law-123/', 'lawyers.com')).toBe(true);
    expect(hostMatches('https://lawyers.com/x', 'lawyers.com')).toBe(true);
    expect(hostMatches('https://profiles.lawyers.com/x', 'lawyers.com')).toBe(true);
  });

  it('honours a path component in the configured domain', () => {
    expect(hostMatches('https://lawyers.findlaw.com/profile/x', 'lawyers.findlaw.com')).toBe(true);
    expect(hostMatches('https://www.findlaw.com/legal-news', 'lawyers.findlaw.com')).toBe(false);
  });

  it('does not throw on a malformed url', () => {
    expect(hostMatches('not a url', 'yelp.com')).toBe(false);
  });
});

describe('urlMentionsBusiness', () => {
  it('rejects directory category pages', () => {
    expect(urlMentionsBusiness('https://www.yellowpages.com/phoenix-az/plomeros', 'Parker & Sons')).toBe(false);
    expect(urlMentionsBusiness('https://www.angi.com/companylist/us/co/denver/roofing.htm', 'Premier Roofing Company')).toBe(false);
    expect(urlMentionsBusiness('https://www.expertise.com/finance/accountant-cpa/north-carolina/charlotte', 'MND Accounting')).toBe(false);
  });

  it('rejects a personal profile standing in for a company', () => {
    expect(urlMentionsBusiness('https://www.linkedin.com/in/david-metz-9816471b', 'Dowd Heat and Air')).toBe(false);
  });

  it('accepts real listing pages, including abbreviated slugs', () => {
    expect(urlMentionsBusiness('https://www.yelp.com/biz/parker-and-sons-phoenix-5', 'Parker & Sons')).toBe(true);
    expect(urlMentionsBusiness('https://www.angi.com/companylist/us/az/phoenix/parker-sons-electrical-reviews-1.htm', 'Parker & Sons')).toBe(true);
    expect(urlMentionsBusiness('https://www.facebook.com/theaussieplumber/', 'The Aussie Plumber')).toBe(true);
    expect(urlMentionsBusiness('https://nextdoor.com/pages/dowd-heat-and-air-tulsa-ok-1/', 'Dowd Heat and Air')).toBe(true);
  });

  it('ignores corporate suffixes so they cannot carry a false match', () => {
    // Without stopword removal, "LLC" alone could push a category page over the
    // threshold on a two-word name.
    expect(urlMentionsBusiness('https://www.angi.com/companylist/us/co/denver/plumbing.htm', 'Denver Plumbing LLC')).toBe(false);
  });
});

describe('extractPhone', () => {
  const OURS = '(918) 518-1492';

  it('picks the business phone out of a snippet containing several', () => {
    // Real BBB snippet shape: the business number appears alongside a state
    // agency number in the page furniture.
    const text = 'Aire Serv of South Tulsa, Bixby OK. File a complaint: (405) 521-6550. Phone: (918) 518-1492';
    expect(extractPhone(text, OURS)).toBe('(918) 518-1492');
  });

  it('returns null rather than guessing when several candidates and none match', () => {
    // The regression: this returned the FIRST match, which was then reported to
    // the customer as a NAP mismatch on a phone number that was correct.
    const text = 'Complaints (405) 521-6550 or call (918) 528-6892 for details';
    expect(extractPhone(text, OURS)).toBeNull();
  });

  it('still reports a single unambiguous mismatch', () => {
    // A listing genuinely showing the wrong number must not be silenced.
    expect(extractPhone('Call us on (918) 994-3434 today', OURS)).toBe('(918) 994-3434');
  });

  it('ignores a bare digit run that is not a formatted phone', () => {
    // Nextdoor yielded "1918518149" — an id, reported as the listing's phone.
    expect(extractPhone('listing id 1918518149 here', OURS)).toBeNull();
  });

  it('returns null when there is no phone at all', () => {
    expect(extractPhone('No contact details in this snippet', OURS)).toBeNull();
  });
});
