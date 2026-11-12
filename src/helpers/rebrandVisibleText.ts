/**
 * User-visible product name. URLs, domains and @handles that contain "telegram"
 * stay as they are, so links and API hosts keep working.
 */
const PROTECTED = /(?:[a-z][a-z0-9+.-]*:\/\/[^\s)\]'"<>]*)|(?:(?:[\w-]+\.)*(?:telegram\.(?:org|me|dog)|t\.me)(?:\/[^\s)\]'"<>]*)?)|(?:@[A-Za-z0-9_]*[Tt]elegram[A-Za-z0-9_]*)|(?<![A-Za-z0-9_])Telegram Premium(?![A-Za-z0-9_])/gi;

const KEEP_BOTH_APPS = new Set([
  'You can scan this QR code in Echogram or in Telegram.',
  'Open Echogram or Telegram on your phone',
  'The code arrived in Echogram or in Telegram. Open either app to see it.',
  'Сканировать QR-код можно не только в Echogram, но и в Telegram.',
  'Откройте Echogram или Telegram на телефоне',
  'Код пришёл в Echogram или в Telegram — посмотрите его в любом из этих приложений.'
]);

export function rebrandVisibleText(input: string): string {
  if(!input || !/telegram/i.test(input) || KEEP_BOTH_APPS.has(input)) return input;

  const saved: string[] = [];
  const masked = input.replace(PROTECTED, (part) => {
    const token = `\uE000${saved.length}\uE001`;
    saved.push(part);
    return token;
  });

  const branded = masked
    .replace(/(?<![A-Za-z0-9_])TELEGRAM(?![A-Za-z0-9_])/g, 'ECHOGRAM')
    .replace(/(?<![A-Za-z0-9_])Telegram(?![A-Za-z0-9_])/g, 'Echogram')
    .replace(/(?<![A-Za-z0-9_])telegram(?![A-Za-z0-9_])/g, 'echogram');

  return branded.replace(/\uE000(\d+)\uE001/g, (_, index: string) => saved[+index]);
}
