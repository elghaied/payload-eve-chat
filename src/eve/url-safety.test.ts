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
  it('flags IPv6 loopback/ULA/link-local', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12::1']) expect(isPrivateIp(ip)).toBe(true)
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
