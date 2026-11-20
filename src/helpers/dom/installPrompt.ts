let callback: () => Promise<void>;
const listeners = new Set<() => void>();

export default function cacheInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (deferredPrompt: any) => {
    callback = async() => {
      deferredPrompt.prompt();
      const {outcome} = await deferredPrompt.userChoice;
      const installed = outcome === 'accepted';
      if(installed) {
        callback = undefined;
        document.getElementById('echogram-install-hint')?.remove();
      }
    };
    listeners.forEach((listener) => listener());
  });
}

export function getInstallPrompt() {
  return callback;
}

export function onInstallPrompt(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const HINT_KEY = 'echogram_desktop_install_hint';

/** A phone or tablet is asked to install the site as its own app, without the browser frame. */
function mobileInstallCopy(ua: string) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh|Mac OS X/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  if(!ios && !android) return null;
  const ru = (navigator.language || '').toLowerCase().startsWith('ru');
  return {
    ios,
    text: ru ?
      'Установите Echogram Web на экран «Домой». Откроется отдельное приложение, без рамок и окон Safari или Chrome.' :
      'Install Echogram Web on the Home Screen. It opens as its own app, with no Safari or Chrome frame.',
    steps: ios ?
      (ru ?
        'Нажмите «Поделиться», затем «На экран Домой».' :
        'Tap Share, then Add to Home Screen.') :
      (ru ?
        'В меню Chrome или браузера нажмите «Установить приложение» или «Добавить на главный экран».' :
        'In the Chrome menu, tap Install app or Add to Home screen.')
  };
}

/** Windows, macOS, iPhone and Android get a suggestion to install the site as an app. */
export function showDesktopInstallHint() {
  const ua = navigator.userAgent || '';
  const mobile = mobileInstallCopy(ua);
  const macDesktop = !mobile && /Macintosh|Mac OS X/.test(ua) && navigator.maxTouchPoints < 2;
  const windows = !mobile && /Windows/.test(ua);
  if(!mobile && !macDesktop && !windows) return;
  if(matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) return;
  try {
    if(localStorage.getItem(HINT_KEY) === '1') return;
  } catch{ /* private mode */ }

  const ru = (navigator.language || '').toLowerCase().startsWith('ru');
  const root = document.createElement('aside');
  root.id = 'echogram-install-hint';
  root.setAttribute('role', 'dialog');
  root.style.cssText = [
    'position:fixed', 'z-index:10000', 'left:50%', 'top:16px', 'transform:translateX(-50%)',
    'width:min(440px,calc(100% - 24px))', 'box-sizing:border-box', 'padding:14px 16px',
    'border-radius:16px', 'background:var(--surface-color,#fff)', 'color:var(--primary-text-color,#222)',
    'box-shadow:0 8px 28px rgba(0,0,0,.18)', 'font:14px/1.4 system-ui,sans-serif'
  ].join(';');

  const text = document.createElement('p');
  text.style.cssText = 'margin:0 0 10px';
  text.textContent = mobile ? mobile.text : (ru ?
    'Поставьте Echogram Web на панель задач и на рабочий стол. Откроется настоящее приложение, а внутри него — этот сайт.' :
    'Pin Echogram Web to the taskbar and put it on the desktop. It installs as an app and opens this site.');

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = ru ? 'Не сейчас' : 'Not now';
  later.style.cssText = 'border:0;background:transparent;color:inherit;cursor:pointer;padding:8px 10px;border-radius:10px';
  later.addEventListener('click', () => {
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch{ /* ignore */ }
    root.remove();
  });

  const install = document.createElement('button');
  install.type = 'button';
  install.style.cssText = 'border:0;background:var(--primary-color,#3390ec);color:#fff;cursor:pointer;padding:8px 12px;border-radius:10px;font-weight:600';
  const paint = () => {
    if(callback) {
      install.textContent = ru ? 'Установить' : 'Install';
      install.onclick = () => callback();
      return;
    }
    install.textContent = ru ? 'Как установить' : 'How to install';
    install.onclick = () => {
      if(mobile) {
        text.textContent = mobile.steps;
        return;
      }
      text.textContent = ru ?
        (macDesktop ?
          'В Safari на Mac: меню «Файл» → «Добавить в Dock». В Chrome и Edge нажмите значок установки в адресной строке.' :
          'В Chrome или Edge нажмите значок установки в адресной строке, затем закрепите Echogram Web на панели задач.') :
        (macDesktop ?
          'On a Mac, use Safari’s File menu → Add to Dock. In Chrome or Edge, use the install icon in the address bar.' :
          'In Chrome or Edge, use the install icon in the address bar, then pin Echogram Web to the taskbar.');
    };
  };
  paint();
  onInstallPrompt(paint);

  row.append(later, install);
  root.append(text, row);
  document.body.append(root);
}
