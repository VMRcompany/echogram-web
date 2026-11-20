import {LOADED_KEPT_FLAGS} from '@config/modes';

/**
 * iOS 7 through 10, and Android 4.4 through 6.x. Newer systems stay on the
 * ordinary interface. The same check is written in index.html so the class is
 * on the page before the modules run; keep the two copies in step.
 */
export function isLegacyOperatingSystem(ua = navigator.userAgent) {
  const ios = ua.match(/(?:iPhone|iPad|iPod).*OS (\d+)[_.]/);
  if(ios) {
    const major = +ios[1];
    return major >= 7 && major <= 10;
  }

  const android = ua.match(/Android (\d+)(?:\.(\d+))?/);
  if(!android) return false;
  const major = +android[1];
  const minor = +(android[2] || 0);
  if(major === 4) return minor >= 4;
  return major === 5 || major === 6;
}

/** Old systems always, and any other device when Experimental has forced it. */
export function isLiteInterface() {
  return isLegacyOperatingSystem() || LOADED_KEPT_FLAGS.has('lite');
}
