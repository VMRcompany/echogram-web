import type {Message, MessageEntity} from '@layer';

/**
 * Custom emoji in text without Telegram Premium. The API rejects
 * messageEntityCustomEmoji for free accounts, so the visible fallback stays in
 * the text and a zero-width payload carries the document ids. Echogram restores
 * those ids as in-text stickers. Same layout as the Android client.
 */
const START = '\u2060';
const END = '\u2061';
const BIT0 = '\u200B';
const BIT1 = '\u200C';
const SEP = '\u2063';

type EmojiEntity = MessageEntity.messageEntityCustomEmoji;
type RecordParts = [number, number, number, number];

function isCustomEmoji(entity: MessageEntity): entity is EmojiEntity {
  return entity._ === 'messageEntityCustomEmoji';
}

function sameDocument(a: string | number, b: string | number) {
  try {
    return BigInt(a) === BigInt(b);
  } catch{
    return String(a) === String(b);
  }
}

function appendBits(builder: string[], value: number, bits: number) {
  for(let bit = bits - 1; bit >= 0; bit--) {
    builder.push(((value >>> bit) & 1) === 1 ? BIT1 : BIT0);
  }
}

function readBits(body: string, index: number, bits: number) {
  let value = 0;
  for(let i = 0; i < bits; i++) {
    value = (value << 1) | (body.charAt(index + i) === BIT1 ? 1 : 0);
  }
  return value >>> 0;
}

function encode(records: RecordParts[]) {
  const builder = [START];
  records.forEach((record, index) => {
    if(index) builder.push(SEP);
    appendBits(builder, record[0] & 0xFFFF, 16);
    appendBits(builder, record[1] & 0xFF, 8);
    appendBits(builder, record[2] >>> 0, 32);
    appendBits(builder, record[3] >>> 0, 32);
  });
  builder.push(END);
  return builder.join('');
}

function decode(text: string): RecordParts[] | undefined {
  const start = text.lastIndexOf(START);
  const end = text.lastIndexOf(END);
  if(start < 0 || end <= start) return;
  const body = text.slice(start + 1, end);
  if(!body) return;

  const records: RecordParts[] = [];
  let index = 0;
  while(index < body.length) {
    if(body.charAt(index) === SEP) {
      index++;
      continue;
    }
    if(index + 88 > body.length) break;
    const offset = readBits(body, index, 16);
    index += 16;
    const length = readBits(body, index, 8);
    index += 8;
    const hi = readBits(body, index, 32);
    index += 32;
    const lo = readBits(body, index, 32);
    index += 32;
    records.push([offset, length, hi, lo]);
  }
  return records;
}

function stripPayload(text: string) {
  const start = text.lastIndexOf(START);
  const end = text.lastIndexOf(END);
  if(start >= 0 && end > start && end === text.length - 1) return text.slice(0, start);
  return text;
}

function hasCustomEmoji(entities: MessageEntity[], offset: number, documentId: bigint) {
  return entities.some((entity) => {
    return isCustomEmoji(entity) && entity.offset === offset && sameDocument(entity.document_id, documentId.toString());
  });
}

export function prepareOutgoingCustomEmoji(text: string, entities?: MessageEntity[]) {
  if(!text || !entities?.some(isCustomEmoji)) {
    return {text, entities};
  }

  const records: RecordParts[] = [];
  for(const entity of entities) {
    if(!isCustomEmoji(entity) || entity.length <= 0 || entity.offset < 0) continue;
    const id = BigInt(entity.document_id);
    records.push([
      entity.offset,
      entity.length,
      Number((id >> 32n) & 0xffffffffn),
      Number(id & 0xffffffffn)
    ]);
  }
  if(!records.length) return {text, entities};

  return {
    text: stripPayload(text) + encode(records),
    entities: entities.filter((entity) => !isCustomEmoji(entity))
  };
}

export function restoreEchogramCustomEmoji(message: Pick<Message.message, 'message' | 'entities'> | undefined) {
  if(!message?.message) return message;
  const records = decode(message.message);
  if(!records?.length) return message;

  const entities = message.entities ??= [];
  for(const [offset, length, hi, lo] of records) {
    const documentId = (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
    if(offset < 0 || length <= 0 || offset + length > message.message.length) continue;
    if(hasCustomEmoji(entities, offset, documentId)) continue;
    entities.push({
      _: 'messageEntityCustomEmoji',
      offset,
      length,
      document_id: documentId.toString()
    });
  }
  return message;
}
