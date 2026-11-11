export type EchogramProxyRoute = {
  address: string,
  port: number
};

type RouteListener = () => void;

let active: EchogramProxyRoute | null = null;
const listeners = new Set<RouteListener>();

function sameRoute(a: EchogramProxyRoute | null, b: EchogramProxyRoute | null) {
  if(a === b) return true;
  if(!a || !b) return false;
  return a.address === b.address && a.port === b.port;
}

export function getActiveProxyRoute() {
  return active;
}

export function setActiveProxyRoute(route: EchogramProxyRoute | null) {
  if(sameRoute(active, route)) return;
  active = route;
  for(const listener of listeners) listener();
}

export function subscribeProxyRoute(listener: RouteListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * WebSocket the transport should open. A chosen proxy replaces the direct
 * `kws*.web.telegram.org` host; otherwise the official URL is rebuilt.
 */
export function applySocketUrl(dcId: number, currentUrl: string) {
  const route = active;
  if(route) {
    const port = route.port === 443 ? '' : `:${route.port}`;
    return `wss://${route.address}${port}/apiws`;
  }

  if(!currentUrl || currentUrl.includes('.web.telegram.org/')) return currentUrl;

  const suffix = currentUrl.includes('-1') ? '-1' : '';
  const path = currentUrl.includes('apiws_test') ? 'apiws_test' : 'apiws';
  return `wss://kws${dcId}${suffix}.web.telegram.org/${path}`;
}
