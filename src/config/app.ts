/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import type {TrueDcId} from '@types';
import {BASE_DC_ID} from '@lib/accounts/authKeyFingerprint';

export const MAIN_DOMAINS = ['web.telegram.org', 'webk.telegram.org'];
export const DEFAULT_BACKGROUND_SLUG = 'pattern';

const threads = Math.min(4, navigator.hardwareConcurrency ?? 4);

// Echogram credentials (REACT_APP_*) win. VITE_API_* remains the upstream name.
const apiIdFromEnv = import.meta.env.REACT_APP_TELEGRAM_API_ID || import.meta.env.VITE_API_ID;
const apiHashFromEnv = import.meta.env.REACT_APP_TELEGRAM_API_HASH || import.meta.env.VITE_API_HASH;

const App = {
  id: +apiIdFromEnv,
  hash: apiHashFromEnv,
  pushServerKey: import.meta.env.VITE_PUSH_SERVER_KEY,
  version: import.meta.env.VITE_VERSION,
  versionFull: import.meta.env.VITE_VERSION_FULL,
  build: +import.meta.env.VITE_BUILD,
  langPackVersion: +import.meta.env.VITE_LANG_PACK_VERSION,
  // Empty on purpose. "webk" is the official WebK client, and a third-party
  // app that signs in under that name is rejected and the account is banned.
  // Translations still load from the public "web" pack.
  langPack: '',
  langPackCode: 'en',
  domains: MAIN_DOMAINS,
  baseDcId: BASE_DC_ID as TrueDcId,
  isMainDomain: MAIN_DOMAINS.includes(location.hostname),
  suffix: 'K',
  threads,
  lottieWorkers: threads,
  cryptoWorkers: threads,
  interclientBroadcastChannel: 'tgweb'
};

export function getAppVersionText() {
  return `Echogram Web ${App.version}`;
}

export default App;
