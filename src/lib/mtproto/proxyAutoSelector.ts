import {logger} from '@lib/logger';
import {finishGatewayProbe, GatewayChoice, GatewayTransport, setGatewayChoice} from '@lib/mtproto/proxyRoute';

/**
 * Each browser tests Telegram's own web gateways from the network it is on.
 * All of them are opened together. Only a gateway that answers is kept, and
 * the fastest one that returned data is the one this user keeps using.
 * A saved choice is only a fallback for the next visit on this same device.
 */
const log = logger('PROXY');

const HTTPS_HOST = ['pluto', 'venus', 'aurora', 'vesta', 'flora'];
const CACHE_KEY = 'echogram_gateway_v2';
const PROBE_MS = 1000;

type Hit = {
  transport: GatewayTransport,
  dcId: number,
  ms: number
};

let started = false;

function storageGet(key: string) {
  try {
    return localStorage.getItem(key) || '';
  } catch{
    return '';
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch{
  }
}

function loadCache(): GatewayChoice | null {
  const [transport, dc] = storageGet(CACHE_KEY).split('|');
  const dcId = +dc;
  if((transport !== 'https' && transport !== 'websocket') || dcId < 1 || dcId > 5) return null;
  return {transport, dcId};
}

function saveCache(choice: GatewayChoice) {
  storageSet(CACHE_KEY, `${choice.transport}|${choice.dcId}`);
}

function probeWebSocket(dcId: number) {
  return new Promise<Hit | null>((resolve) => {
    const startedAt = Date.now();
    let done = false;
    const finish = (hit: Hit | null) => {
      if(done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch{
      }
      resolve(hit);
    };

    let socket: WebSocket;
    try {
      socket = new WebSocket(`wss://kws${dcId}.web.telegram.org/apiws`, 'binary');
    } catch{
      resolve(null);
      return;
    }

    const timer = setTimeout(() => finish(null), PROBE_MS);
    socket.addEventListener('open', () => finish({
      transport: 'websocket',
      dcId,
      ms: Math.max(1, Date.now() - startedAt)
    }));
    socket.addEventListener('error', () => finish(null));
  });
}

async function probeHttps(dcId: number): Promise<Hit | null> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS);
  try {
    await fetch(`https://${HTTPS_HOST[dcId - 1]}.web.telegram.org/apiw1`, {
      mode: 'no-cors',
      signal: controller.signal
    });
    return {transport: 'https', dcId, ms: Math.max(1, Date.now() - startedAt)};
  } catch{
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function choose(hits: Hit[]): GatewayChoice | null {
  const answered = hits.filter((hit) => hit.transport === 'https').sort((a, b) => a.ms - b.ms);
  const opened = hits.filter((hit) => hit.transport === 'websocket').sort((a, b) => a.ms - b.ms);
  // HTTPS completed a request, so the API replies came back. A socket that
  // only opened is used when no HTTPS gateway answered from this network.
  const best = answered[0] || opened[0];
  return best ? {transport: best.transport, dcId: best.dcId} : null;
}

async function probeFromHere() {
  const hits = (await Promise.all([1, 2, 3, 4, 5].flatMap((dcId) => [
    probeWebSocket(dcId),
    probeHttps(dcId)
  ]))).filter((hit): hit is Hit => !!hit);

  const choice = choose(hits) || loadCache();
  if(choice) {
    setGatewayChoice(choice);
    if(hits.length) saveCache(choice);
    log('gateway for this network', choice.transport, 'dc', choice.dcId, 'working', hits.length);
  } else {
    log('no gateway answered from this network');
  }

  finishGatewayProbe();
}

export function startProxyAutoSelector() {
  if(started) return;
  started = true;
  probeFromHere();
}
