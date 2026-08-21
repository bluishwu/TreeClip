const POPUP_LOCALE_STORAGE_KEY = 'treeclip-popup-locale';
const SUPPORTED_POPUP_LOCALES = new Set(['zh_CN', 'en']);
const popupLocaleMessages = new Map();
let activePopupMessages = null;
let activePopupLocale = null;
let popupLocaleRequestSequence = 0;
let popupLocaleWasManuallySelected = false;

function getMessage(key) {
  const localizedMessage = activePopupMessages?.[key]?.message;
  if (localizedMessage) return localizedMessage;
  if (typeof chrome === 'undefined' || !chrome.i18n) return '';
  return chrome.i18n.getMessage(key) || '';
}

function localizePopup() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const message = getMessage(element.dataset.i18n);
    if (!message) return;
    if (element.tagName === 'TITLE') document.title = message;
    else element.textContent = message;
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    const message = getMessage(element.dataset.i18nAriaLabel);
    if (message) element.setAttribute('aria-label', message);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const message = getMessage(element.dataset.i18nTitle);
    if (message) element.title = message;
  });
}

function updateDocumentationLinks(locale) {
  const docsPath = locale === 'en' ? '/en/docs' : '/docs';
  document.querySelectorAll('[data-doc-anchor]').forEach(link => {
    link.href = `https://treeclip.dev${docsPath}${link.dataset.docAnchor || ''}`;
  });
}

function showPanelError() {
  document.getElementById('panel-status')?.classList.add('visible');
}

function openExternalPanel(panel) {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    showPanelError();
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const activeTab = tabs[0];
    if (!activeTab?.id || chrome.runtime.lastError) {
      showPanelError();
      return;
    }

    chrome.tabs.sendMessage(activeTab.id, {
      type: 'treeclip-open-external-panel',
      panel,
      locale: activePopupLocale || getBrowserPopupLocale()
    }, response => {
      if (chrome.runtime.lastError || !response?.ok) {
        showPanelError();
        return;
      }
      document.getElementById('panel-status')?.classList.remove('visible');
    });
  });
}

function syncLocaleToActiveTab(locale) {
  if (typeof chrome === 'undefined' || !chrome.tabs || !SUPPORTED_POPUP_LOCALES.has(locale)) return;

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const activeTab = tabs[0];
    if (!activeTab?.id || chrome.runtime.lastError) return;
    chrome.tabs.sendMessage(activeTab.id, { type: 'treeclip-set-locale', locale }, () => {
      void chrome.runtime.lastError;
    });
  });
}

function getBrowserPopupLocale() {
  const uiLanguage = typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage
    ? chrome.i18n.getUILanguage()
    : document.documentElement.lang;
  return /^zh(?:-|_|$)/i.test(uiLanguage || '') ? 'zh_CN' : 'en';
}

async function loadPopupLocale(locale) {
  if (!SUPPORTED_POPUP_LOCALES.has(locale)) return null;
  if (popupLocaleMessages.has(locale)) return popupLocaleMessages.get(locale);

  try {
    const relativePath = `_locales/${locale}/messages.json`;
    const localeUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL(relativePath)
      : relativePath;
    const response = await fetch(localeUrl);
    if (!response.ok) return null;
    const messages = await response.json();
    popupLocaleMessages.set(locale, messages);
    return messages;
  } catch {
    return null;
  }
}

function getStoredPopupLocale() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(null);
  return new Promise(resolve => {
    chrome.storage.local.get([POPUP_LOCALE_STORAGE_KEY], items => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const storedLocale = items?.[POPUP_LOCALE_STORAGE_KEY];
      resolve(SUPPORTED_POPUP_LOCALES.has(storedLocale) ? storedLocale : null);
    });
  });
}

function storePopupLocale(locale) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  chrome.storage.local.set({ [POPUP_LOCALE_STORAGE_KEY]: locale }, () => {
    void chrome.runtime.lastError;
  });
}

async function setPopupLocale(locale, persist = false) {
  const requestSequence = ++popupLocaleRequestSequence;
  const messages = await loadPopupLocale(locale);
  if (!messages || requestSequence !== popupLocaleRequestSequence) return false;

  activePopupMessages = messages;
  activePopupLocale = locale;
  document.documentElement.lang = locale === 'zh_CN' ? 'zh-CN' : 'en';
  updateDocumentationLinks(locale);
  const languageToggle = document.querySelector('[data-popup-locale-toggle]');
  if (languageToggle) {
    const targetLocale = locale === 'zh_CN' ? 'en' : 'zh_CN';
    languageToggle.dataset.targetLocale = targetLocale;
    languageToggle.textContent = targetLocale === 'en' ? 'EN' : '中';
    languageToggle.setAttribute('aria-label', targetLocale === 'en' ? 'Switch to English' : '切换至中文');
  }
  localizePopup();
  if (persist) storePopupLocale(locale);
  syncLocaleToActiveTab(locale);
  return true;
}

document.addEventListener('DOMContentLoaded', async () => {
  localizePopup();
  document.querySelectorAll('[data-panel]').forEach(button => {
    button.addEventListener('click', () => openExternalPanel(button.dataset.panel));
  });
  document.querySelector('[data-popup-locale-toggle]')?.addEventListener('click', event => {
    popupLocaleWasManuallySelected = true;
    const currentLocale = activePopupLocale || getBrowserPopupLocale();
    const targetLocale = event.currentTarget.dataset.targetLocale
      || (currentLocale === 'zh_CN' ? 'en' : 'zh_CN');
    void setPopupLocale(targetLocale, true);
  });

  const storedLocale = await getStoredPopupLocale();
  if (!popupLocaleWasManuallySelected) {
    await setPopupLocale(storedLocale || getBrowserPopupLocale());
  }
});
