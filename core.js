(function initializeTreeClipCore(globalScope) {
  'use strict';

  const ELEMENT_TYPE_SEPARATOR = '::';
  const INTERNAL_CLASS_NAMES = new Set(['treeclip-selected-element']);

  function isPageClassName(className) {
    return Boolean(className) && !INTERNAL_CLASS_NAMES.has(className);
  }

  function getElementClassName(element) {
    if (!element) return '';

    if (element.classList) {
      return Array.from(element.classList).filter(isPageClassName).sort().join(' ');
    }

    const rawClassName = typeof element.className === 'string'
      ? element.className
      : element.className?.baseVal;
    return String(rawClassName || '').trim().split(/\s+/).filter(isPageClassName).sort().join(' ');
  }

  function getElementTypeKey(element) {
    if (!element?.tagName) return '';
    return `${element.tagName.toLowerCase()}${ELEMENT_TYPE_SEPARATOR}${encodeURIComponent(getElementClassName(element))}`;
  }

  function parseElementTypeKey(typeKey) {
    const separatorIndex = typeKey.indexOf(ELEMENT_TYPE_SEPARATOR);
    if (separatorIndex === -1) {
      return { tagName: '', className: '' };
    }

    return {
      tagName: typeKey.slice(0, separatorIndex),
      className: decodeURIComponent(typeKey.slice(separatorIndex + ELEMENT_TYPE_SEPARATOR.length))
    };
  }

  function matchesElementType(element, typeKey) {
    return getElementTypeKey(element) === typeKey;
  }

  function normalizeShortcutKey(key) {
    const normalized = String(key || '').toLowerCase();
    if (normalized === 'control') return 'ctrl';
    if (normalized === ' ') return 'space';
    return normalized;
  }

  function getHandleTargetDetent(currentDetent, collapsedDetent = 'actions') {
    const normalizedCollapsedDetent = collapsedDetent === 'compact' ? 'compact' : 'actions';
    return currentDetent === 'details' ? normalizedCollapsedDetent : 'details';
  }

  function getSummaryTargetDetent(currentDetent) {
    return currentDetent === 'compact' ? 'actions' : 'compact';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[character]);
  }

  function escapeCssIdentifier(value) {
    if (globalScope.CSS?.escape) {
      return globalScope.CSS.escape(String(value));
    }

    return Array.from(String(value), (character, index) => {
      const codePoint = character.codePointAt(0);
      const isSafeCharacter = /[a-zA-Z0-9_-]/.test(character);
      const needsLeadingDigitEscape = index === 0 && /[0-9]/.test(character);

      if (character === '\0') return '\uFFFD';
      if (isSafeCharacter && !needsLeadingDigitEscape) return character;
      return `\\${codePoint.toString(16)} `;
    }).join('');
  }

  function getTextFieldCandidates(element) {
    const hasText = child => Boolean(String(child?.textContent || '').replace(/\s+/g, ' ').trim());
    let candidates = Array.from(element?.children || []).filter(hasText);

    // Skip single wrapper layers until the first meaningful content branch.
    while (candidates.length === 1) {
      const nestedCandidates = Array.from(candidates[0]?.children || []).filter(hasText);
      if (nestedCandidates.length === 0) break;
      candidates = nestedCandidates;
    }

    const seenTypes = new Set();
    return candidates.filter(candidate => {
      const typeKey = getElementTypeKey(candidate);
      if (!typeKey || seenTypes.has(typeKey)) return false;
      seenTypes.add(typeKey);
      return true;
    });
  }

  function cleanText(text, options = {}) {
    let cleaned = String(text || '').replace(/\s+/g, ' ');

    if (options.removeCodePatterns) {
      cleaned = cleaned.replace(/{[^}]*}|\([^)]*\)|<[^>]*>|\[[^\]]*\]/g, ' ');
    }
    if (options.removeSymbols) {
      cleaned = cleaned.replace(/[~`!@#$%^&*()_\-+={}\[\]|\\:;'"<>,.?/]+/g, ' ');
    }
    if (options.removeEnglish) {
      cleaned = cleaned.replace(/[a-zA-Z]+/g, ' ');
    }
    if (options.removeChinese) {
      cleaned = cleaned.replace(/[\u4e00-\u9fa5]+/g, ' ');
    }
    if (options.removeNumbers) {
      cleaned = cleaned.replace(/[0-9]+/g, ' ');
    }
    if (options.removeInternalSpaces) {
      cleaned = cleaned.replace(/ /g, '');
    }

    return cleaned.replace(/\s+/g, ' ').trim();
  }

  function formatSelectedTexts(texts, options = {}) {
    let processedTexts = texts.map(text => cleanText(text, options)).filter(Boolean);

    if (options.removeDuplicates) {
      processedTexts = Array.from(new Set(processedTexts));
    }

    const separators = {
      newline: '\n',
      space: ' ',
      comma: ','
    };
    return processedTexts.join(separators[options.clipboardFormat] ?? separators.newline);
  }

  function getNearestViewportAnchor(rect, viewportWidth, viewportHeight, snapThreshold = 56) {
    const distances = {
      left: Math.max(Number(rect?.left) || 0, 0),
      right: Math.max(Number(viewportWidth) - (Number(rect?.right) || 0), 0),
      bottom: Math.max(Number(viewportHeight) - (Number(rect?.bottom) || 0), 0)
    };
    const [anchor, distance] = Object.entries(distances).sort((a, b) => a[1] - b[1])[0];
    return distance <= snapThreshold ? anchor : null;
  }

  const api = {
    cleanText,
    escapeCssIdentifier,
    escapeHtml,
    formatSelectedTexts,
    getElementClassName,
    getElementTypeKey,
    getNearestViewportAnchor,
    getHandleTargetDetent,
    getTextFieldCandidates,
    getSummaryTargetDetent,
    matchesElementType,
    normalizeShortcutKey,
    parseElementTypeKey
  };

  globalScope.TreeClipCore = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
