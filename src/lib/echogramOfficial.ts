/** @echogram_official — https://t.me/echogram_official */
export const ECHOGRAM_OFFICIAL_LINK = 'https://t.me/echogram_official';
export const ECHOGRAM_OFFICIAL_USERNAME = 'echogram_official';
export const ECHOGRAM_OFFICIAL_CHANNEL_ID = 3540373666;

/** tweb / Android dialog id: -channelId */
export const ECHOGRAM_OFFICIAL_PEER_ID = -ECHOGRAM_OFFICIAL_CHANNEL_ID as PeerId;
/** Bot API style channel id, kept so a dialog stored that way is still recognized */
export const ECHOGRAM_OFFICIAL_BOTAPI_PEER_ID = -1003540373666 as PeerId;

export function isEchogramOfficialPeerId(peerId: PeerId) {
  return peerId === ECHOGRAM_OFFICIAL_PEER_ID || peerId === ECHOGRAM_OFFICIAL_BOTAPI_PEER_ID;
}

/** Top of the main chat list. No-op when this channel is absent or already first. */
export function placeEchogramOfficialFirst(order: PeerId[]) {
  const index = order.findIndex((peerId) => isEchogramOfficialPeerId(peerId));
  if(index <= 0) return order;

  const [peerId] = order.splice(index, 1);
  order.unshift(peerId);
  return order;
}
