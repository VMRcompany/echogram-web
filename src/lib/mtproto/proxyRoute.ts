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
const gatewayListeners = new Set<RouteListener>();
let markReady = () => {};
let ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

let activeFront: string | null = null;
let rankedFronts: string[] = [];
const deadUntil = new Map<string, number>();
let onFrontsExhausted = () => {};

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
  for(const listener of gatewayListeners) listener();
}

export function subscribeGateway(listener: RouteListener) {
  gatewayListeners.add(listener);
  return () => gatewayListeners.delete(listener);
}

export function finishGatewayProbe() {
  markReady();
}

/** Resolves when this browser has a working front, or after 4.5s. */
export function whenGatewayReady() {
  return Promise.race([
    ready,
    new Promise<void>((resolve) => setTimeout(resolve, 4500))
  ]);
}

export function isFrontUsable(front: string) {
  return (deadUntil.get(front) || 0) < Date.now();
}

export function getActiveFront() {
  return activeFront;
}

export function hasAnotherFront() {
  return rankedFronts.some((front) => front !== activeFront && isFrontUsable(front));
}

export function setFrontExhaustedHandler(handler: () => void) {
  onFrontsExhausted = handler;
}

export function rememberFront(front: string) {
  if(!front || !isFrontUsable(front) || rankedFronts.includes(front)) return;
  rankedFronts.push(front);
}

/** First entry is the one requests use. Later entries are the failover list. */
export function setFrontOrder(fronts: string[]) {
  const usable = fronts.filter((front, index) => front && isFrontUsable(front) && fronts.indexOf(front) === index);
  rankedFronts = usable;
  const next = usable[0] || null;
  if(next === activeFront) return;
  activeFront = next;
  if(!next) onFrontsExhausted();
  for(const listener of listeners) listener();
}

/**
 * The HTTPS URL for this DC. A chosen front replaces Telegram's own host.
 * Media on a Cloudflare front stays on `kwsN` (those zones have no `kwsN-1` name).
 * Returns null when this browser has not chosen a front yet.
 */
export function applyHttpsUrl(dcId: number, media: boolean, test: boolean) {
  const front = activeFront;
  if(!front) return null;
  const path = test ? 'apiw_test1' : 'apiw1';
  const suffix = media && front === 'web.telegram.org' ? '-1' : '';
  return `https://kws${dcId}${suffix}.${front}/${path}`;
}

/** The front that just failed to answer stops being used. The next one is immediate. */
export function noteFrontFailed() {
  if(!activeFront) return;
  deadUntil.set(activeFront, Date.now() + 90_000);
  setFrontOrder(rankedFronts.filter((front) => front !== activeFront));
}

/**
 * WebSocket the transport should open. A chosen front replaces the direct
 * host. Cloudflare zones have no `kwsN-1` name, so media uses `kwsN` there.
 * Otherwise the official URL is rebuilt.
 */
export function applySocketUrl(dcId: number, currentUrl: string) {
  const front = activeFront;
  if(front) {
    const media = currentUrl.includes('-1');
    const suffix = media && front === 'web.telegram.org' ? '-1' : '';
    const path = currentUrl.match(/\/(apiws[^/?]*)/)?.[1] || 'apiws';
    return `wss://kws${dcId}${suffix}.${front}/${path}`;
  }

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
