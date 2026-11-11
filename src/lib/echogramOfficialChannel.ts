import type {AppMessagesManager} from '@appManagers/appMessagesManager';
import {FOLDER_ID_ALL} from '@appManagers/constants';
import type {Chat} from '@layer';
import {
  ECHOGRAM_OFFICIAL_USERNAME,
  isEchogramOfficialPeerId,
  placeEchogramOfficialFirst
} from '@lib/echogramOfficial';

let pending = false;
let attempts = 0;

/**
 * Join https://t.me/echogram_official if needed and keep that dialog pinned
 * above every other chat in the main list.
 */
export async function ensureEchogramOfficialChannel(app: AppMessagesManager) {
  if(pending) return;
  pending = true;
  try {
    const resolved = await Promise.resolve(app.appUsersManager.resolveUsername(ECHOGRAM_OFFICIAL_USERNAME));
    if(!resolved || resolved._ !== 'channel') return;

    const chat = resolved as Chat.channel;
    if(!app.appChatsManager.isInChat(chat.id)) {
      const joined = await app.appChatsManager.joinChannel(chat.id);
      if(joined && (joined as {_: string})._ === 'chatInviteJoinWebView') return;
    }

    const peerId = chat.id.toPeerId(true);
    let dialog = app.dialogsStorage.getDialogOnly(peerId);
    if(dialog && !dialog.pFlags.pinned) {
      try {
        await app.setDialogPin({peerId, pinned: true, folderId: FOLDER_ID_ALL});
      } catch{
        dialog.pFlags.pinned = true;
        app.dialogsStorage.togglePinInOrder(FOLDER_ID_ALL, peerId, true);
        app.dialogsStorage.generateIndexForDialog(dialog);
        app.scheduleHandleNewDialogs(peerId, dialog);
      }
      dialog = app.dialogsStorage.getDialogOnly(peerId);
    }

    const order = app.dialogsStorage.getPinnedOrders(FOLDER_ID_ALL);
    if(!order || !dialog?.pFlags.pinned) {
      if(attempts < 5) {
        attempts++;
        setTimeout(() => ensureEchogramOfficialChannel(app), 1500);
      }
      return;
    }
    attempts = 0;
    if(!order.includes(peerId)) order.unshift(peerId);
    if(!isEchogramOfficialPeerId(order[0]) || order[0] !== peerId) {
      placeEchogramOfficialFirst(order);
      const next = order.slice();
      const index = next.indexOf(peerId);
      if(index > 0) {
        next.splice(index, 1);
        next.unshift(peerId);
      }
      await app.reorderPinnedDialogs({filterId: FOLDER_ID_ALL, order: next});
    }
  } catch{
    // Signed out, or the network is not up yet. The next sync tries again.
  } finally {
    pending = false;
  }
}
