import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertFetchableUrl, isPrivateIp, parseFetchableUrl } from './url-safety'

describe('isPrivateIp', () => {
  it('flags loopback/private/link-local IPv4', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0'])
      expect(isPrivateIp(ip)).toBe(true)
  })
  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) expect(isPrivateIp(ip)).toBe(false)
  })
  it('flags additional reserved IPv4 ranges', () => {
    expect(isPrivateIp('100.64.0.1')).toBe(true) // CGNAT 100.64.0.0/10
    expect(isPrivateIp('198.18.0.1')).toBe(true) // benchmarking 198.18.0.0/15
    expect(isPrivateIp('198.19.255.255')).toBe(true) // benchmarking upper bound
    expect(isPrivateIp('255.255.255.255')).toBe(true) // broadcast
  })
  it('allows IPs just outside reserved ranges', () => {
    expect(isPrivateIp('100.63.255.255')).toBe(false) // just below CGNAT
    expect(isPrivateIp('100.128.0.1')).toBe(false) // just above CGNAT
  })
  it('flags IPv6 loopback/ULA/link-local', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12::1']) expect(isPrivateIp(ip)).toBe(true)
  })
  it('flags full fe80::/10 link-local range (fea0, fe80) and allows public IPv6', () => {
    expect(isPrivateIp('fea0::1')).toBe(true)
    expect(isPrivateIp('fe80::1')).toBe(true)
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false)
  })
  it('flags IPv4-mapped private addresses and allows public ones', () => {
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true)
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false)
  })
})

describe('parseFetchableUrl', () => {
  it('accepts a normal https URL', () => {
    expect(parseFetchableUrl('https://example.com/x').hostname).toBe('example.com')
  })
  it('rejects non-http(s) schemes', () => {
    expect(() => parseFetchableUrl('file:///etc/passwd')).toThrow()
    expect(() => parseFetchableUrl('ftp://example.com')).toThrow()
  })
  it('rejects localhost / .local / private literal IPs', () => {
    expect(() => parseFetchableUrl('http://localhost/x')).toThrow()
    expect(() => parseFetchableUrl('http://printer.local')).toThrow()
    expect(() => parseFetchableUrl('http://192.168.0.1')).toThrow()
    expect(() => parseFetchableUrl('http://169.254.169.254/latest/meta-data')).toThrow()
  })
  it('rejects trailing-dot hostnames that bypass host checks', () => {
    expect(() => parseFetchableUrl('http://localhost.')).toThrow()
    expect(() => parseFetchableUrl('http://192.168.0.1.')).toThrow()
  })
})

const mockLookup = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ default: { lookup: mockLookup }, lookup: mockLookup }))
import { lookup } from 'node:dns/promises'

describe('assertFetchableUrl', () => {
  afterEach(() => vi.clearAllMocks())
  it('rejects when the host resolves to a private IP', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.9', family: 4 }] as never)
    await expect(assertFetchableUrl('https://sneaky.example')).rejects.toThrow()
  })
  it('passes when the host resolves to a public IP', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    await expect(assertFetchableUrl('https://example.com')).resolves.toBeInstanceOf(URL)
  })
})
