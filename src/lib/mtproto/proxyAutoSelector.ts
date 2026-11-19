import {logger} from '@lib/logger';
import {finishGatewayProbe, getActiveFront, holdDirectHost, isFrontUsable, rememberFront, setFrontExhaustedHandler, setFrontOrder, setGatewayChoice} from '@lib/mtproto/proxyRoute';

/**
 * Each browser races Telegram's own web socket and the Cloudflare fronts from
 * the network it is on. A hit is a socket that returns a real resPQ.
 * The browser's HTTP POST to /apiw1 is a 404, so it is not used as proof.
 * The direct host wins when it answers. If it is blocked, the fastest front
 * that answered is used, and a dead one is replaced by the next.
 *
 * The init frame and the request must be two WebSocket messages. One combined
 * frame stays silent on these fronts.
 */
const log = logger('PROXY');

const DIRECT = 'web.telegram.org';
const FRONTS = [
  DIRECT,
  'pclead.co.uk',
  'offshor.co.uk',
  'cakeisalie.co.uk',
  'noskomnadzor.co.uk',
  'lovetrue.co.uk',
  'sorokdva.co.uk',
  'pyatdesyatdva.co.uk',
  'kartoshka.co.uk',
  'sorokodin.co.uk',
  'pyatdesyatodin.co.uk',
  'notelega.co.uk',
  'ebally.co.uk',
  'nebally.co.uk',
  'havegreatday.co.uk',
  'pomogite.co.uk',
  'fixtelega.co.uk',
  'sadnews.co.uk',
  'onedaychamp.co.uk',
  'stopblocking.co.uk',
  'nothingthere.co.uk'
];

