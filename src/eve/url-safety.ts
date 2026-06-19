import { lookup } from 'node:dns/promises'
import net from 'node:net'

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost']

/** IPv4/IPv6 addresses that must never be fetched server-side. */
export function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) {
    const parts = ip.split('.').map(Number)
    const [a, b, c, d] = parts
    return (
      a === 0 ||
      a === 127 ||
      a === 10 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
      (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24
      (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
      (a === 255 && b === 255 && c === 255 && d === 255) // 255.255.255.255 broadcast
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

/**
 * parseFetchableUrl + DNS resolution check (defends against public names → internal IPs).
 *
 * DNS-rebinding / TOCTOU note: this validates the DNS-resolved IPs at call time, but
 * `fetch` later resolves DNS independently. A hostile resolver could rebind between
 * this check and the actual fetch (validate-then-fetch TOCTOU). This is accepted for
 * this server-side, authenticated-admin, opt-in feature. A tight fix would pin the
 * validated IP and connect to it directly (bypassing the second DNS lookup entirely).
 */
export async function assertFetchableUrl(raw: string): Promise<URL> {
  const url = parseFetchableUrl(raw)
  if (net.isIP(url.hostname)) return url // literal already checked
  const addresses = await lookup(url.hostname, { all: true })
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error(`Blocked: ${url.hostname} resolves to a private address`)
  }
  return url
}
