import type {DcId, TrueDcId} from '@types';
import pause from '@helpers/schedulers/pause';
import {logger, LogTypes} from '@lib/logger';
import MTTransport from '@lib/mtproto/transports/transport';
import Modes from '@config/modes';
import transportController from '@lib/mtproto/transports/controller';
import {applyHttpsUrl, getActiveFront, noteFrontFailed, whenGatewayReady} from '@lib/mtproto/proxyRoute';
// import networkStats from '@lib/mtproto/networkStats';

const TEST_DROPPING_REQUESTS: TrueDcId = undefined;

export default class HTTP implements MTTransport {
  public noScheduler: boolean;
  private log: ReturnType<typeof logger>;

  private pending: Array<{
    resolve: (body: Uint8Array) => void,
    reject: any,
    body: Uint8Array
  }> = [];
  private releasing: boolean;

  public connected: boolean;
  private destroyed: boolean;
  private debug: boolean;
  private media: boolean;
  private testPath: boolean;
  private proven: boolean;
  private waitedGate: boolean;

  constructor(
    protected dcId: DcId,
    protected url: string,
    logSuffix: string
  ) {
    this.debug = Modes.debug && false;

    let logTypes = LogTypes.Error | LogTypes.Log;
    if(this.debug) logTypes |= LogTypes.Debug;

    this.log = logger(`HTTP-${dcId}` + logSuffix, logTypes);
    this.log('constructor');

    this.connected = false;
    this.media = /:\/\/[a-z0-9]+-1\./i.test(url);
    this.testPath = url.includes('apiw_test');
    this.proven = false;
    this.waitedGate = false;
  }

  public async _send(
    body: Uint8Array,
    mode?: RequestMode,
    timeoutMs?: number
  ) {
    this.debug && this.log.debug('-> body length to send:', body.length);

    if(!mode) {
      if(!this.waitedGate) {
        this.waitedGate = true;
        await whenGatewayReady();
      }

      const next = applyHttpsUrl(this.dcId, this.media, this.testPath);
      if(next && next !== this.url) {
        this.url = next;
        this.proven = false;
      }
    }

    const frontAtSend = getActiveFront();
    const limit = timeoutMs ?? (this.proven ? 30000 : (frontAtSend ? 4500 : 20000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), limit);

    // networkStats.addSent(this.dcId, length);
    return fetch(this.url, {method: 'POST', body: body as BodyInit, mode, signal: controller.signal})
    .then(async(response) => {
      if(response.status !== 200 && !mode) {
        response.arrayBuffer().then((buffer) => {
          this.log.error('not 200',
            new TextDecoder('utf-8').decode(new Uint8Array(buffer)));
        });

        throw response;
      }

      this.setConnected(true);

      // * test resending by dropping random request
      if(TEST_DROPPING_REQUESTS && this.dcId === TEST_DROPPING_REQUESTS && Math.random() > .5) {
        controller.abort();
        throw 'test';
      }

      const buffer = await response.arrayBuffer();
      // networkStats.addReceived(this.dcId, buffer.byteLength);
      if(!mode) this.proven = true;
      return new Uint8Array(buffer);
    }).catch((err) => {
      this.setConnected(false);
      // A no-cors ping must not retire a front that the real probe already kept.
      if(!mode && !this.destroyed && frontAtSend && getActiveFront() === frontAtSend) noteFrontFailed();
      throw err;
    }).finally(() => {
      clearTimeout(timeout);
    });
  }

  private setConnected(connected: boolean) {
    if(this.connected === connected || this.destroyed) {
      return;
    }

    this.connected = connected;

    if(import.meta.env.VITE_MTPROTO_AUTO && Modes.multipleTransports) {
      transportController.setTransportValue('https', connected);
    }
  }

  public destroy() {
    this.setConnected(false);
    this.destroyed = true;
    this.pending.forEach((pending) => pending.reject());
    this.pending.length = 0;
  }

  public send(body: Uint8Array) {
    if(this.noScheduler) {
      return this._send(body);
    } else {
      const promise = new Promise<typeof body>((resolve, reject) => {
        this.pending.push({resolve, reject, body});
      });

      this.releasePending();

      return promise;
    }
  }

  /**
   * ! will resend the request on error
   */
  private async releasePending() {
    if(this.releasing) return;

    this.releasing = true;
    // this.log('-> messages to send:', this.pending.length);
    for(let i = 0; i < this.pending.length; ++i) {
      const pending = this.pending[i];
      const {body, resolve} = pending;

      try {
        const result = await this._send(body);
        resolve(result);
        this.pending.splice(i, 1);
      } catch(err) {
        this.log.error('Send plain request error:', err);
        await pause(getActiveFront() ? 250 : 1500);
      }

      --i;
    }

    this.releasing = false;
  }
}