const CACHE_KEY = 'echogram_front_v5';
const CACHE_URL = 'https://echogram.local/front';
// A handful at a time. Opening every front at once stalls them all, and the
// chat then starts on the direct host, which returns nothing without a VPN.
const CONCURRENCY = 4;
const SEARCH_MS = 9000;
const PROBE_MS = 6000;
const SLOW_FRONTS = [
  'offshor.co.uk',
  'pyatdesyatdva.co.uk',
  'nothingthere.co.uk',
  'noskomnadzor.co.uk',
  'pomogite.co.uk'
];
// Measured from this network: these answered resPQ, fastest first.
// The chat opens on the first one immediately. It does not wait for a probe,
// and it does not open web.telegram.org, which stays silent without a VPN.
const OPEN_FIRST = [
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
const RES_PQ = 85337187;
const REQ_PQ_MULTI = -1099002127;

type Hit = {front: string, ms: number};

let started = false;
let probing = false;
let probeQueued = false;

/**
 * Search again only when nothing is selected. A second race must not replace
 * the front that already answers: that reconnects a live chat.
 */
export function wakeProxySearch() {
  if(!started || getActiveFront()) return;
  if(probing) {
    probeQueued = true;
    return;
  }

  probeFromHere();
}

function bytesOf(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function forbidden(init: Uint8Array) {
  const view = new DataView(init.buffer, init.byteOffset, init.byteLength);
  const val = view.getInt32(0, true);
  const val2 = view.getInt32(4, true);
  return init[0] === 0xef ||
    val === 0x44414548 ||
    val === 0x54534f50 ||
    val === 0x20544547 ||
    val === 0x4954504f ||
    val === 0xeeeeeeee ||
    val === 0xdddddddd ||
    val2 === 0;
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for(const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function addBlocks(iv: Uint8Array, blocks: number) {
  const counter = new Uint8Array(iv);
  let rest = blocks;
  for(let i = counter.length - 1; i >= 0 && rest > 0; --i) {
    const sum = counter[i] + (rest & 0xff);
    counter[i] = sum & 0xff;
    rest = (rest >>> 8) + (sum >>> 8);
  }
  return counter;
}

async function aesCtr(keyBytes: Uint8Array, iv: Uint8Array, data: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', keyBytes, {name: 'AES-CTR'}, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-CTR',
    counter: new Uint8Array(iv),
    length: 128
  }, key, data);
  return new Uint8Array(encrypted);
}

function constructorId(plain: Uint8Array) {
  if(plain.length < 25) return 0;
  const extra = plain[0] >= 127 ? 3 : 0;
  const offset = 21 + extra;
  if(plain.length < offset + 4) return 0;
  return new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getInt32(offset, true);
}

/** Obfuscated abridged req_pq, split the way these sockets accept it. */
async function probeFrames() {
  let init: Uint8Array;
  do {
    init = bytesOf(64);
  } while(forbidden(init));
  init[56] = init[57] = init[58] = init[59] = 0xef;

  const encKey = init.slice(8, 40);
  const encIv = init.slice(40, 56);
  const reversed = init.slice().reverse();
  const decKey = reversed.slice(8, 40);
  const decIv = reversed.slice(40, 56);
  const encryptedInit = await aesCtr(encKey, encIv, init);
  const wireInit = concat(init.slice(0, 56), encryptedInit.slice(56, 64));

  const request = new Uint8Array(40);
  const view = new DataView(request.buffer);
  const now = Date.now();
  view.setInt32(8, now % 1000, true);
  view.setInt32(12, Math.floor(now / 1000), true);
  view.setInt32(16, 20, true);
  view.setInt32(20, REQ_PQ_MULTI, true);
  request.set(bytesOf(16), 24);
  const packet = concat(new Uint8Array([request.length >> 2]), request);
  const wirePacket = await aesCtr(encKey, addBlocks(encIv, 4), packet);
  return {wireInit, wirePacket, decKey, decIv};
}

function usableCached(front: string) {
  return FRONTS.includes(front) && front !== DIRECT;
}

async function loadCache() {
  try {
    for(const key of [CACHE_KEY, 'echogram_front_v4']) {
      const local = localStorage.getItem(key) || '';
      if(usableCached(local)) return local;
    }
  } catch{
  }

  try {
    const cache = await caches.open('echogram-front');
    const stored = await cache.match(CACHE_URL);
    const front = stored ? (await stored.text()).trim() : '';
    return usableCached(front) ? front : '';
  } catch{
    return '';
  }
}

async function saveCache(front: string) {
  try {
    localStorage.setItem(CACHE_KEY, front);
  } catch{
  }

  try {
    const cache = await caches.open('echogram-front');
    await cache.put(CACHE_URL, new Response(front));
  } catch{
  }
}

function probe(front: string) {
  let cancel = () => {};
  const promise = new Promise<Hit | null>((resolve) => {
    const startedAt = Date.now();
    let socket: WebSocket;
    let settled = false;
    const finish = (hit: Hit | null) => {
      if(settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch{
      }
      resolve(hit);
    };
    cancel = () => finish(null);
    const timer = setTimeout(() => finish(null), PROBE_MS);

    probeFrames().then(({wireInit, wirePacket, decKey, decIv}) => {
      if(settled) return;
      let gotMessage = false;
      socket = new WebSocket(`wss://kws2.${front}/apiws`, ['binary']);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        socket.send(wireInit);
        socket.send(wirePacket);
      };
      socket.onmessage = async(event) => {
        gotMessage = true;
        try {
          const data = new Uint8Array(event.data as ArrayBuffer);
          const plain = await aesCtr(decKey, decIv, data);
          finish(constructorId(plain) === RES_PQ ? {front, ms: Math.max(1, Date.now() - startedAt)} : null);
        } catch{
          finish(null);
        }
      };
      socket.onerror = () => {
        if(!gotMessage) finish(null);
      };
      socket.onclose = () => {
        if(!gotMessage) finish(null);
      };
    }).catch(() => finish(null));
  });
  return {promise, cancel};
}

async function probeFromHere() {
  if(probing) return;
  probing = true;
  const cached = await loadCache();
  const usable = FRONTS.filter((front) => front !== DIRECT && (isFrontUsable(front) || front === cached));
  const pool = usable.length ? usable : FRONTS.filter((front) => front !== DIRECT);
  const fresh = pool.filter((front) => front !== cached && !SLOW_FRONTS.includes(front)).sort(() => Math.random() - 0.5);
  const slow = pool.filter((front) => SLOW_FRONTS.includes(front));
  // The direct host is last and is used only when it itself returns resPQ.
  // Opening it before that is what leaves the chat empty without a VPN.
  const queue = [cached, ...fresh, ...slow, DIRECT].filter((front, index, list) => front && list.indexOf(front) === index);
  const found: Hit[] = [];
  const jobs: Array<ReturnType<typeof probe>> = [];
  const startedAt = Date.now();

  const stopProbes = () => {
    for(const job of jobs) job.cancel();
  };

  let saved = false;
  const consider = (hit: Hit) => {
    found.push(hit);
    if(hit.front === DIRECT) return;
    // Remember the spare. Switching here was aborting the socket that had
    // already started, so the chat never left "Waiting for network...".
    rememberFront(hit.front);
    if(!saved) {
      saved = true;
      saveCache(hit.front);
      log('front for this network', hit.front);
    }
  };

  let index = 0;
  const runNext = async() => {
    while(index < queue.length && Date.now() - startedAt < SEARCH_MS) {
      if(getActiveFront() && found.length >= 4) return;
      const front = queue[index++];
      const job = probe(front);
      jobs.push(job);
      const hit = await job.promise;
      if(hit) consider(hit);
    }
  };

  await Promise.race([
    Promise.all(Array.from({length: CONCURRENCY}, runNext)),
    new Promise<void>((resolve) => setTimeout(resolve, SEARCH_MS))
  ]);
  stopProbes();

  if(!getActiveFront()) {
    const ranked = found.filter((hit) => hit.front !== DIRECT).sort((a, b) => a.ms - b.ms);
    const best = ranked[0] || found.slice().sort((a, b) => a.ms - b.ms)[0];
    if(best && best.front !== DIRECT) rememberFront(best.front);
  }
  if(!getActiveFront()) {
    log('no front returned resPQ from this network');
  }

  probing = false;
  if(!getActiveFront()) {
    setTimeout(() => {
      if(!getActiveFront()) probeFromHere();
    }, 400);
    return;
  }

  if(probeQueued && !getActiveFront()) {
    probeQueued = false;
    probeFromHere();
  } else {
    probeQueued = false;
  }
}

export function startProxyAutoSelector() {
  if(started) return;
  started = true;
  // Before any chat socket exists. Otherwise it opens the blocked direct host.
  holdDirectHost(true);
  setFrontOrder(OPEN_FIRST);
  setGatewayChoice({transport: 'websocket', dcId: 2});
  finishGatewayProbe();
  setFrontExhaustedHandler(() => {
    setFrontOrder(OPEN_FIRST);
  });
  // The chat socket goes first. Probes opened at the same time were stalling it.
  setTimeout(() => probeFromHere(), 8000);
}
