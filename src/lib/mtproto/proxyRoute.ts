export type EchogramProxyRoute = {
  address: string,
  port: number
};

export type GatewayTransport = 'websocket' | 'https';

export type GatewayChoice = {
  transport: GatewayTransport,
  dcId: number
};

type RouteListener = () => void;

let active: EchogramProxyRoute | null = null;
const listeners = new Set<RouteListener>();

let choice: GatewayChoice | null = null;
let markReady = () => {};
let ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

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

export function getGatewayChoice() {
  return choice;
}

export function setGatewayChoice(next: GatewayChoice | null) {
  choice = next;
}

export function finishGatewayProbe() {
  markReady();
}

/** Resolves when this browser has finished testing gateways, or after 1.2s. */
export function whenGatewayReady() {
  return Promise.race([
    ready,
    new Promise<void>((resolve) => setTimeout(resolve, 1200))
  ]);
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
