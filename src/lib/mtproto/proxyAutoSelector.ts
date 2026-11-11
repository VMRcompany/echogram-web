import {BASE_DC_ID} from '@lib/accounts/authKeyFingerprint';
import {logger} from '@lib/logger';
import {getActiveProxyRoute, setActiveProxyRoute} from '@lib/mtproto/proxyRoute';

/**
 * Same selection as the Android client: download the public MTProto/SOCKS lists,
 * prefer RU entries, ping them, keep a cache, and stick to the fastest one that
 * actually opens. In the browser a ping is a WebSocket open — that is the only
 * transport this client can use — and the direct Telegram Web endpoint stays in
 * the race, so a healthy network keeps the official host.
 */
const log = logger('PROXY');

const HOST_PORT = /(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/g;
const JSON_FIELD = /"(host|ip|server|port|secret|country|cc)"\s*:\s*"?([^",}\]]+)"?/gi;
const TG_PROXY = /(?:tg:\/\/proxy|https:\/\/t\.me\/proxy)\?([^\s"'<>]+)/gi;
const CACHE_KEY = 'echogram_proxy_cache_v1';
const ENABLED_KEY = 'echogram_proxy_enabled';

const SOURCES = [
  'https://cdn.jsdelivr.net/gh/hookzof/socks5_list@master/tg/mtproto.json',
  'https://fastly.jsdelivr.net/gh/hookzof/socks5_list@master/tg/socks.json',
  'https://gcore.jsdelivr.net/gh/hookzof/socks5_list@master/tg/mtproto.json',
  'https://raw.gitmirror.com/hookzof/socks5_list/master/tg/mtproto.json',
  'https://ghproxy.net/https://raw.githubusercontent.com/hookzof/socks5_list/master/tg/mtproto.json',
  'https://kkgithub.com/hookzof/socks5_list/raw/master/tg/mtproto.json',
  'https://mtpro.xyz/api/?type=mtproto',
  'https://cdn.jsdelivr.net/gh/hookzof/socks5_list@master/tg/socks.json',
  'https://fastly.jsdelivr.net/gh/hookzof/socks5_list@master/tg/socks.json',
  'https://raw.gitmirror.com/hookzof/socks5_list/master/tg/socks.json',
  'https://ghproxy.net/https://raw.githubusercontent.com/hookzof/socks5_list/master/tg/socks.json',
  'https://mtpro.xyz/api/?type=socks',
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=2500'
];

type ProxyInfo = {
  address: string,
  port: number,
  secret: string,
  ru: boolean,
  official?: boolean
};

let started = false;
let fetching = false;
let settled = false;

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

function userWantsProxy() {
  return storageGet(ENABLED_KEY) !== '0';
}

function officialProxy(): ProxyInfo {
  return {
    address: `kws${BASE_DC_ID}.web.telegram.org`,
    port: 443,
    secret: '',
    ru: false,
    official: true
  };
}

function socketUrl(info: ProxyInfo) {
  if(info.official) return `wss://${info.address}/apiws`;
  const port = info.port === 443 ? '' : `:${info.port}`;
  return `wss://${info.address}${port}/apiws`;
}

function ping(info: ProxyInfo, timeout = 2500) {
  const startedAt = Date.now();
  return new Promise<number>((resolve) => {
    let settled = false;
    const finish = (time: number) => {
      if(settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch{
      }
      resolve(time);
    };

    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl(info), 'binary');
    } catch{
      resolve(-1);
      return;
    }

    const timer = setTimeout(() => finish(-1), timeout);
    socket.addEventListener('open', () => finish(Math.max(1, Date.now() - startedAt)));
    socket.addEventListener('error', () => finish(-1));
  });
}

function apply(info: ProxyInfo | null) {
  if(!info || info.official) {
    setActiveProxyRoute(null);
    log('using direct Telegram Web');
    return;
  }

  setActiveProxyRoute({address: info.address, port: info.port});
  log('using proxy', info.address, info.port);
}

async function download(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {Accept: '*/*'}
    });
    if(!response.ok) return '';
    const text = await response.text();
    return text.length > 400_000 ? text.slice(0, 400_000) : text;
  } catch{
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function addProxy(host: string, port: number, secret: string, ru: ProxyInfo[], other: ProxyInfo[], isRu: boolean) {
  if(!host || port <= 0 || port > 65535) return;
  secret ||= '';
  const all = ru.concat(other);
  if(all.some((item) => item.address === host && item.port === port && item.secret === secret)) return;
  (isRu ? ru : other).push({address: host, port, secret, ru: isRu});
}

function addFromQuery(query: string, ru: ProxyInfo[], other: ProxyInfo[]) {
  let host = '';
  let port = 0;
  let secret = '';
  for(const part of query.split('&')) {
    const eq = part.indexOf('=');
    if(eq <= 0) continue;
    const key = part.slice(0, eq);
    let value = part.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch{
    }
    if(key.toLowerCase() === 'server' || key.toLowerCase() === 'host') host = value;
    else if(key.toLowerCase() === 'port') port = parseInt(value, 10) || 0;
    else if(key.toLowerCase() === 'secret') secret = value;
  }
  addProxy(host, port, secret, ru, other, false);
}

function addFromJsonObject(obj: string, ru: ProxyInfo[], other: ProxyInfo[]) {
  JSON_FIELD.lastIndex = 0;
  let host = '';
  let port = 0;
  let secret = '';
  let isRu = false;
  for(const match of obj.matchAll(JSON_FIELD)) {
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if(key === 'host' || key === 'ip' || key === 'server') host = value;
    else if(key === 'port') port = parseInt(value.replace(/[^0-9]/g, ''), 10) || 0;
    else if(key === 'secret') secret = value;
    else if(key === 'country' || key === 'cc') {
      isRu = value.toUpperCase().includes('RU') || value.toLowerCase().includes('russia');
    }
  }
  addProxy(host, port, secret, ru, other, isRu);
}

function parseList(body: string, ru: ProxyInfo[], other: ProxyInfo[]) {
  if(!body) return;
  TG_PROXY.lastIndex = 0;
  for(const match of body.matchAll(TG_PROXY)) {
    if(ru.length + other.length >= 50) return;
    addFromQuery(match[1], ru, other);
  }
  let from = 0;
  while(from < body.length && ru.length + other.length < 50) {
    const start = body.indexOf('{', from);
    if(start < 0) break;
    const end = body.indexOf('}', start);
    if(end < 0) break;
    addFromJsonObject(body.slice(start, end + 1), ru, other);
    from = end + 1;
  }
  if(ru.length + other.length < 50) {
    HOST_PORT.lastIndex = 0;
    for(const match of body.matchAll(HOST_PORT)) {
      if(ru.length + other.length >= 50) break;
      addProxy(match[1], parseInt(match[2], 10), '', ru, other, false);
    }
  }
}

async function downloadLists() {
  const ru: ProxyInfo[] = [];
  const other: ProxyInfo[] = [];
  const bodies = await Promise.all(SOURCES.map((source) => download(source)));
  for(const body of bodies) {
    if(body && body.length > 16) parseList(body, ru, other);
  }
  return ru.concat(other);
}

function saveCache(list: ProxyInfo[]) {
  const lines = list.slice(0, 40).map((info) => `${info.address}|${info.port}|${info.secret}`);
  storageSet(CACHE_KEY, lines.join('\n'));
}

function loadCache() {
  const result: ProxyInfo[] = [];
  const raw = storageGet(CACHE_KEY);
  if(!raw) return result;
  for(const line of raw.split('\n')) {
    const parts = line.split('|');
    if(parts.length < 2) continue;
    const port = parseInt(parts[1], 10);
    if(!parts[0] || !port) continue;
    result.push({address: parts[0], port, secret: parts[2] || '', ru: false});
  }
  return result;
}

function pingThenConnect(list: ProxyInfo[]) {
  if(settled || !userWantsProxy() || !list.length) return;

  const candidates = [officialProxy(), ...list.filter((item) => !item.official)].slice(0, 21);
  let official: ProxyInfo | null = null;
  let officialPing = Number.POSITIVE_INFINITY;
  let proxy: ProxyInfo | null = null;
  let proxyPing = Number.POSITIVE_INFINITY;
  let applied = false;
  const applyBest = () => {
    if(applied) return;
    applied = true;
    settled = true;
    // The kws*.web.telegram.org relay is what opens in networks that block
    // Telegram's datacenter addresses. A public proxy is only a fallback.
    apply(official || proxy);
  };
  const timer = setTimeout(applyBest, 2500);

  for(const info of candidates) {
    ping(info).then((time) => {
      if(!userWantsProxy() || time <= 0) return;
      if(info.official && time < officialPing) {
        officialPing = time;
        official = info;
      } else if(!info.official && time < proxyPing) {
        proxyPing = time;
        proxy = info;
      }
      if(info.official && time <= 1500) {
        clearTimeout(timer);
        applyBest();
      }
    });
  }
}

async function fetchFromInternetAndPing() {
  if(!userWantsProxy() || fetching) return;
  fetching = true;
  const cached = loadCache();
  if(cached.length) pingThenConnect(cached);
  try {
    const fetched = await downloadLists();
    if(fetched.length) {
      saveCache(fetched);
      pingThenConnect(fetched);
    }
  } finally {
    fetching = false;
  }
}

async function ensureWorkingProxy() {
  if(!userWantsProxy()) {
    setActiveProxyRoute(null);
    return;
  }

  const current = getActiveProxyRoute();
  if(!current) {
    fetchFromInternetAndPing();
    return;
  }

  const time = await ping({address: current.address, port: current.port, secret: '', ru: false});
  if(time < 0) {
    setActiveProxyRoute(null);
    fetchFromInternetAndPing();
    return;
  }

  if(!fetching) {
    fetching = true;
    downloadLists().then((fetched) => {
      if(fetched.length) saveCache(fetched);
    }).finally(() => {
      fetching = false;
    });
  }
}

export function startProxyAutoSelector() {
  if(started) {
    if(userWantsProxy()) ensureWorkingProxy();
    return;
  }
  started = true;
  setTimeout(() => {
    if(userWantsProxy()) ensureWorkingProxy();
  }, 200);
}

export function requestProxyReplacement() {
  if(!userWantsProxy()) return;
  settled = false;
  setActiveProxyRoute(null);
  fetchFromInternetAndPing();
}
