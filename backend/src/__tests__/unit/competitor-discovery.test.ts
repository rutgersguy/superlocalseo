/**
 * Directory classification for competitor discovery (#81).
 *
 * The first run of this feature listed yelp.com, homeadvisor.com, nextdoor.com
 * and angi.com among a plumber's "competitors". That is not a small cosmetic
 * problem: it is advice a customer cannot act on. Nobody out-ranks Yelp for
 * "hvac repair bixby ok", and telling them to try wastes their time and makes
 * the product look naive.
 *
 * They are classified rather than deleted, because "six of your top ten are
 * directories" is a real finding — it changes the advice from "beat these
 * businesses" to "get listed on these directories", which is exactly what the
 * Citations feature is for.
 *
 * The domain list is reused from the citation registry, so a directory we audit
 * is automatically a directory we do not call a competitor.
 */
import { isDirectoryDomain } from '../../services/competitor_discovery.service';

describe('isDirectoryDomain', () => {
  it.each([
    'yelp.com',
    'homeadvisor.com',
    'nextdoor.com',
    'angi.com',
    'bbb.org',
    'facebook.com',
    'yellowpages.com',
    'mapquest.com',
    'thumbtack.com',
    'tripadvisor.com',
  ])('classifies %s as a directory', (d) => {
    expect(isDirectoryDomain(d)).toBe(true);
  });

  it.each([
    'calloklahome.com',
    'vortexcomfortsolutions.com',
    'morrisheatandair.net',
    'aircomfortsolutions.net',
    'goodneighborok.com',
  ])('leaves the real local business %s as a competitor', (d) => {
    expect(isDirectoryDomain(d)).toBe(false);
  });

  it('matches subdomains of a directory', () => {
    // Regional and vertical subdomains are the same publisher.
    expect(isDirectoryDomain('uk.trustpilot.com')).toBe(true);
    expect(isDirectoryDomain('lawyers.findlaw.com')).toBe(true);
    expect(isDirectoryDomain('pro.porch.com')).toBe(true);
  });

  it('does not match a business whose domain merely ends in a directory word', () => {
    // The substring bug that credited superlawyers.com as Lawyers.com in #174 —
    // same failure mode, different feature.
    expect(isDirectoryDomain('myyelp.com')).toBe(false);
    expect(isDirectoryDomain('notangi.com')).toBe(false);
  });

  it('handles a missing domain, which map-pack entries routinely have', () => {
    expect(isDirectoryDomain(null)).toBe(false);
  });
});
