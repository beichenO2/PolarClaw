/**
 * Shared port discovery for MyClaw skills.
 *
 * Uses SOTAgent port-sdk to discover service ports dynamically.
 * No hardcoded fallback ports — if SOTAgent is down, the call fails.
 * This enforces the port-sdk-mandatory rule across all skills.
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _require = createRequire(import.meta.url);

interface PortSDK {
  getPort(serviceName: string): Promise<number>;
  discoverService(serviceName: string): Promise<{
    gatewayUrl: string;
    directUrl: string | null;
    port: number | null;
  }>;
}

let _sdk: PortSDK | null = null;

function getSDK(): PortSDK {
  if (_sdk) return _sdk;

  const home = process.env.HOME ?? '/Users/mac';
  const candidates = [
    process.env.PORT_SDK_PATH,
    resolve(home, 'Polarisor/SOTAgent/sdk-port/index.js'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      _sdk = _require(p) as PortSDK;
      return _sdk;
    } catch { /* try next */ }
  }

  throw new Error(
    'port-sdk not found. SOTAgent must be running and sdk-port must be accessible.',
  );
}

const SOTAGENT_BASE = process.env.SOTAGENT_URL ?? 'http://127.0.0.1:4800';

const _portCache = new Map<string, { port: number; ts: number }>();
const CACHE_TTL_MS = 60_000;

/**
 * Get a service port via port-sdk. Caches for 60s.
 * Falls back to gateway URL construction if port-sdk fails.
 */
export async function getServicePort(serviceName: string): Promise<number> {
  const cached = _portCache.get(serviceName);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.port;

  const sdk = getSDK();
  const port = await sdk.getPort(serviceName);
  _portCache.set(serviceName, { port, ts: Date.now() });
  return port;
}

/**
 * Get the gateway URL for a service (preferred access method).
 * Always available as long as SOTAgent is running.
 */
export function getGatewayUrl(servicePrefix: string): string {
  return `${SOTAGENT_BASE}/gw/${servicePrefix.toLowerCase()}`;
}

/**
 * Build a service URL: tries gateway first, falls back to direct port.
 */
export async function getServiceUrl(
  serviceName: string,
  gatewayPrefix?: string,
): Promise<string> {
  if (gatewayPrefix) {
    return getGatewayUrl(gatewayPrefix);
  }
  const port = await getServicePort(serviceName);
  return `http://127.0.0.1:${port}`;
}

/** Well-known service names and their gateway prefixes */
export const SERVICES = {
  DIGIST: { name: 'digist-api', gateway: 'digist' },
  KNOWLEVER_RAG: { name: 'knowlever-rag', gateway: 'knowlever' },
  AUTOOFFICE: { name: 'autooffice', gateway: 'autooffice' },
  CLOCK: { name: 'clock-backend', gateway: 'clock' },
  POLARPRIVATE: { name: 'polarprivate-backend', gateway: 'polarprivate' },
} as const;
