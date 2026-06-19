import { lookup } from 'node:dns/promises'
import net from 'node:net'

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost']

/** IPv4/IPv6 addresses that must never be fetched server-side. */
export function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) {
    const parts = ip.split('.').map(Number)
    const [a, b] = parts
    return (
      a === 0 ||
      a === 127 ||
      a === 10 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (version === 6) {
    const ip6 = ip.toLowerCase()
    if (ip6 === '::1' || ip6 === '::') return true
    const mapped = ip6.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mapped) return isPrivateIp(mapped[1])
    if (ip6.startsWith('fc') || ip6.startsWith('fd')) return true // fc00::/7 ULA
    const firstHextet = parseInt(ip6.split(':')[0] || '0', 16)
    return (firstHextet & 0xffc0) === 0xfe80 // fe80::/10 link-local
  }
  return false // not a literal IP
}

/** Parse + require http(s) and a non-blocked literal host. Throws on violation. */
export function parseFetchableUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are allowed: ${raw}`)
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error(`Blocked host: ${host}`)
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error(`Blocked private address: ${host}`)
  }
  return url
}

/** parseFetchableUrl + DNS resolution check (defends against public names → internal IPs). */
export async function assertFetchableUrl(raw: string): Promise<URL> {
  const url = parseFetchableUrl(raw)
  if (net.isIP(url.hostname)) return url // literal already checked
  const addresses = await lookup(url.hostname, { all: true })
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error(`Blocked: ${url.hostname} resolves to a private address`)
  }
  return url
}
