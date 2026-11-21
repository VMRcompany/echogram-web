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
// While this is set, a socket must not open Telegram's own host. That host
// answers nothing without a VPN, and a socket stuck on it never recovers.
let holdDirect = false;
let pinned = false;
// Set once the chat socket has received a real reply. A later probe must not
// tear that socket down.
let routeProved = false;

// web.telegram.org does not answer from Russia. The socket must not open it.
const BLOCKED_HOST = 'web.telegram.org';
const DEFAULT_FRONTS = [
  'stopblocking.co.uk',
  'sorokdva.co.uk',
  'pyatdesyatodin.co.uk',
  'kartoshka.co.uk',
  'onedaychamp.co.uk',
  'fixtelega.co.uk',
  'sadnews.co.uk',
  'nebally.co.uk',
  'havegreatday.co.uk',
  'cakeisalie.co.uk',
  'notelega.co.uk',
  'lovetrue.co.uk',
  'pclead.co.uk',
  'ebally.co.uk'
];

function usableBridge(front: string) {
  return !!front && front !== BLOCKED_HOST && isFrontUsable(front);
}

/** A Cloudflare front. Never web.telegram.org, even before the selector runs. */
function socketFront() {
  if(!rankedFronts.length) rankedFronts = DEFAULT_FRONTS.slice();
  if(activeFront && usableBridge(activeFront)) return activeFront;
  const next = rankedFronts.find(usableBridge) || DEFAULT_FRONTS[0];
  activeFront = next;
  return next;
}

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

/** Resolves when a front is chosen. The direct host is not used before that. */
export function whenGatewayReady() {
  return Promise.race([
    ready,
    new Promise<void>((resolve) => setTimeout(resolve, 8000))
  ]);
}

export function isFrontUsable(front: string) {
  return (deadUntil.get(front) || 0) < Date.now();
}

/** Refuse web.telegram.org until a probe has actually returned resPQ. */
export function holdDirectHost(hold: boolean) {
  if(holdDirect === hold) return;
  holdDirect = hold;
  if(!hold) {
    for(const listener of listeners) listener();
  }
}

export function getActiveFront() {
  return activeFront;
}

export function markRouteProved() {
  routeProved = true;
}

/**
 * Use this host for the chat. Telegram's own host is allowed: through a VPN it
 * is the one that keeps delivering updates. A socket that already got a reply
 * stays where it is.
 */
export function adoptFront(front: string) {
  if(!front) return;
  if(routeProved) {
    rememberFront(front);
    return;
  }
  if(front === activeFront) return;
  pinned = true;
  const rest = rankedFronts.filter((name) => name !== front);
  activeFront = null;
  setFrontOrder([front, ...rest]);
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

/**
 * The first front that actually returned resPQ becomes the one the chat uses.
 * A later result only joins the failover list, so a live socket is not replaced.
 */
export function preferFront(front: string) {
  if(!front || front === 'web.telegram.org') return;
  if(pinned) {
    rememberFront(front);
    return;
  }

  pinned = true;
  if(front === activeFront) return;
  const rest = rankedFronts.filter((name) => name !== front);
  activeFront = null;
  setFrontOrder([front, ...rest]);
}

/**
 * First entry is the one requests use. Later entries are the failover list.
 * A front that is already carrying the chat stays: a later race must not
 * tear it down and put the screen back on "Reconnecting...".
 */
export function setFrontOrder(fronts: string[]) {
  const unique = (list: string[]) => list.filter((front, index) => {
    return front && front !== BLOCKED_HOST && isFrontUsable(front) && list.indexOf(front) === index;
  });
  let usable = unique(fronts);
  // Every front was marked dead. Clearing once lets the list be tried again.
  // Calling the exhausted handler here used to call setFrontOrder on the same
  // dead list and overflow the stack, which left the screen on "Reconnecting".
  if(!usable.length && deadUntil.size) {
    deadUntil.clear();
    usable = unique(fronts);
  }
  const keep = activeFront && usable.includes(activeFront) ? activeFront : null;
  rankedFronts = keep ? [keep, ...usable.filter((front) => front !== keep)] : usable;
  const next = rankedFronts[0] || null;
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
export function applyHttpsUrl(dcId: number, _media: boolean, test: boolean) {
  const front = socketFront();
  const path = test ? 'apiw_test1' : 'apiw1';
  return `https://kws${dcId}.${front}/${path}`;
}

/** The front that just failed to answer stops being used. The next one is immediate. */
export function noteFrontFailed() {
  if(!activeFront) return;
  const failed = activeFront;
  deadUntil.set(failed, Date.now() + 20_000);
  let rest = rankedFronts.filter((front) => front !== failed && isFrontUsable(front));
  // An empty list used to leave the socket with nowhere to go, and the screen
  // stayed on "Waiting for network...". Try the others again instead.
  if(!rest.length) {
    pinned = false;
    for(const front of rankedFronts) deadUntil.delete(front);
    deadUntil.set(failed, Date.now() + 20_000);
    rest = rankedFronts.filter((front) => front !== failed);
  }
  if(!rest.length) {
    pinned = false;
    activeFront = null;
    rankedFronts = [];
    for(const listener of listeners) listener();
    onFrontsExhausted();
    return;
  }
  activeFront = null;
  setFrontOrder(rest);
}

/**
 * WebSocket the transport should open. Always a Cloudflare front.
 * kws*.web.telegram.org does not answer from Russia, so it is never returned.
 * Those zones have no `kwsN-1` name, so media uses `kwsN` as well.
 */
export function applySocketUrl(dcId: number, currentUrl: string) {
  const route = active;
  if(route && route.address !== BLOCKED_HOST && !route.address.endsWith('.' + BLOCKED_HOST)) {
    const port = route.port === 443 ? '' : `:${route.port}`;
    return `wss://${route.address}${port}/apiws`;
  }

  const front = socketFront();
  const path = currentUrl.match(/\/(apiws[^/?]*)/)?.[1] || 'apiws';
  return `wss://kws${dcId}.${front}/${path}`;
}
