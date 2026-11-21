import type {logger} from '@lib/logger';
import type {TimeManager} from '@lib/mtproto/timeManager';
import type MTPNetworker from '@lib/mtproto/networker';
import type MTTransport from '@lib/mtproto/transports/transport';
import {MTAuthKey} from '@lib/mtproto/authKey';
import bytesFromHex from '@helpers/bytes/bytesFromHex';
import bytesToHex from '@helpers/bytes/bytesToHex';
import makeError from '@helpers/makeError';
import pause from '@helpers/schedulers/pause';
import withTimeout from '@helpers/schedulers/withTimeout';

// * the lifetime asked for a temporary key (tdesktop asks the same)
export const TEMP_AUTH_KEY_EXPIRES_IN = 86400;
// * making, binding and introducing a key, all over one connection
const MAKE_TIMEOUT = 30000;
const MAX_RETRY_DELAY = 16000;
// * a kept key with less than this left is not worth picking up: a fresh one is made instead
const RESTORE_MIN_LIFETIME = 10 * 60;

// * What is kept of a temporary key between runs, next to the permanent key it is bound to: the
// * handshake, the binding and the introduction cost a cold start ~1.4 s otherwise. It weakens
// * forward secrecy for the key's own lifetime only, and only for someone who both recorded the
// * traffic inside TLS and later took the stored permanent key as well - the server side, whose
// * long-lived keys PFS is mostly about, is untouched.
export type StoredTempAuthKey = {
  key: string, // hex
  salt: string, // hex
  expiresAt: number,
  permKeyId: string // hex - the permanent key it is bound to
};

export type TempAuthKeysOptions = {
  permAuthKey: MTAuthKey,
  timeManager: TimeManager,
  log: ReturnType<typeof logger>,
  // * a connection of its own for every key: the plain handshake and the binding go over it
  createTransport: () => MTTransport,
  authTemp: (transport: MTTransport, expiresIn: number) => Promise<{authKey?: MTAuthKey, serverSalt?: Uint8Array}>,
  // * a networker for one job, out of the pool: no status, no updates
  createNetworker: (options: {authKey: MTAuthKey, permAuthKey: MTAuthKey}) => MTPNetworker,
  // * the key kept from an earlier run, and keeping the current one (`undefined` drops it)
  load?: () => Promise<StoredTempAuthKey>,
  store?: (stored: StoredTempAuthKey) => void
};

/**
 * Perfect Forward Secrecy for one DC (or its media cluster) of one account:
 * the temporary key every networker there talks over, bound to the
 * permanent one.
 *
 * A key is made, bound (auth.bindTempAuthKey) and introduced with
 * initConnection over a connection and a session of its own, so networkers
 * only ever see ready keys. A new one is made once the current one expires or
 * the server forgets it (-404) or its binding (AUTH_KEY_PERM_EMPTY), and the
 * networkers move to it. The current key is kept (see StoredTempAuthKey) and
 * picked up again by the next run while it lasts.
 */
export default class TempAuthKeys {
  private authKey: MTAuthKey;
  private making: Promise<void>;
  private networkers: Set<MTPNetworker> = new Set();
  private failures = 0;
  private restored: boolean;
  private log: ReturnType<typeof logger>;

  constructor(private options: TempAuthKeysOptions) {
    this.log = options.log;
  }

  public attach(networker: MTPNetworker) {
    this.networkers.add(networker);
  }

  public detach(networker: MTPNetworker) {
    this.networkers.delete(networker);
  }

  public isUsable(authKey: MTAuthKey) {
    return !!authKey && !authKey.invalid && this.options.timeManager.getServerTime() < authKey.expiresAt;
  }

  /**
   * The ready key to talk over, if there is one; otherwise the next one is
   * being made.
   */
  public getAuthKey() {
    if(this.isUsable(this.authKey)) {
      return this.authKey;
    }

    this.authKey = undefined;
    this.making ??= this.make().finally(() => {
      this.making = undefined;
    });
  }

