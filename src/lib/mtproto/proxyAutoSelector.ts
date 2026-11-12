import {logger} from '@lib/logger';
import {finishGatewayProbe, getActiveFront, isFrontUsable, rememberFront, setFrontExhaustedHandler, setFrontOrder, setGatewayChoice} from '@lib/mtproto/proxyRoute';

/**
 * Each browser races Telegram's own web API and the Cloudflare fronts from
 * the network it is on. Only a host that returns a real resPQ is kept.
 * The direct host wins when it answers. If it is blocked, the fastest front
 * that answered is used, and a dead one is replaced by the next.
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

const CACHE_KEY = 'echogram_front_v3';
const CACHE_URL = 'https://echogram.local/front';
const PROBE_MS = 4000;
const DIRECT_WINDOW_MS = 1300;
const RES_PQ = 85337187;
const REQ_PQ_MULTI = -1099002127;

type Hit = {front: string, ms: number};

let started = false;
let probing = false;

function bytesOf(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function writeInt32(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer).setInt32(offset, value, true);
}

/** Same plain HTTP body Telegram's web client posts to /apiw1. */
function probeBody() {
  const body = new Uint8Array(40);
  const now = Date.now();
  writeInt32(body, 8, now % 1000);
  writeInt32(body, 12, Math.floor(now / 1000));
  writeInt32(body, 16, 20);
  writeInt32(body, 20, REQ_PQ_MULTI);
  body.set(bytesOf(16), 24);
  return body;
}

function isResPq(buffer: ArrayBuffer) {
  if(buffer.byteLength < 24) return false;
  return new DataView(buffer).getInt32(20, true) === RES_PQ;
}

async function loadCache() {
  try {
    const local = localStorage.getItem(CACHE_KEY) || '';
    if(FRONTS.includes(local)) return local;
  } catch{
  }

  try {
    const cache = await caches.open('echogram-front');
    const stored = await cache.match(CACHE_URL);
    const front = stored ? (await stored.text()).trim() : '';
    return FRONTS.includes(front) ? front : '';
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
  return new Promise<Hit | null>((resolve) => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_MS);
    fetch(`https://kws2.${front}/apiw1`, {
      method: 'POST',
      body: probeBody(),
      signal: controller.signal
    }).then(async(response) => {
      if(response.status !== 200) return null;
      const buffer = await response.arrayBuffer();
      if(!isResPq(buffer)) return null;
      return {front, ms: Math.max(1, Date.now() - startedAt)};
    }).then((hit) => resolve(hit || null), () => resolve(null)).finally(() => clearTimeout(timer));
  });
}

async function probeFromHere() {
  if(probing) return;
  probing = true;
  const cached = await loadCache();
  const usable = FRONTS.filter((front) => isFrontUsable(front));
  const fronts = usable.length ? usable : FRONTS;
  const found: Hit[] = [];
  let committed = false;
  let waitDirect: number | undefined;
  const probeStarted = Date.now();

  const commit = (front: string) => {
    if(committed) {
      rememberFront(front);
      return;
    }

    committed = true;
    if(waitDirect) clearTimeout(waitDirect);
    const rest = found.map((hit) => hit.front).filter((name) => name !== front);
    setFrontOrder([front, ...rest]);
    setGatewayChoice({transport: 'https', dcId: 2});
    finishGatewayProbe();
    saveCache(front);
    log('front for this network', front);
  };

  const consider = (hit: Hit) => {
    found.push(hit);
    rememberFront(hit.front);
    if(hit.front === DIRECT) {
      commit(DIRECT);
      return;
    }

    if(committed || waitDirect) return;
    // Direct still has a short chance to win. A blocked network does not sit
    // through the whole timeout: the fastest front is taken once that window ends.
    const wait = Math.max(0, DIRECT_WINDOW_MS - (Date.now() - probeStarted));
    waitDirect = setTimeout(() => {
      if(getActiveFront() === DIRECT) return;
      const fastest = found.filter((item) => item.front !== DIRECT).sort((a, b) => a.ms - b.ms)[0];
      if(fastest) commit(fastest.front);
    }, wait);
  };

  await Promise.all(fronts.map(async(front) => {
    const hit = await probe(front);
    if(hit) consider(hit);
  }));

  if(!committed) {
    if(cached && isFrontUsable(cached)) commit(cached);
    else finishGatewayProbe();
    if(!getActiveFront()) log('no front returned resPQ from this network');
  }

  probing = false;
}

export function startProxyAutoSelector() {
  if(started) return;
  started = true;
  setFrontExhaustedHandler(() => {
    setTimeout(() => probeFromHere(), 2000);
  });
  probeFromHere();
}
