document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      if (element.tagName === 'TITLE') {
        document.title = message;
      } else {
        element.textContent = message;
      }
    }
  });
});
