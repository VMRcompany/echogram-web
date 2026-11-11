/**
 * User-visible product name. URLs, domains and @handles that contain "telegram"
 * stay as they are, so links and API hosts keep working.
 */
const PROTECTED = /(?:[a-z][a-z0-9+.-]*:\/\/[^\s)\]'"<>]*)|(?:(?:[\w-]+\.)*(?:telegram\.(?:org|me|dog)|t\.me)(?:\/[^\s)\]'"<>]*)?)|(?:@[A-Za-z0-9_]*[Tt]elegram[A-Za-z0-9_]*)|(?<![A-Za-z0-9_])Telegram Premium(?![A-Za-z0-9_])/gi;

export function rebrandVisibleText(input: string): string {
  if(!input || !/telegram/i.test(input)) return input;

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
