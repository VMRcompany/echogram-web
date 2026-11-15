import bufferConcats from '@helpers/bytes/bufferConcats';

const root: any = typeof globalThis === 'undefined' ? self : globalThis;
if(typeof globalThis === 'undefined') root.globalThis = root;

if(typeof root.queueMicrotask !== 'function') {
  root.queueMicrotask = (callback: () => void) => {
    Promise.resolve().then(callback);
  };
}

if(typeof root.structuredClone !== 'function') {
  root.structuredClone = function structuredClone(value: unknown) {
    const seen = new WeakMap<object, unknown>();
    const walk = (item: any): any => {
      if(item === null || typeof item !== 'object') return item;
      if(typeof Date !== 'undefined' && item instanceof Date) return new Date(item.getTime());
      if(typeof ArrayBuffer !== 'undefined' && item instanceof ArrayBuffer) return item.slice(0);
      if(typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(item)) return new item.constructor(item);
      if(seen.has(item)) return seen.get(item);
      if(item instanceof Map) {
        const copy = new Map();
        seen.set(item, copy);
        item.forEach((entry, key) => copy.set(walk(key), walk(entry)));
        return copy;
      }
      if(item instanceof Set) {
        const copy = new Set();
        seen.set(item, copy);
        item.forEach((entry) => copy.add(walk(entry)));
        return copy;
      }
      if(Array.isArray(item)) {
        const copy: unknown[] = [];
        seen.set(item, copy);
        for(const entry of item) copy.push(walk(entry));
        return copy;
      }
      const copy: Record<string, unknown> = {};
      seen.set(item, copy);
      for(const key of Object.keys(item)) copy[key] = walk(item[key]);
      return copy;
    };
    return walk(value);
  };
}

if(typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function' && crypto.getRandomValues) {
  crypto.randomUUID = (() => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }) as Crypto['randomUUID'];
}

if(!String.prototype.replaceAll) {
  String.prototype.replaceAll = function(search: any, replace: any) {
    if(search instanceof RegExp) {
      if(!search.global) throw new TypeError('replaceAll called with a non-global RegExp');
      return this.replace(search, replace);
    }
    const text = String(search);
    if(typeof replace === 'function') {
      return this.replace(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replace);
    }
    return this.split(text).join(replace);
  };
}

if(!Object.hasOwn) {
  Object.hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
}

if(!Object.fromEntries) {
  Object.fromEntries = (entries: Iterable<readonly [PropertyKey, any]>) => {
    const object: Record<PropertyKey, any> = {};
    for(const [key, value] of entries) object[key as any] = value;
    return object;
  };
}

if(!Promise.allSettled) {
  Promise.allSettled = ((items: Iterable<unknown>) => Promise.all(Array.from(items, (item) => Promise.resolve(item).then(
    (value) => ({status: 'fulfilled' as const, value}),
    (reason) => ({status: 'rejected' as const, reason})
  )))) as PromiseConstructor['allSettled'];
}

function at(this: {length: number, [index: number]: unknown}, index: number) {
  index = Math.trunc(index) || 0;
  if(index < 0) index += this.length;
  if(index < 0 || index >= this.length) return undefined;
  return this[index];
}

if(!Array.prototype.at) Array.prototype.at = at as Array<unknown>['at'];
if(!String.prototype.at) String.prototype.at = at as String['at'];

if(!Array.prototype.findLast) {
  Array.prototype.findLast = function(callback, thisArg) {
    for(let index = this.length - 1; index >= 0; --index) {
      if(index in this && callback.call(thisArg, this[index], index, this)) return this[index];
    }
  };
}

Uint8Array.prototype.concat = function(...args: Array<Uint8Array | ArrayBuffer | number[]>) {
  return bufferConcats(this, ...args);
};

/* Uint8Array.prototype.toString = function() {
  return String.fromCharCode.apply(null, [...this]);
}; */

Uint8Array.prototype.toJSON = function() {
  return [...this];
  // return {type: 'bytes', value: [...this]};
};

Promise.prototype.finally = Promise.prototype.finally || function<T>(this: Promise<T>, fn: () => any) {
  const onFinally = (callback: typeof fn) => Promise.resolve(fn()).then(callback);
  return this.then(
    (result) => onFinally(() => result),
    (reason) => onFinally(() => Promise.reject(reason))
  );
};

declare global {
  interface Uint8Array {
    concat: (...args: Array<Uint8Array | ArrayBuffer | number[]>) => Uint8Array,
    // toString: () => string,
    toJSON: () => number[] | {type: string, data: number[]},
    // toJSON: () => {type: 'bytes', value: number[]},
  }
}
