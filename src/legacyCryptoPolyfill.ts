import {Crypto} from '@peculiar/webcrypto';

// Old iPad and Android browsers have no Web Crypto. This file is loaded only
// with the legacy bundle, so current phones and computers do not download it.
const scope: any = typeof self !== 'undefined' ? self : window;
const impl = new Crypto();
if(typeof scope.crypto === 'undefined') {
  scope.crypto = impl;
} else if(!scope.crypto.subtle) {
  try {
    Object.defineProperty(scope.crypto, 'subtle', {value: impl.subtle, configurable: true});
  } catch(err) {
    scope.crypto.subtle = impl.subtle;
  }
}
