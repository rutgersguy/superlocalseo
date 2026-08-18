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
import { hostMatches, urlMentionsBusiness } from '../../services/citation_scan.service';

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
