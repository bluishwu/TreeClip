const DEFAULT_ICONS = {
  16: 'icons/icon16.png',
  32: 'icons/icon32.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png'
};

const ACTIVE_ICONS = {
  16: 'icons/icon16-active.png',
  32: 'icons/icon32-active.png',
  48: 'icons/icon48-active.png',
  128: 'icons/icon128-active.png'
};

const SUPPORTED_LOCALES = new Set(['zh_CN', 'en']);
const localeMessagesCache = new Map();

async function loadLocaleMessages(locale) {
  if (!SUPPORTED_LOCALES.has(locale)) return null;
  if (localeMessagesCache.has(locale)) return localeMessagesCache.get(locale);

  const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
  if (!response.ok) return null;
  const messages = await response.json();
  localeMessagesCache.set(locale, messages);
  return messages;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'treeclip-get-locale-messages') {
    void loadLocaleMessages(message.locale)
      .then(messages => sendResponse({ ok: Boolean(messages), messages }))
      .catch(() => sendResponse({ ok: false, messages: null }));
    return true;
  }

  if (message?.type !== 'treeclip-selection-key-state' || !sender.tab?.id) return false;

  const pendingUpdate = chrome.action.setIcon({
    tabId: sender.tab.id,
    path: message.active ? ACTIVE_ICONS : DEFAULT_ICONS
  });
  pendingUpdate?.catch?.(() => {
    // 标签页可能在异步图标更新完成前关闭。
  });
  return false;
});