  /**
   * Make the temporary key on the socket the chat will keep. A second socket
   * is another address, and Telegram bans the account about half an hour later.
   */
  public async prepare(transport: MTTransport) {
    this.restored = true;
    if(this.isUsable(this.authKey)) return;

    let error: unknown;
    for(let attempt = 0; attempt < 3; attempt++) {
      try {
        const authKey = await this.makeOne(transport);
        this.failures = 0;
        this.adopt(authKey);
        this.remember(authKey);
        return;
      } catch(err) {
        error = err;
        this.log.error('can\'t make temporary auth key on the live socket', err);
        await pause(1000);
      }
    }

    throw error;
  }

  public current() {
    return this.isUsable(this.authKey) ? this.authKey : undefined;
  }

  private remember(authKey: MTAuthKey) {
    this.options.store?.({
      key: bytesToHex(authKey.key),
      salt: bytesToHex(authKey.serverSalt),
      expiresAt: authKey.expiresAt,
      permKeyId: bytesToHex(this.options.permAuthKey.id)
    });
  }

  /**
   * The server knows nothing of `authKey` or of its binding anymore.
   */
  public invalidate(authKey: MTAuthKey) {
    if(!authKey || authKey.invalid) {
      return;
    }

    this.log.warn('temporary auth key is gone', bytesToHex(authKey.id));
    authKey.invalid = true;
    if(authKey === this.authKey) {
      this.options.store?.(undefined);
    }

    this.getAuthKey();
  }

  private adopt(authKey: MTAuthKey) {
    this.authKey = authKey;
    this.log('temporary auth key is ready', bytesToHex(authKey.id), authKey.expiresAt);
    // * the waiting networkers go on over it
    this.networkers.forEach((networker) => networker.scheduleRequest());
  }

  // * The key an earlier run kept, if it is still bound to this permanent key and lasts a while
  private async restore() {
    try {
      const stored = await this.options.load?.();
      if(!stored) {
        return;
      }

      const lifetime = stored.expiresAt - this.options.timeManager.getServerTime();
      if(stored.permKeyId !== bytesToHex(this.options.permAuthKey.id) || lifetime < RESTORE_MIN_LIFETIME) {
        this.options.store?.(undefined);
        return;
      }

      const authKey = await MTAuthKey.fromKey(bytesFromHex(stored.key));
      authKey.expiresAt = stored.expiresAt;
      authKey.serverSalt = bytesFromHex(stored.salt);
      return authKey;
    } catch(err) {
      this.log.error('can\'t restore temporary auth key', err);
    }
  }

  private async make() {
    // A key kept from an earlier run was born on another address. Using it
    // from this one is what gets the account banned.
    this.restored = true;

    for(;;) {
      const transport = this.liveTransport() || this.options.createTransport();
      const owned = !this.liveTransport();
      try {
        const authKey = await this.makeOne(transport);
        this.failures = 0;
        this.adopt(authKey);
        this.remember(authKey);
        return;
      } catch(err) {
        if(owned) transport.destroy();
        const delay = Math.min(MAX_RETRY_DELAY, 1000 * 2 ** this.failures++);
        this.log.error('can\'t make temporary auth key, retrying in', delay, err);
        await pause(delay);
      }
    }
  }

  private liveTransport() {
    for(const networker of this.networkers) {
      if(networker.transport) return networker.transport;
    }
  }

  private async makeOne(transport: MTTransport) {
    const {options} = this;
    let helper: MTPNetworker;

    const make = async() => {
      const {authKey, serverSalt} = await options.authTemp(transport, TEMP_AUTH_KEY_EXPIRES_IN);
      authKey.serverSalt = serverSalt;
      helper = options.createNetworker({authKey, permAuthKey: options.permAuthKey});
      helper.changeTransport(transport);

      if(!(await helper.bindTempAuthKey())) {
        throw makeError('BIND_FAILED');
      }

      // * the client info has to be given again after every binding
      await helper.wrapApiCall('help.getNearestDc');
      return authKey;
    };

    try {
      const authKey = await withTimeout(make(), MAKE_TIMEOUT);
      if(!authKey) {
        throw makeError('TIMEOUT');
      }

      return authKey;
    } finally {
      if(helper) {
        const kept = helper.releaseTransport();
        const owner = [...this.networkers].find((networker) => networker.transport === kept);
        if(kept) kept.networker = owner;
        helper.destroy();
      }
    }
  }
}
