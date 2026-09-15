import { fetchPublicWebsite, isPublicAddress } from '../../services/public_website_fetch';
const publicAddress = { address: '93.184.216.34', family: 4 };
describe('public website request boundaries', () => {
  test.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.0.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2001::1', '2002:7f00:1::', '2001:db8::1'])('rejects private address %s', ip => expect(isPublicAddress(ip)).toBe(false));
  it('pins the address that was checked and preserves the public hostname', async () => {
    const resolve = jest.fn().mockResolvedValue([publicAddress]);
    const request = jest.fn().mockResolvedValue({ status: 200, body: 'public' });
    const result = await fetchPublicWebsite('https://example.com', { resolve, request });
    expect(await result.text()).toBe('public');
    expect(request.mock.calls[0][0].hostname).toBe('example.com');
    expect(request.mock.calls[0][1]).toEqual(publicAddress);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('blocks private DNS answers before opening a connection', async () => {
    const request = jest.fn();
    await expect(fetchPublicWebsite('https://example.com', { resolve: async () => [{ address: '127.0.0.1', family: 4 }], request })).rejects.toThrow('Private');
    expect(request).not.toHaveBeenCalled();
  });
  it('rechecks redirects and blocks metadata services', async () => {
    const request = jest.fn().mockResolvedValue({ status: 302, location: 'http://169.254.169.254/latest/meta-data', body: '' });
    await expect(fetchPublicWebsite('https://example.com', { resolve: async () => [publicAddress], request })).rejects.toThrow('Private');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('allows public redirects and reports the final URL', async () => {
    const request = jest.fn().mockResolvedValueOnce({ status: 301, location: 'https://example.com/', body: '' }).mockResolvedValueOnce({ status: 200, body: '<html/>' });
    const result = await fetchPublicWebsite('http://example.com', { resolve: async () => [publicAddress], request });
    expect(result.url).toBe('https://example.com/'); expect(request).toHaveBeenCalledTimes(2);
  });
  test.each(['file:///etc/passwd', 'http://user:pass@example.com', 'https://example.com:5432'])('rejects unsupported destination %s', async value => {
    const request = jest.fn();
    await expect(fetchPublicWebsite(value, { resolve: async () => [publicAddress], request })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
