import aesjs from 'aes-js';
import CTR from '@lib/crypto/utils/aesCTR';
import subtle from '@lib/crypto/subtle';

// iOS 10–13 and old Android have no AES-CTR in Web Crypto (it arrived in
// Safari 14.1). The handshake then never gets a reply. aes-js is plain ES5.
class SoftwareCtr {
  private mode: {encrypt: (data: Uint8Array) => ArrayLike<number>};

  constructor(key: Uint8Array, iv: Uint8Array) {
    this.mode = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(iv));
  }

  public async update(data: Uint8Array) {
    return new Uint8Array(this.mode.encrypt(data));
  }
}

const aesCTRs: Map<number, K> = new Map();
let lastCTRId = -1;
let softwareCtr = false;

type CtrLike = {update: (data: Uint8Array) => Promise<Uint8Array>};

type K = {
  enc: CtrLike,
  dec: CtrLike
};

export async function aesCtrPrepare({encKey, encIv, decKey, decIv}: {[k in 'encKey' | 'encIv' | 'decKey' | 'decIv']: Uint8Array}) {
  const id = ++lastCTRId;

  if(!softwareCtr && subtle) {
    try {
      const a = [['encrypt', encKey], ['decrypt', decKey]] as ['encrypt' | 'decrypt', Uint8Array][];
      const promises = a.map(([mode, key]) => {
        return subtle.importKey(
          'raw',
          key as BufferSource,
          {name: 'AES-CTR'},
          false,
          [mode]
        );
      });

      const [encCryptoKey, decCryptoKey] = await Promise.all(promises);
      aesCTRs.set(id, {
        enc: new CTR('encrypt', encCryptoKey, encIv.slice()),
        dec: new CTR('decrypt', decCryptoKey, decIv.slice())
      });
      return id;
    } catch{
      softwareCtr = true;
    }
  }

  aesCTRs.set(id, {
    enc: new SoftwareCtr(encKey, encIv.slice()),
    dec: new SoftwareCtr(decKey, decIv.slice())
  });
  return id;
}

export async function aesCtrProcess({id, data, operation}: {id: number, data: Uint8Array, operation: 'encrypt' | 'decrypt'}) {
  const ctrs = aesCTRs.get(id);
  const result = await (operation === 'encrypt' ? ctrs.enc : ctrs.dec).update(data);
  return result;
}

export function aesCtrDestroy(id: number) {
  aesCTRs.delete(id);
}
