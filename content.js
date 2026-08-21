/**
 * TreeClip 网页文本选择器 - 选取文本块并批量复制文本
 * 说明：实现层仍以 DOM 元素作为文本边界和结构匹配依据；用户选择与输出的目标是文本。
 * 整体架构:
 * 1. 全局变量定义 - 存储工具运行状态、用户偏好和选中元素
 * 2. 事件监听器 - 处理键盘与鼠标交互，检测Shift+点击等组合操作
 * 3. 元素选择功能 - 包括单击选择、框选、层级导航和类型匹配等多种选择方式
 * 4. UI管理系统 - 动态创建与更新通知、提示和操作界面
 * 5. 数据处理功能 - 处理选中元素文本、生成选择器和更新剪贴板
 * 6. 用户偏好管理 - 保存和加载用户设置
 */

// =============================================
// 辅助函数 - 国际化翻译
// =============================================
const TREECLIP_LOCALE_STORAGE_KEY = 'treeclip-popup-locale';
const SUPPORTED_TREECLIP_LOCALES = new Set(['zh_CN', 'en']);
const treeClipLocaleCache = new Map();
let activeTreeClipLocale = null;
let activeTreeClipMessages = null;

function getManualLocaleMessage(key, substitutions) {
  const entry = activeTreeClipMessages?.[key];
  if (!entry?.message) return '';

  let message = entry.message;
  Object.entries(entry.placeholders || {}).forEach(([name, placeholder]) => {
    const position = Number(String(placeholder.content || '').match(/\$(\d+)/)?.[1]);
    const replacement = Number.isInteger(position) ? (substitutions[position - 1] || '') : '';
    message = message.replace(new RegExp(`\\$${name}\\$`, 'gi'), replacement);
  });
  return message.replace(/\$\$/g, '$');
}

const t = (key, ...args) => {
  // 如果第一个参数是数组，则直接使用它作为占位符替换数组
  // 否则使用 args 数组本身
  const substitutions = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
  // chrome.i18n.getMessage 的第二个参数要求是字符串或字符串数组
  // 确保所有参数都转换为字符串
  const stringSubstitutions = Array.isArray(substitutions)
    ? substitutions.map(String)
    : [String(substitutions)];
  const manualMessage = getManualLocaleMessage(key, stringSubstitutions);
  if (manualMessage) return manualMessage;
  return chrome.i18n.getMessage(key, stringSubstitutions) || key;
};

async function setTreeClipLocale(locale) {
  if (!SUPPORTED_TREECLIP_LOCALES.has(locale)) return false;
  if (activeTreeClipLocale === locale && activeTreeClipMessages) return true;

  try {
    let messages = treeClipLocaleCache.get(locale);
    if (!messages) {
      messages = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'treeclip-get-locale-messages', locale }, response => {
          if (chrome.runtime.lastError || !response?.ok) {
            resolve(null);
            return;
          }
          resolve(response.messages);
        });
      });
      if (!messages) return false;
      treeClipLocaleCache.set(locale, messages);
    }
    activeTreeClipLocale = locale;
    activeTreeClipMessages = messages;
    return true;
  } catch {
    return false;
  }
}

const {
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
} = globalThis.TreeClipCore;

// =============================================
// 全局状态管理 - 追踪用户交互和选中元素的状态变量
// =============================================
// 是否正在按住Shift键
let isShiftPressed = false;
// 存储被选中的元素
let selectedElements = [];
// 存储当前使用的选择器
let currentSelector = '';
// 储存第一个点击元素的父元素链
let parentChain = [];
// 当前在父元素链中的索引
let parentChainIndex = 0;
// 存储不同元素类型的匹配层级索引
let matchedLevelIndices = {};
// 存储当前元素的子元素链
let childrenChain = [];
// 是否正在查看子元素
let isViewingChildren = false;
// 跟踪连续点击相同类型的元素
let consecutiveSameTypeElements = [];
// 当前选中的元素类型
let currentElementTypeKey = '';
// 框选相关变量
let isSelecting = false;
let selectBox = null;
let startX = 0;
let startY = 0;
let selectAudioContext = null;
// 剪贴板格式设置
let clipboardFormat = 'newline'; // 可选值: newline, space, comma
// 新的细粒度清理选项状态变量
let removeInternalSpaces = false;      // 移除文本内部多余空格 (默认不勾选)
let removeCodePatterns = false; // 移除常见代码模式 {...}, (...), <...> (默认不勾选)
let removeSymbols = false;      // 移除常见符号 +-*/=等
let removeEnglish = false;      // 移除英文字母
let removeChinese = false;      // 移除中文字符
let removeNumbers = false;      // 移除数字
let removeDuplicates = false;     // 移除重复项
// 新增：是否启用实时复制
let isRealtimeCopyEnabled = false; // 默认关闭

// 自定义快捷键配置
let selectKeyConfig = { keys: ['Shift'] }; // 默认选择键为Shift
let typeSelectKeyConfig = { keys: ['f'] }; // 默认选择相同类型的键为F
let copyKeyConfig = { keys: ['Control', 'c'] }; // 默认复制组合键为Ctrl+C
let isShowingKeyConfig = false; // 是否正在显示快捷键配置面板
let isCapturingKeys = false; // 是否正在捕获按键
let currentCaptureTarget = ''; // 当前正在捕获按键的目标
let lastCaptureTarget = ''; // 最后一次捕获按键的目标，用于显示保存效果
let keyConfigOutsideMouseDownHandler = null;
let isCopyKeyPressed = false; // 跟踪复制键是否处于按下状态
let selectKeyCombinationActive = false; // 跟踪选择键组合是否已经激活

// 两层界面状态：底部操作条始终显示，详情面板按需展开
let isDetailsPanelOpen = false;
let isActionBarCompact = false;
let preferredCollapsedDetent = 'actions';
let copyFeedbackTimeoutId = null;
let isDetailsTransitioning = false;
let pendingShellMorphRect = null;
let floatingBoxCenter = null;
let floatingBoxAnchor = 'bottom';
let floatingBoxSideTop = null;
let floatingBoxFreeBottom = null;
const detentSizeCache = {};
// 是否隐藏相同元素类型检测提示
let hideTypePrompt = false;
let typePromptTimeoutId = null;
// 元素层级是否展开显示
let isHierarchyExpanded = false;
let isHierarchySectionOpen = false;
// 输出格式区块是否展开
let isOutputFormatExpanded = false;
// =============================================
// 选择高亮管理 - 仅维护 TreeClip 自己的标记
// =============================================
const SELECTED_ELEMENT_ATTRIBUTE = 'data-treeclip-selected';
const FLOATING_BOX_EDGE_GAP = 8;
const FLOATING_BOX_SCROLLBAR_SAFE_GAP = 12;
const SELECTION_UI_DETENT_STORAGE_KEY = 'batch-selector-ui-detent';
const SELECTION_UI_COLLAPSED_DETENT_STORAGE_KEY = 'batch-selector-ui-collapsed-detent';
const FLOATING_BOX_POSITION_STORAGE_KEY = 'batch-selector-floating-box-position';
const HIERARCHY_SECTION_OPEN_STORAGE_KEY = 'batch-selector-hierarchy-section-open';
const OUTPUT_SECTION_OPEN_STORAGE_KEY = 'batch-selector-output-section-open';

function setSelectionKeyActive(active) {
  isShiftPressed = active;
  selectKeyCombinationActive = active;
  document.body?.classList.toggle('treeclip-selection-key-active', active);
  try {
    const pendingMessage = chrome.runtime.sendMessage({ type: 'treeclip-selection-key-state', active });
    pendingMessage?.catch?.(() => {});
  } catch (e) {
    /* 扩展重载或页面卸载时无需继续同步工具栏图标。 */
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['treeclip-open-external-panel', 'treeclip-set-locale'].includes(message?.type)) return false;

  void (async () => {
    try {
      if (message.locale) {
        const localeApplied = await setTreeClipLocale(message.locale);
        if (!localeApplied) throw new Error('Unable to load TreeClip locale');
      }
      refreshLocalizedTreeClipUI();

      if (message.type === 'treeclip-open-external-panel') {
        if (message.panel === 'shortcuts') showKeyConfigPanel();
        else throw new Error('Unknown TreeClip external panel');
      }
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false });
    }
  })();
  return true;
});

function refreshLocalizedTreeClipUI() {
  const selectionPanel = document.getElementById('batch-selector-notification');
  if (selectionPanel && selectedElements.length > 0) updateNotification(selectedElements.length);

  const typePrompt = document.getElementById('batch-selector-prompt');
  if (typePrompt) {
    const title = typePrompt.querySelector('[data-treeclip-type-prompt-title]');
    const description = typePrompt.querySelector('[data-treeclip-type-prompt-description]');
    const choice = typePrompt.querySelector('[data-treeclip-type-prompt-choice]');
    const confirmButton = typePrompt.querySelector('#select-all-of-type-confirm');
    const cancelButton = typePrompt.querySelector('#select-all-of-type-cancel');
    if (title) title.textContent = t('prompt_batch_select');
    if (description) {
      description.textContent = t('prompt_batch_select_desc', typePrompt.dataset.treeclipElementDesc || '');
    }
    if (choice) choice.textContent = t('checkbox_dont_show');
    if (confirmButton) {
      confirmButton.textContent = `${t('btn_select_all')} (${typeSelectKeyConfig.keys.map(formatKeyForDisplay).join('+')})`;
    }
    if (cancelButton) cancelButton.textContent = t('btn_cancel');
  }

  if (isShowingKeyConfig) {
    hideKeyConfigPanel();
    showKeyConfigPanel();
  }
}

function persistSelectionUIState() {
  try {
    chrome.storage.local.set({
      [SELECTION_UI_DETENT_STORAGE_KEY]: getSelectionUIDetent(),
      [SELECTION_UI_COLLAPSED_DETENT_STORAGE_KEY]: preferredCollapsedDetent
    });
  } catch (e) {
    /* 页面关闭时可能无法写入扩展存储；当前会话状态仍然有效。 */
  }
}

function persistFloatingBoxPosition() {
  if (!floatingBoxCenter) return;
  const viewportWidth = Math.max(window.innerWidth, 1);
  const viewportHeight = Math.max(window.innerHeight, 1);
  const position = {
    anchor: floatingBoxAnchor,
    centerXRatio: floatingBoxCenter.x / viewportWidth,
    centerYRatio: floatingBoxCenter.y / viewportHeight,
    sideTopRatio: floatingBoxSideTop === null ? null : floatingBoxSideTop / viewportHeight,
    freeBottomRatio: floatingBoxFreeBottom === null ? null : floatingBoxFreeBottom / viewportHeight
  };
  try {
    chrome.storage.local.set({ [FLOATING_BOX_POSITION_STORAGE_KEY]: position });
  } catch (e) {
    /* 页面关闭时可能无法写入扩展存储；当前会话状态仍然有效。 */
  }
}

function restoreFloatingBoxPosition(rawPosition) {
  let position = rawPosition;
  if (typeof position === 'string') {
    try { position = JSON.parse(position); } catch (e) { return; }
  }
  if (!position || typeof position !== 'object') return;

  const anchors = new Set(['left', 'right', 'bottom', 'free']);
  const clampRatio = value => Math.min(Math.max(Number(value), 0), 1);
  const centerXRatio = Number(position.centerXRatio);
  const centerYRatio = Number(position.centerYRatio);
  if (!anchors.has(position.anchor) || !Number.isFinite(centerXRatio) || !Number.isFinite(centerYRatio)) return;

  floatingBoxAnchor = position.anchor;
  floatingBoxCenter = {
    x: clampRatio(centerXRatio) * window.innerWidth,
    y: clampRatio(centerYRatio) * window.innerHeight
  };
  const sideTopRatio = position.sideTopRatio === null ? NaN : Number(position.sideTopRatio);
  const freeBottomRatio = position.freeBottomRatio === null ? NaN : Number(position.freeBottomRatio);
  floatingBoxSideTop = Number.isFinite(sideTopRatio) ? clampRatio(sideTopRatio) * window.innerHeight : null;
  floatingBoxFreeBottom = Number.isFinite(freeBottomRatio) ? clampRatio(freeBottomRatio) * window.innerHeight : null;
}

function getElementsByTypeKey(typeKey, root = document) {
  const { tagName } = parseElementTypeKey(typeKey);
  if (!tagName) return [];
  return Array.from(root.querySelectorAll(tagName)).filter(element => matchesElementType(element, typeKey));
}

function markElementSelected(element) {
  if (element?.setAttribute) {
    element.setAttribute(SELECTED_ELEMENT_ATTRIBUTE, '');
  }
}

function unmarkElementSelected(element) {
  if (element?.removeAttribute) {
    element.removeAttribute(SELECTED_ELEMENT_ATTRIBUTE);
  }
}

function clearSelectionHighlights() {
  document.querySelectorAll(`[${SELECTED_ELEMENT_ATTRIBUTE}]`).forEach(unmarkElementSelected);
}

// =============================================
// 辅助函数 - 处理UI元素深度和缩进的计算
// =============================================
// 计算层级元素的深度和缩进
function getAdjustedLevelIndent(j, i, needCollapse, parentChain) {
  let level;

  if (needCollapse) {
    // 在省略视图中，根据元素在视图中的位置计算缩进
    if (j < 2) {
      // 顶部元素（显示的前2个）使用实际深度
      level = parentChain.length - 1 - i;
    } else {
      // 底部元素（省略号后面的元素）连续显示
      // 从省略号后面开始的层级
      level = 2 + (j - 3); // 第一个底部元素层级为2
    }
  } else {
    // 完全展开时，使用实际的DOM树深度
    level = parentChain.length - 1 - i;
  }

  const indent = level * 12; // 缩进量

  return { level, indent };
}

// =============================================
// 事件监听系统 - 处理键盘和鼠标事件的核心功能
// 管理Shift键状态，并处理快捷键操作
// =============================================
// 检查是否按下了指定的组合键
function isKeyCombinationPressed(event, keyConfig) {
  // 某些网站会派发没有 key 字段的合成 keydown；这类事件不应进入快捷键判断。
  if (!event || typeof event.key !== 'string' || event.key.length === 0) {
    return false;
  }

  // 忽略缺失、损坏或不是数组的快捷键配置。
  if (!keyConfig || !Array.isArray(keyConfig.keys) || keyConfig.keys.length === 0) {
    return false;
  }

  // 如果是选择键配置，且选择键组合已激活，直接返回true
  if (keyConfig === selectKeyConfig && selectKeyCombinationActive) {
    return true;
  }

  // 检查所有键是否都被按下
  // 对于修饰键，我们需要特殊处理
  for (const key of keyConfig.keys) {
    if (typeof key !== 'string' || key.length === 0) return false;
    const lowerKey = key.toLowerCase();

    // 检查修饰键
    if (lowerKey === 'control' || lowerKey === 'ctrl') {
      if (!event.ctrlKey && !event.metaKey) return false;
    }
    else if (lowerKey === 'alt') {
      if (!event.altKey) return false;
    }
    else if (lowerKey === 'shift') {
      if (!event.shiftKey) return false;
    }
    else if (lowerKey === 'meta') {
      if (!event.metaKey) return false;
    }
    // 检查普通键
    else if (event.key.toLowerCase() !== lowerKey) {
      // 特殊情况：空格键
      if (lowerKey === 'space' && event.key === ' ') {
        // 空格键匹配成功，继续检查
        continue;
      }
      return false;
    }
  }

  return true;
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, [role="textbox"]') ||
    target.isContentEditable
  );
}

// 监听键盘按下事件
document.addEventListener('keydown', function(event) {
  // 如果正在配置快捷键，不处理其他键盘事件
  if (isShowingKeyConfig) {
    // 如果正在捕获按键，处理按键捕获逻辑
    if (isCapturingKeys) {
      handleKeyCaptureInput(event);
      return;
    }
    return;
  }

  const isEditing = isEditableTarget(event.target);

  // 按下选择键
  const isSelectKeyPressed = !isEditing && isKeyCombinationPressed(event, selectKeyConfig);

  // 只有在之前未按下的情况下才设置状态
  if (isSelectKeyPressed && !isShiftPressed) {
    setSelectionKeyActive(true);

    // 记录当前按下的选择键组合
    //console.log('选择键组合已激活:', selectKeyConfig.keys.join('+'));
  }
  // 处理复制组合键 - 复制已选中的内容
  const isCopyKeyCombinationPressed = isKeyCombinationPressed(event, copyKeyConfig);

  // 如果复制键被按下，且之前不是按下状态，且有选中元素
  if (!isEditing && isCopyKeyCombinationPressed && !isCopyKeyPressed && selectedElements.length > 0) {
    event.preventDefault();
    copySelectionToClipboard();
  }

  // 更新复制键状态
  isCopyKeyPressed = isCopyKeyCombinationPressed;

  // 按下ESC键取消选择
  if (event.key === 'Escape') {
    // 如果正在框选，取消框选
    if (isSelecting) {
      cancelBoxSelection();
    } else {
      cancelSelection();
    }
  }

  // 快捷键: 选择相同类型的元素
  if (isKeyCombinationPressed(event, typeSelectKeyConfig) &&
      !isEditing &&
      (selectedElements.length > 0) &&
      (!isViewingChildren)) { // 在查看子元素时不触发
    event.preventDefault();
    selectAllElements();
  }

  // 快捷键: Shift+向上键 - 扩大选择范围（固定使用Shift键）
  if (!isEditing && event.shiftKey && event.key === 'ArrowUp' && selectedElements.length > 0) {
    event.preventDefault();
    moveUp();
  }

  // 快捷键: Shift+向下键 - 缩小选择范围（固定使用Shift键）
  if (!isEditing && event.shiftKey && event.key === 'ArrowDown' && selectedElements.length > 0) {
    event.preventDefault();
    moveDown();
  }

  // 快捷键: Shift+向右键 - 查看元素内部内容（固定使用Shift键）
  if (!isEditing && event.shiftKey && event.key === 'ArrowRight' && selectedElements.length > 0) {
    event.preventDefault();
    viewInside();
  }

  // 快捷键: Shift+向左键 - 返回父元素视图（固定使用Shift键）
  if (!isEditing && event.shiftKey && event.key === 'ArrowLeft' && isViewingChildren) {
    event.preventDefault();
    returnToParentView();
  }
});

// 监听键盘释放事件
document.addEventListener('keyup', function(event) {
  // 如果正在配置快捷键，不处理其他键盘事件
  if (isShowingKeyConfig) {
    return;
  }

  const releasedKey = normalizeShortcutKey(event.key);

  // 检查是否释放了选择键中的任何一个键
  if (selectKeyConfig && selectKeyConfig.keys) {
    const keyInConfig = selectKeyConfig.keys.some(key => normalizeShortcutKey(key) === releasedKey);
    if (keyInConfig) {
      setSelectionKeyActive(false);

      consecutiveSameTypeElements = [];

      // 如果正在框选，取消框选
      if (isSelecting) {
        cancelBoxSelection();
      }

      //console.log('选择键组合已释放');
    }
  }

  // 检查是否释放了复制键中的任何一个键
  if (copyKeyConfig && copyKeyConfig.keys) {
    const keyInConfig = copyKeyConfig.keys.some(key => normalizeShortcutKey(key) === releasedKey);
    if (keyInConfig) {
      // 重置复制键状态
      isCopyKeyPressed = false;
    }
  }
});

function resetSelectionKeyOnPageExit() {
  if (isShiftPressed || selectKeyCombinationActive) setSelectionKeyActive(false);
  if (isSelecting) cancelBoxSelection();
}

window.addEventListener('blur', resetSelectionKeyOnPageExit);
window.addEventListener('pagehide', resetSelectionKeyOnPageExit);

// 添加CSS样式
const style = document.createElement('style');
style.textContent = `
  .treeclip-selection-key-active,
  .treeclip-selection-key-active * {
    cursor: crosshair !important;
  }
  .treeclip-selection-key-active .batch-selector-ui,
  .treeclip-selection-key-active .batch-selector-ui * {
    cursor: default !important;
  }
  .treeclip-selection-key-active .batch-selector-ui button,
  .treeclip-selection-key-active .batch-selector-ui button *,
  .treeclip-selection-key-active .batch-selector-ui [role="button"],
  .treeclip-selection-key-active .batch-selector-ui [role="button"] * {
    cursor: pointer !important;
  }
  .treeclip-selection-key-active .batch-selector-ui button:disabled,
  .treeclip-selection-key-active .batch-selector-ui button:disabled * {
    cursor: not-allowed !important;
  }
  [${SELECTED_ELEMENT_ATTRIBUTE}] {
    outline: 2px solid #1677ff !important;
    outline-offset: 1px !important;
  }
  .batch-selector-ui {
    pointer-events: auto !important;
    user-select: none !important;
    -webkit-user-select: none !important;
    -moz-user-select: none !important;
    -ms-user-select: none !important;
  }
  .batch-selector-ui * {
    pointer-events: auto !important;
    user-select: none !important;
    -webkit-user-select: none !important;
    -moz-user-select: none !important;
    -ms-user-select: none !important;
  }
  .batch-selector-layer {
    pointer-events: none !important;
  }
  .batch-selector-shell {
    position: fixed;
    bottom: 24px;
    left: 50%;
    max-width: calc(100vw - 32px);
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 16px;
    color: #f7f9fc;
    background: rgba(23, 32, 51, 0.88);
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.3);
    transform: translateX(-50%);
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    box-sizing: border-box;
    transform-origin: bottom center;
  }
  .treeclip-floating-surface {
    position: fixed;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 16px;
    color: #f7f9fc;
    background: rgba(23, 32, 51, 0.88);
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.3);
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.38;
    box-sizing: border-box;
    animation: treeclip-floating-surface-in 180ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .treeclip-floating-header {
    display: flex;
    min-height: 42px;
    padding: 8px 10px 7px 14px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .treeclip-floating-title {
    margin: 0;
    color: #f7f9fc;
    font-size: 15px;
    font-weight: 750;
    line-height: 1.25;
  }
  .treeclip-floating-close {
    display: grid;
    width: 28px;
    height: 28px;
    min-height: 28px;
    padding: 0;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 8px;
    color: #aebbd0;
    background: transparent;
    font: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .treeclip-floating-close:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }
  .treeclip-floating-body {
    padding: 10px 12px 12px;
  }
  .treeclip-floating-card {
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.055);
  }
  .treeclip-floating-button {
    min-height: 29px;
    padding: 5px 9px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    color: #edf3fb;
    background: rgba(255, 255, 255, 0.08);
    font: inherit;
    cursor: pointer;
  }
  .treeclip-floating-button:hover {
    background: rgba(255, 255, 255, 0.16);
  }
  .treeclip-floating-button-primary {
    border-color: #3b82f6;
    color: #fff;
    background: #2563eb;
  }
  .treeclip-floating-button-primary:hover {
    background: #1d4ed8;
  }
  .treeclip-key-config {
    bottom: 20px;
    left: 20px;
    z-index: 10001;
    width: min(330px, calc(100vw - 40px));
    font-size: 13px;
  }
  .treeclip-key-config .treeclip-floating-body {
    max-height: min(590px, calc(100vh - 84px));
    overflow-y: auto;
  }
  .treeclip-shortcut-list {
    display: grid;
    gap: 7px;
  }
  .treeclip-shortcut-item {
    padding: 8px;
  }
  .treeclip-shortcut-label {
    margin-bottom: 5px;
    color: #dbe5f3;
    font-size: 12px;
    font-weight: 700;
  }
  .treeclip-shortcut-display {
    min-height: 30px;
    padding: 5px 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #fff;
    background: rgba(255, 255, 255, 0.2);
    font-size: 12px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
    box-sizing: border-box;
    cursor: pointer;
  }
  .treeclip-shortcut-description {
    margin-top: 5px;
    color: #93a4bc;
    font-size: 11px;
  }
  .treeclip-shortcut-conflict {
    display: none;
    margin-top: 4px;
    color: #fca5a5;
    font-size: 11px;
  }
  .treeclip-shortcut-reference {
    margin-top: 10px;
    padding: 3px 10px;
  }
  .treeclip-shortcut-help {
    margin: 8px 2px 0;
    color: #93a4bc;
    font-size: 11px;
    line-height: 1.45;
  }
  .treeclip-floating-footer {
    display: flex;
    min-height: 34px;
    margin-top: 10px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .treeclip-floating-status {
    min-width: 0;
    color: #86efac;
    font-size: 11px;
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
  }
  .treeclip-guide-section-title {
    padding: 7px 0 3px;
    color: #93a4bc;
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.35px;
    text-transform: uppercase;
  }
  .treeclip-guide-row {
    display: grid;
    min-height: 34px;
    padding: 6px 0;
    grid-template-columns: minmax(98px, auto) 1fr;
    align-items: center;
    gap: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .treeclip-guide-row:first-child {
    border-top: 0;
  }
  .treeclip-guide-keys {
    color: #dbeafe;
    font-weight: 700;
    white-space: nowrap;
  }
  .treeclip-guide-key {
    display: inline-block;
    padding: 2px 6px;
    border: 1px solid rgba(96, 165, 250, 0.48);
    border-radius: 5px;
    color: #dbeafe;
    background: rgba(59, 130, 246, 0.22);
    font: inherit;
    font-size: 11px;
    line-height: 1.35;
  }
  .treeclip-guide-description {
    color: #cbd5e1;
    font-size: 12px;
  }
  .treeclip-type-prompt {
    bottom: 20px;
    left: 20px;
    z-index: 10001;
    width: min(380px, calc(100vw - 40px));
    padding: 12px;
    font-size: 13px;
  }
  .treeclip-type-prompt-header {
    display: flex;
    margin-bottom: 5px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .treeclip-type-prompt-title {
    min-width: 0;
    font-size: 14px;
    font-weight: 750;
  }
  .treeclip-type-prompt-description {
    margin-bottom: 10px;
    color: #aebbd0;
  }
  .treeclip-type-prompt-actions {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .treeclip-type-prompt-actions .treeclip-floating-button-primary {
    flex: 1;
  }
  .treeclip-type-prompt-choice {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #aebbd0;
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
  }
  .treeclip-type-prompt-choice input {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
  }
  .treeclip-type-prompt-switch {
    position: relative;
    width: 28px;
    height: 16px;
    flex: 0 0 28px;
    border-radius: 999px;
    background: rgba(120, 130, 148, 0.5);
    transition: background-color 180ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .treeclip-type-prompt-switch::after {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    content: "";
    transition: transform 200ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .treeclip-type-prompt-choice input:checked + .treeclip-type-prompt-switch {
    background: #34c759;
  }
  .treeclip-type-prompt-choice input:checked + .treeclip-type-prompt-switch::after {
    transform: translateX(12px);
  }
  .treeclip-type-prompt-choice input:focus-visible + .treeclip-type-prompt-switch {
    outline: 2px solid #60a5fa;
    outline-offset: 2px;
  }
  .treeclip-global-toast {
    top: 50%;
    left: 50%;
    z-index: 10002;
    max-width: min(420px, calc(100vw - 40px));
    padding: 11px 16px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 650;
    text-align: center;
    transform: translate(-50%, -50%);
  }
  @keyframes treeclip-floating-surface-in {
    from { opacity: 0; translate: 0 5px; scale: 0.98; }
    to { opacity: 1; translate: 0 0; scale: 1; }
  }
  .batch-selector-shell-open {
    width: min(360px, calc(100vw - 28px));
    will-change: translate, scale, opacity;
  }
  .batch-selector-shell-dragging {
    cursor: grabbing !important;
  }
  .batch-selector-action-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 8px;
    border: 0;
    border-radius: 0;
    color: #f7f9fc;
    background: transparent;
    box-shadow: none;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
  }
  .batch-selector-shell-open .batch-selector-action-bar {
    overflow-x: auto;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  .batch-selector-action-bar-compact {
    gap: 0;
    padding: 8px 4px;
    border-radius: 999px;
  }
  .batch-selector-action-bar-compact .batch-selector-action-summary {
    min-height: 24px;
    padding-block: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
  }
  .batch-selector-action-bar button,
  .batch-selector-details button {
    min-height: 29px;
    padding: 5px 9px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    color: #edf3fb;
    background: rgba(255, 255, 255, 0.08);
    font: inherit;
    cursor: pointer;
  }
  .batch-selector-action-bar button:hover,
  .batch-selector-details button:hover {
    background: rgba(255, 255, 255, 0.16);
  }
  .batch-selector-action-bar button:disabled,
  .batch-selector-details button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }
  .batch-selector-action-bar .batch-selector-primary-action {
    border-color: #3b82f6;
    background: #2563eb;
    color: #fff;
  }
  .batch-selector-action-bar .batch-selector-primary-action:hover {
    background: #1d4ed8;
  }
  .batch-selector-action-bar .batch-selector-danger-action {
    padding-inline: 9px;
    color: #fecaca;
  }
  .batch-selector-action-summary {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 6px 0 4px;
    border-color: transparent !important;
    color: inherit !important;
    background: transparent !important;
  }
  .batch-selector-action-summary:hover {
    background: rgba(255, 255, 255, 0.1) !important;
  }
  .batch-selector-action-count {
    display: inline-grid;
    min-width: 25px;
    height: 25px;
    padding: 0 6px;
    place-items: center;
    border-radius: 8px;
    color: #dbeafe;
    background: rgba(59, 130, 246, 0.22);
    font-weight: 750;
  }
  .batch-selector-details {
    width: 100%;
    max-width: 100%;
    max-height: calc(100vh - 112px);
    overflow-x: hidden;
    overflow-y: auto;
    padding: 5px 12px 12px;
    border: 0;
    border-radius: 0;
    color: #f7f9fc;
    background: transparent;
    box-shadow: none;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.38;
    box-sizing: border-box;
  }
  .treeclip-details-title {
    color: #fff;
    font-size: 17px;
    font-weight: 750;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  .treeclip-selected-groups {
    margin-top: 12px;
  }
  .treeclip-groups-label {
    display: flex;
    margin-bottom: 7px;
    align-items: center;
    gap: 6px;
    color: #9facbf;
    font-size: 0.76em;
    font-weight: 650;
    letter-spacing: 0.025em;
    line-height: 1.2;
  }
  .treeclip-groups-label::before {
    width: 3px;
    height: 11px;
    border-radius: 999px;
    background: #60a5fa;
    content: "";
  }
  .batch-selector-move-surface {
    display: grid;
    min-height: 20px;
    place-items: center;
    cursor: move;
    touch-action: none;
  }
  .batch-selector-sheet-grabber {
    display: grid !important;
    width: 58px !important;
    min-height: 20px !important;
    margin: 0 !important;
    padding: 0 !important;
    place-items: center;
    border: 0 !important;
    border-radius: 999px !important;
    background: transparent !important;
    cursor: grab !important;
    touch-action: none;
  }
  .batch-selector-sheet-grabber::before {
    width: 31px;
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.32);
    content: "";
    transition: transform 160ms ease, background-color 160ms ease;
  }
  .batch-selector-sheet-grabber:hover::before,
  .batch-selector-sheet-pulling .batch-selector-sheet-grabber::before {
    background: rgba(255, 255, 255, 0.5);
    transform: scaleX(1.16);
  }
  .batch-selector-shell-compact .batch-selector-move-surface {
    min-height: 0;
    height: 0;
    overflow: hidden;
    transition: height 180ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .batch-selector-shell-compact .batch-selector-sheet-grabber {
    width: 46px !important;
    min-height: 20px !important;
  }
  .batch-selector-shell-compact .batch-selector-sheet-grabber::before {
    width: 25px;
    height: 3px;
    opacity: 0;
    transform: scaleX(0.72);
    transition: opacity 140ms ease, transform 180ms ease, background-color 160ms ease;
  }
  .batch-selector-shell-compact:hover .batch-selector-move-surface,
  .batch-selector-shell-compact:focus-within .batch-selector-move-surface,
  .batch-selector-shell-compact.batch-selector-sheet-pulling .batch-selector-move-surface {
    height: 20px;
  }
  .batch-selector-shell-compact:hover .batch-selector-sheet-grabber::before,
  .batch-selector-shell-compact:focus-within .batch-selector-sheet-grabber::before,
  .batch-selector-shell-compact .batch-selector-sheet-grabber:focus-visible::before,
  .batch-selector-shell-compact.batch-selector-sheet-pulling .batch-selector-sheet-grabber::before {
    opacity: 1;
    transform: scaleX(1);
  }
  .batch-selector-sheet-pulling .batch-selector-sheet-grabber {
    cursor: grabbing !important;
  }
  .batch-selector-shell-dragging .batch-selector-move-surface {
    cursor: grabbing;
  }
  .treeclip-ios-disclosure-section {
    margin-top: 9px;
    padding-top: 7px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .treeclip-ios-section-header {
    display: flex;
    width: 100%;
    min-height: 28px;
    padding: 0 2px;
    align-items: center;
    justify-content: space-between;
    color: #f7f9fc;
    cursor: pointer;
  }
  .batch-selector-details .toggle-arrow {
    color: #8e9aaf;
    font-size: 0.78em;
    transition: transform 180ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .treeclip-ios-settings-card {
    overflow: hidden;
    margin-top: 4px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.055);
  }
  .treeclip-ios-settings-label {
    padding: 7px 10px 0;
    color: #9facbf;
    font-size: 0.76em;
    font-weight: 650;
    letter-spacing: 0.02em;
  }
  .treeclip-ios-segmented {
    display: grid;
    height: 36px;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    margin: 8px;
    padding: 3px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.24);
    box-sizing: border-box;
  }
  .treeclip-ios-segmented label {
    position: relative;
    display: block;
    height: 30px;
    cursor: pointer;
  }
  .treeclip-ios-segmented input,
  .treeclip-ios-clean-grid input,
  .treeclip-ios-switch-input {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
  }
  .treeclip-ios-segmented span {
    display: grid;
    width: 100%;
    height: 30px;
    min-height: 30px;
    padding: 0 7px;
    place-items: center;
    border-radius: 7px;
    color: #aebbd0;
    font-size: 0.8em;
    line-height: 1;
    box-sizing: border-box;
    transition: color 160ms ease, background-color 160ms ease, box-shadow 160ms ease, transform 120ms ease;
  }
  .treeclip-ios-segmented label:active span {
    transform: scale(0.96);
  }
  .treeclip-ios-segmented input:checked + span {
    color: #fff;
    background: rgba(82, 96, 122, 0.94);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
  }
  .treeclip-ios-segmented input:focus-visible + span,
  .treeclip-ios-clean-grid input:focus-visible + span,
  .treeclip-ios-switch-input:focus-visible + .treeclip-ios-switch {
    outline: 2px solid #60a5fa;
    outline-offset: 2px;
  }
  .treeclip-ios-clean-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    margin: 8px;
  }
  .treeclip-ios-clean-grid label {
    position: relative;
    min-width: 0;
    cursor: pointer;
  }
  .treeclip-ios-clean-chip {
    display: flex;
    min-height: 33px;
    padding: 6px 8px;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #aebbd0;
    background: rgba(255, 255, 255, 0.045);
    font-size: 0.8em;
    line-height: 1.15;
    text-align: center;
    box-sizing: border-box;
    transition: color 160ms ease, border-color 160ms ease, background-color 160ms ease, transform 120ms ease;
  }
  .treeclip-ios-clean-grid label:active .treeclip-ios-clean-chip {
    transform: scale(0.97);
  }
  .treeclip-ios-clean-grid input:checked + .treeclip-ios-clean-chip {
    border-color: rgba(96, 165, 250, 0.55);
    color: #eff6ff;
    background: rgba(59, 130, 246, 0.2);
  }
  .treeclip-ios-behavior-card {
    margin-top: 7px;
  }
  .batch-selector-group-count {
    display: inline-grid;
    flex: 0 0 auto;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    place-items: center;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.08);
    font-size: 0.74em;
  }
  .batch-selector-flow-grid {
    display: flex;
    max-width: 100%;
    flex-wrap: wrap;
    gap: 4px;
    align-items: start;
  }
  .batch-selector-flow-item {
    display: flex !important;
    width: auto !important;
    max-width: 100%;
    min-width: 0;
    flex: 0 1 auto;
    margin: 0 !important;
    padding: 5px 7px !important;
    align-items: center;
    gap: 6px;
    font-size: 0.82em;
    text-align: left;
  }
  .batch-selector-flow-wide {
    width: 100% !important;
    flex-basis: 100%;
  }
  .batch-selector-flow-preview {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: #fff;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .batch-selector-hierarchy-chip {
    display: block;
    min-width: 0;
    margin: 0;
    padding: 2px 6px;
    overflow: hidden;
    border: 1px solid rgba(96, 165, 250, 0.48);
    border-radius: 5px;
    color: #dbeafe;
    background: rgba(59, 130, 246, 0.22);
    font-size: 0.76em;
    font-weight: 650;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .batch-selector-flow-item:hover .batch-selector-hierarchy-chip {
    border-color: rgba(96, 165, 250, 0.72);
    background: rgba(59, 130, 246, 0.32);
  }
  .batch-selector-group-hierarchy {
    flex: 0 1 auto;
    max-width: 260px;
  }
  .batch-selector-field-hierarchy {
    flex: 0 1 42%;
    max-width: 150px;
  }
  .treeclip-ios-setting-row {
    position: relative;
    display: flex;
    min-height: 35px;
    margin-left: 10px;
    padding: 5px 10px 5px 0;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    color: #edf3fb;
    font-size: 0.84em;
    cursor: pointer;
  }
  .treeclip-ios-settings-label + .treeclip-ios-setting-row {
    border-top: 0;
  }
  .treeclip-ios-setting-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }
  .treeclip-ios-setting-copy small {
    margin-top: 2px;
    color: #8996aa;
    font-size: 0.88em;
  }
  .treeclip-ios-switch {
    position: relative;
    width: 36px;
    height: 20px;
    flex: 0 0 36px;
    border-radius: 999px;
    background: rgba(120, 130, 148, 0.46);
    transition: background-color 180ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .treeclip-ios-switch::after {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    content: "";
    transition: transform 200ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .treeclip-ios-switch-input:checked + .treeclip-ios-switch {
    background: #34c759;
  }
  .treeclip-ios-switch-input:checked + .treeclip-ios-switch::after {
    transform: translateX(16px);
  }
  .batch-selector-copy-feedback {
    animation: treeclip-copy-tap 180ms ease-out;
  }
  @keyframes treeclip-copy-tap {
    0%, 100% { transform: scale(1); }
    45% { transform: scale(0.94); }
  }
  @media (max-width: 700px) {
    .batch-selector-shell {
      right: auto;
      bottom: 12px;
      left: 50%;
      max-width: calc(100vw - 24px);
      width: max-content;
      transform: translateX(-50%);
    }
    .batch-selector-shell-open {
      right: 12px;
      left: 12px;
      width: auto;
      max-width: none;
      transform: none;
    }
    .batch-selector-action-bar {
      overflow-x: auto;
    }
    .batch-selector-details {
      max-height: calc(100vh - 100px);
    }
    .treeclip-key-config,
    .treeclip-type-prompt {
      right: 12px;
      left: 12px;
      width: auto;
      max-width: none;
    }
    .treeclip-guide-row {
      grid-template-columns: minmax(90px, auto) 1fr;
    }
    .treeclip-type-prompt-actions {
      flex-wrap: wrap;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .batch-selector-shell-open,
    .batch-selector-sheet-grabber::before,
    .batch-selector-copy-feedback,
    .treeclip-floating-surface {
      transition: none !important;
      animation: none !important;
    }
  }
`;
document.head.appendChild(style);

// =============================================
// 鼠标事件处理 - 捕获阶段的事件处理
// 实现Shift+点击选择和框选等核心交互功能
// =============================================
// 监听鼠标按下事件 - 捕获阶段
document.addEventListener('mousedown', function(event) {
  // 如果正在配置快捷键，不处理其他鼠标事件
  if (isShowingKeyConfig) {
    return;
  }

  if (isShiftPressed || selectKeyCombinationActive) {
    // 检查是否点击或其父元素是扩展的UI元素
    if (event.target.closest('.batch-selector-ui') ||
        event.target.id === 'batch-selector-notification' ||
        event.target.id === 'batch-selector-info' ||
        event.target.id === 'batch-selector-prompt' ||
        event.target.id === 'batch-selector-global-msg' ||
        event.target.id === 'batch-selector-key-config') {
      // 允许UI元素正常点击，但不处理选择逻辑
      return;
    }

    // 左键拖动开始框选
    if (event.button === 0) {
      // 阻止默认行为和事件传播
      event.preventDefault();
      event.stopPropagation();

      // 记录开始位置（考虑页面滚动位置）
      startX = event.clientX + window.pageXOffset;
      startY = event.clientY + window.pageYOffset;

      // 开始框选
      startBoxSelection();
    }

  }
}, true);

// 监听鼠标移动事件 - 捕获阶段
document.addEventListener('mousemove', function(event) {
  // 如果正在配置快捷键，不处理其他鼠标事件
  if (isShowingKeyConfig) {
    return;
  }

  if (isSelecting && (isShiftPressed || selectKeyCombinationActive)) {
    // 更新选择框（考虑页面滚动位置）
    updateBoxSelection(event.clientX + window.pageXOffset, event.clientY + window.pageYOffset);

    event.preventDefault();
    event.stopPropagation();
  }
}, true);

// 监听鼠标释放事件 - 捕获阶段
document.addEventListener('mouseup', function(event) {
  // 如果正在配置快捷键，不处理其他鼠标事件
  if (isShowingKeyConfig) {
    return;
  }

  if (isSelecting && (isShiftPressed || selectKeyCombinationActive)) {
    // 完成框选
    finishBoxSelection();

    event.preventDefault();
    event.stopPropagation();
  }
}, true);

// =============================================
// 框选功能 - 实现矩形区域内元素的批量选择
// =============================================
// 创建选择框
function startBoxSelection() {
  // 设置状态为正在选择
  isSelecting = true;

  // 创建选择框元素
  selectBox = document.createElement('div');
  selectBox.id = 'batch-selector-box';
  selectBox.style.position = 'absolute';
  selectBox.style.border = '1px dashed blue';
  selectBox.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
  selectBox.style.zIndex = '9999';
  selectBox.style.left = startX + 'px';
  selectBox.style.top = startY + 'px';
  selectBox.style.width = '0';
  selectBox.style.height = '0';
  selectBox.style.pointerEvents = 'none'; // 防止框选择框本身干扰选择

  // 添加到文档
  document.body.appendChild(selectBox);
}

// 更新选择框位置和大小
function updateBoxSelection(currentX, currentY) {
  if (!selectBox) return;

  // 计算框的位置和大小
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  // 计算左上角坐标（考虑向不同方向拖动）
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);

  // 更新框的样式
  selectBox.style.width = width + 'px';
  selectBox.style.height = height + 'px';
  selectBox.style.left = left + 'px';
  selectBox.style.top = top + 'px';
}

// 完成框选择
function finishBoxSelection() {
  if (!selectBox) return;

  // 获取选择框的位置和大小
  const boxRect = selectBox.getBoundingClientRect();

  // 调整boxRect考虑滚动位置
  const adjustedBoxRect = {
    left: boxRect.left + window.pageXOffset,
    top: boxRect.top + window.pageYOffset,
    right: boxRect.right + window.pageXOffset,
    bottom: boxRect.bottom + window.pageYOffset,
    width: boxRect.width,
    height: boxRect.height
  };

  // 查找框内的所有元素
  const elementsInBox = findElementsInBox(adjustedBoxRect);

  // 如果找到元素，添加到选中列表
  if (elementsInBox.length > 0) {
    // 检查是否要清除当前选择（如果没有按住选择键）
    // 注意：这里不再使用event.shiftKey，因为我们使用的是自定义选择键
    // 由于框选时isShiftPressed一定为true，所以这里不需要额外检查
    // 如果需要在框选时按住其他键来追加选择，可以在这里添加检查

    // 添加框内元素到选中列表（累加选择，不清除当前选择）
    elementsInBox.forEach(el => {
      // 如果元素未被选中，添加它
      if (!selectedElements.includes(el)) {
        markElementSelected(el);
        selectedElements.push(el);
      }
    });

    // 如果有选中元素，更新父元素链和当前类型
    if (selectedElements.length > 0) {
      // 使用第一个元素作为参考
      const firstElement = selectedElements[0];
      collectParentChain(firstElement);

      // 更新当前元素类型
      currentElementTypeKey = getElementTypeKey(firstElement);
    }

    // 更新UI
    updateNotification(selectedElements.length);

    // 更新剪贴板
    updateClipboard();

    // 播放选择声音效果（可选）
    playSelectSound();
  }

  // 移除选择框
  cancelBoxSelection();
}

// 取消框选择
function cancelBoxSelection() {
  isSelecting = false;

  // 移除选择框
  if (selectBox && selectBox.parentNode) {
    selectBox.parentNode.removeChild(selectBox);
  }

  selectBox = null;
}

// =============================================
// 元素查找与筛选系统 - 实现智能元素识别和选择
// =============================================
// 查找框内的所有元素
function findElementsInBox(boxRect) {
  // 所有可能的目标元素
  const potentialElements = document.querySelectorAll('*');
  const elementsInBox = [];
  const preFilteredElements = []; // 先收集所有满足基本条件的元素

  // 第一遍：收集所有框内且有意义的元素
  potentialElements.forEach(el => {
    // 跳过扩展自身的UI元素
    if (el.closest('.batch-selector-ui') ||
        el.id === 'batch-selector-notification' ||
        el.id === 'batch-selector-info' ||
        el.id === 'batch-selector-prompt' ||
        el.id === 'batch-selector-global-msg' ||
        el.id === 'batch-selector-box' ||
        el.classList.contains('batch-selector-ui')) {
      return;
    }

    const computedStyle = window.getComputedStyle(el);
    if (isElementHiddenOrDisabled(el, computedStyle)) {
      return;
    }

    // 获取元素的边界框并调整为绝对位置
    const elRect = el.getBoundingClientRect();
    const adjustedElRect = {
      left: elRect.left + window.pageXOffset,
      top: elRect.top + window.pageYOffset,
      right: elRect.right + window.pageXOffset,
      bottom: elRect.bottom + window.pageYOffset,
      width: elRect.width,
      height: elRect.height
    };

    // 检查元素是否在框内
    // 我们考虑元素有一定比例在框内就算选中
    const overlap = getOverlapPercentage(adjustedElRect, boxRect);

    if (overlap > 0.5) { // 提高阈值到50%以上的重叠算作选中
      if (isSignificantElement(el, computedStyle)) {
        preFilteredElements.push({
          element: el,
          depth: getElementDepth(el)
        });
      }
    }
  });

  // 按深度排序所有预筛选的元素（从浅到深）
  preFilteredElements.sort((a, b) => a.depth - b.depth);

  // 第二遍：过滤掉嵌套的元素，只保留最浅层级
  for (let i = 0; i < preFilteredElements.length; i++) {
    const current = preFilteredElements[i];
    let isContainedBySelected = false;

    // 检查当前元素是否被已选中的更浅层级元素包含
    for (const selected of elementsInBox) {
      if (selected.contains(current.element)) {
        isContainedBySelected = true;
        break;
      }
    }

    // 如果不被任何已选元素包含，才添加
    if (!isContainedBySelected) {
      elementsInBox.push(current.element);
    }
  }

  return elementsInBox;
}

// 获取元素在DOM树中的深度
function getElementDepth(el) {
  let depth = 0;
  let current = el;

  while (current && current !== document.documentElement) {
    depth++;
    current = current.parentElement;
  }

  return depth;
}

// 检查元素是否隐藏或禁用
function isElementHiddenOrDisabled(el, style = window.getComputedStyle(el)) {
  // 检查元素是否可见
  if (style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      el.offsetWidth === 0 ||
      el.offsetHeight === 0) {
    return true;
  }

  return false;
}

// 计算两个矩形的重叠百分比
function getOverlapPercentage(rect1, rect2) {
  // 计算重叠区域
  const overlapLeft = Math.max(rect1.left, rect2.left);
  const overlapRight = Math.min(rect1.right, rect2.right);
  const overlapTop = Math.max(rect1.top, rect2.top);
  const overlapBottom = Math.min(rect1.bottom, rect2.bottom);

  // 如果没有重叠区域，返回0
  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
    return 0;
  }

  // 计算重叠面积
  const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);

  // 计算元素面积
  const rect1Area = rect1.width * rect1.height;

  // 防止除以零
  if (rect1Area === 0) return 0;

  // 返回重叠百分比
  return overlapArea / rect1Area;
}

// 检查元素是否对用户有意义
function isSignificantElement(el, style = window.getComputedStyle(el)) {
  // 忽略宽度或高度太小的元素
  if (el.offsetWidth < 5 || el.offsetHeight < 5) {
    return false;
  }

  // 检查元素是否是文本节点或包含文本内容
  const hasText = el.textContent && el.textContent.trim().length > 0;

  // 检查重要标签类型
  const importantTags = ['a', 'button', 'input', 'select', 'textarea', 'img', 'video', 'audio',
                         'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th', 'tr',
                         'label', 'option', 'canvas', 'svg', 'iframe', 'dd', 'dt']; // 添加 dd 和 dt

  if (importantTags.includes(el.tagName.toLowerCase())) {
    return true;
  }

  // 检查角色属性
  const importantRoles = ['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab', 'tabpanel',
                          'listitem', 'option', 'heading', 'img', 'banner', 'navigation'];
  if (el.hasAttribute('role') && importantRoles.includes(el.getAttribute('role'))) {
    return true;
  }

  // 检查元素是否可点击
  if (el.hasAttribute('onclick') ||
      el.hasAttribute('href') ||
      style.cursor === 'pointer') {
    return true;
  }

  // 检查是否有意义的样式特征(如边框、背景色等)
  if (style.border !== 'none' ||
      style.borderRadius !== '0px' ||
      style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
    // 检查元素大小，太大的元素可能是容器
    const isReasonableSize = el.offsetWidth < 500 && el.offsetHeight < 500;
    if (isReasonableSize) {
      return true;
    }
  }

  // 如果元素有有意义的文本内容且不是容器元素
  if (hasText && el.children.length === 0) {
    return true;
  }

  // 更严格地检查大型容器
  if (el.tagName.toLowerCase() === 'div' || el.tagName.toLowerCase() === 'section') {
    // 如果是容器元素，且太大或包含太多子元素，则认为不重要
    if (el.offsetWidth > 400 || el.offsetHeight > 400 || el.children.length > 5) {
      return false;
    }
  }

  return false;
}

// =============================================
// 用户反馈系统 - 提供视觉和听觉反馈
// =============================================
// 播放选择声音（可选）
function playSelectSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    selectAudioContext ??= new AudioContextClass();

    // 创建一个振荡器
    const oscillator = selectAudioContext.createOscillator();
    const gainNode = selectAudioContext.createGain();

    // 设置音量
    gainNode.gain.setValueAtTime(0.1, selectAudioContext.currentTime);

    // 连接节点
    oscillator.connect(gainNode);
    gainNode.connect(selectAudioContext.destination);

    // 设置频率和类型
    oscillator.type = 'sine';
    oscillator.frequency.value = 600;

    // 设置衰减
    gainNode.gain.exponentialRampToValueAtTime(0.001, selectAudioContext.currentTime + 0.3);

    // 播放音频
    oscillator.start();
    oscillator.stop(selectAudioContext.currentTime + 0.3);
  } catch (e) {
    // console.log('无法播放选择声音', e);
  }
}

// =============================================
// 点击选择系统 - 实现单击元素选择和类型检测
// 与框选功能互补，提供更精确的选择方式
// =============================================
// 监听鼠标点击事件 - 捕获阶段
document.addEventListener('click', function(event) {
  // 只在按住Shift键时处理
  if (!isShiftPressed) {
    return;
  }

  // console.log("Shift+点击被触发:", event.target.tagName,
  //             "id:", event.target.id,
  //             "class:", event.target.className,
  //             "isUIElement:", event.target.closest('.batch-selector-ui') !== null);

  // 检查是否点击了扩展自己的UI元素
  const isUIElement = event.target.closest('.batch-selector-ui') ||
      event.target.id === 'batch-selector-notification' ||
      event.target.id === 'batch-selector-info' ||
      event.target.id === 'batch-selector-prompt' ||
      event.target.id === 'batch-selector-global-msg' ||
      event.target.classList.contains('batch-selector-ui');

  // 检查是否是层级选择器
  const isLevelSelector = event.target.classList.contains('level-selector') ||
                          event.target.closest('.level-selector') !== null;

  // 检查是否是元素类型选择器
  const isTypeSelector = event.target.classList.contains('element-type-selector') ||
                         event.target.closest('.element-type-selector') !== null;

  // 如果是UI元素但不是特殊的选择器，阻止事件传播但不进行选择
  if (isUIElement && !isLevelSelector && !isTypeSelector) {
    // 阻止事件传播，但允许UI正常工作
    event.stopPropagation();
    return;
  }

  // 如果是级别选择器则由级别选择器自己的点击事件处理，不在这里处理
  if (isLevelSelector) {
    return;
  }

  // 如果是元素类型选择器则由元素类型选择器自己的点击事件处理，不在这里处理
  if (isTypeSelector) {
    // 阻止默认行为
    event.preventDefault();

    // 获取元素类型选择器
    const typeSelector = event.target.closest('.element-type-selector');
    if (typeSelector) {
      const typeKey = typeSelector.getAttribute('data-type');

      // 检查是否按住Shift键
      if (event.shiftKey || isShiftPressed) {
        cancelElementTypeSelection(typeKey);
      }
    }

    return;
  }

  // 阻止默认行为和事件传播
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  // 获取点击的元素
  const clickedElement = event.target;

  // 检查是否点击了已选中的元素（Excel风格取消选择）
  if (selectedElements.length > 0) {
    const index = selectedElements.findIndex(el => el === clickedElement);

    if (index !== -1) {
      // 已经选中的元素被再次点击，取消选择
      unmarkElementSelected(clickedElement);
      selectedElements.splice(index, 1);

      // 更新通知
      updateNotification(selectedElements.length);

      // 更新剪贴板
      updateClipboard();

      return;
    }
  }

  // 高亮显示点击的元素并添加到已选中列表
  markElementSelected(clickedElement);
  selectedElements.push(clickedElement);

  // 更新父元素链，记录最新点击元素的层级
  collectParentChain(clickedElement);

  // 更新当前选中的元素类型
  currentElementTypeKey = getElementTypeKey(clickedElement);

  // 始终显示最新点击的元素信息
  showElementInfo(clickedElement, selectedElements.length);

  // 检查是否连续点击了相同类型的元素
  checkConsecutiveSameTypeElements(clickedElement);

  // 更新通知
  updateNotification(selectedElements.length);

  // 更新剪贴板
  updateClipboard();

  return false;
}, true);

// 检查是否连续点击了相同类型的元素
function checkConsecutiveSameTypeElements(element) {
  // 存储当前元素的标签和类名信息
  const elementInfo = {
    element: element,
    tagName: element.tagName,
    className: getElementClassName(element)
  };

  // 添加到连续元素数组
  consecutiveSameTypeElements.push(elementInfo);

  // 如果已经连续点击了2个相同类型的元素，显示批量选择提示
  if (consecutiveSameTypeElements.length >= 2) {
    const lastElement = consecutiveSameTypeElements[consecutiveSameTypeElements.length - 1];
    const secondLastElement = consecutiveSameTypeElements[consecutiveSameTypeElements.length - 2];

    if (lastElement.tagName === secondLastElement.tagName &&
        lastElement.className === secondLastElement.className) {
      // 检查是否设置了不再提示
      if (!hideTypePrompt) {
      // 显示询问是否选择所有相同类型元素的提示
      showSelectAllOfTypePrompt(lastElement);
      }
    }
  }

  // 如果连续元素超过5个，移除最旧的
  if (consecutiveSameTypeElements.length > 5) {
    consecutiveSameTypeElements.shift();
  }
}

// =============================================
// 批量选择提示系统 - 检测相同类型元素并提供批量选择功能
// =============================================
// 显示询问是否选择所有相同类型元素的提示
function showSelectAllOfTypePrompt(elementInfo) {
  // 查找或创建提示容器
  let promptContainer = document.getElementById('batch-selector-prompt');

  if (!promptContainer) {
    promptContainer = document.createElement('div');
    promptContainer.id = 'batch-selector-prompt';
    promptContainer.className = 'batch-selector-ui treeclip-floating-surface treeclip-type-prompt';

    // 阻止默认点击行为
    promptContainer.addEventListener('mousedown', function(e) {
      if (isShiftPressed) {
        e.stopPropagation();
      }
    }, true);

    promptContainer.addEventListener('click', function(e) {
      if (isShiftPressed) {
        e.stopPropagation();
      }
    }, true);

    document.body.appendChild(promptContainer);
  }

  // 获取更友好的元素描述
  let elementDesc = elementInfo.tagName.toLowerCase();
  if (elementInfo.className) {
    const mainClass = elementInfo.className.split(' ')[0];
    if (mainClass) {
      elementDesc += `.${mainClass}`;
    }
  }

  // 获取当前"选择相同类型键"的格式化显示
  const typeSelectKeyText = escapeHtml(typeSelectKeyConfig.keys.map(formatKeyForDisplay).join('+'));
  promptContainer.dataset.treeclipElementDesc = elementDesc;

  // 显示提示内容 - 优化文本
  promptContainer.innerHTML = `
    <div class="treeclip-type-prompt-header">
      <div class="treeclip-type-prompt-title" data-treeclip-type-prompt-title>${t('prompt_batch_select')}</div>
      <label class="treeclip-type-prompt-choice">
        <input type="checkbox" id="hide-type-prompt" class="batch-selector-ui">
        <span class="treeclip-type-prompt-switch" aria-hidden="true"></span>
        <span data-treeclip-type-prompt-choice>${t('checkbox_dont_show')}</span>
      </label>
    </div>
    <div class="treeclip-type-prompt-description" data-treeclip-type-prompt-description>${t('prompt_batch_select_desc', escapeHtml(elementDesc))}</div>
    <div class="treeclip-type-prompt-actions">
      <button id="select-all-of-type-confirm" class="batch-selector-ui treeclip-floating-button treeclip-floating-button-primary">${t('btn_select_all')} (${typeSelectKeyText})</button>
      <button id="select-all-of-type-cancel" class="batch-selector-ui treeclip-floating-button">${t('btn_cancel')}</button>
    </div>
  `;

  // 设置自动消失计时器
  if (typePromptTimeoutId !== null) {
    clearTimeout(typePromptTimeoutId);
  }
  typePromptTimeoutId = setTimeout(() => {
    if (document.body.contains(promptContainer)) {
      promptContainer.remove();
    }
    typePromptTimeoutId = null;
  }, 8000);

  // innerHTML设置后即可同步绑定，避免重复提示时旧任务绑定到新按钮。
    const confirmButton = promptContainer.querySelector('#select-all-of-type-confirm');
    const cancelButton = promptContainer.querySelector('#select-all-of-type-cancel');
    const hidePromptCheckbox = promptContainer.querySelector('#hide-type-prompt');

    if (hidePromptCheckbox) {
      hidePromptCheckbox.addEventListener('change', function() {
        hideTypePrompt = this.checked;
        // 保存设置到存储
        try {
          chrome.storage.local.set({'batch-selector-hide-type-prompt': hideTypePrompt});
          // console.log(`相同元素提示设置已${hideTypePrompt ? '禁用' : '启用'}`);
        } catch (e) {
          // console.error('无法保存设置:', e);
        }
      });
    }

    if (confirmButton) {
      confirmButton.classList.add('batch-selector-ui');
      confirmButton.addEventListener('click', function() {
        clearTimeout(typePromptTimeoutId);
        typePromptTimeoutId = null;

        // 检查是否选中了"不再提示"
        const hidePromptCheckbox = promptContainer.querySelector('#hide-type-prompt');
        if (hidePromptCheckbox && hidePromptCheckbox.checked) {
          hideTypePrompt = true;
          // 保存设置到存储
          try {
            chrome.storage.local.set({'batch-selector-hide-type-prompt': true});
            // console.log('相同元素提示设置已禁用');
          } catch (e) {
            // console.error('无法保存设置:', e);
          }
        }

        selectAllOfType();
        promptContainer.remove();
      });
    }

    if (cancelButton) {
      cancelButton.classList.add('batch-selector-ui');
      cancelButton.addEventListener('click', function() {
        clearTimeout(typePromptTimeoutId);
        typePromptTimeoutId = null;

        // 检查是否选中了"不再提示"
        const hidePromptCheckbox = promptContainer.querySelector('#hide-type-prompt');
        if (hidePromptCheckbox && hidePromptCheckbox.checked) {
          hideTypePrompt = true;
          // 保存设置到存储
          try {
            chrome.storage.local.set({'batch-selector-hide-type-prompt': true});
            // console.log('相同元素提示设置已禁用');
          } catch (e) {
            // console.error('无法保存设置:', e);
          }
        }

        promptContainer.remove();
      });
    }
}

// 选择所有相同类型的元素
function selectAllOfType() {
  // 如果没有当前选中元素类型，则无法进行精确匹配
  if (!currentElementTypeKey) {
    // console.log('未指定当前元素类型，无法精确匹配');
    return;
  }

  // 清除当前未匹配的元素
  const currentTypeElements = [];
  const otherElements = [];

  // 分离当前类型元素和其他元素
  selectedElements.forEach(el => {
    if (matchesElementType(el, currentElementTypeKey)) {
      currentTypeElements.push(el);
    } else {
      otherElements.push(el);
      // 不再清除其他元素的高亮，保留所有已选中元素的蓝框
      // 确保元素仍然有高亮样式
      markElementSelected(el);
    }
  });

  const matchingElements = getElementsByTypeKey(currentElementTypeKey);

  // 已选元素映射，避免重复添加
  const selectedMap = new Set(selectedElements);

  // 选择具有完全相同类的元素
  let newSelectedCount = 0;

  matchingElements.forEach(el => {
    if (selectedMap.has(el)) {
      return;
    }

    markElementSelected(el);
    currentTypeElements.push(el);
    newSelectedCount++;
  });

  // 将当前类型元素与其他保留的元素合并
  selectedElements = [...currentTypeElements, ...otherElements];

  // console.log(`新增选择了 ${newSelectedCount} 个元素，当前共有 ${selectedElements.length} 个元素被选中`);

  // 更新通知
  updateNotification(selectedElements.length);

  // 更新剪贴板
  updateClipboard();
}

// 选择页面上的所有元素
function selectAllElements() {
  // 获取当前"选择相同类型键"的格式化显示
  const typeSelectKeyText = typeSelectKeyConfig.keys.map(formatKeyForDisplay).join('+');

  // 如果还没有选过任何元素，提示
  if (selectedElements.length === 0) {
    showTemporaryGlobalMessage(t('msg_select_at_least_one', typeSelectKeyText), 3000);
    return;
  }

  // 确保有当前选中的元素类型
  if (!currentElementTypeKey) {
    // 使用最后选择的元素设置当前元素类型
    const lastElement = selectedElements[selectedElements.length - 1];
    currentElementTypeKey = getElementTypeKey(lastElement);
    // console.log('设置当前元素类型为:', currentElementTypeKey);
  }

  // 直接调用选择相同类型元素的方法
  selectAllOfType();
}

// =============================================
// 元素信息展示 - 显示选中元素的详细信息
// =============================================
// 显示元素信息
function showElementInfo(element, count) {
  // 生成元素信息
  const info = generateSelectorForElement(element);

  // 更新全局变量存储当前点击的元素信息
  window.clickedElementInfo = {
    count: count,
    info: info,
    element: element
  };

  // console.log('已更新点击元素信息:', window.clickedElementInfo);

  // 如果有主UI，直接更新它而不创建新通知
  const mainUI = document.getElementById('batch-selector-notification');
  if (mainUI) {
    // 刷新主UI以显示新信息
    updateNotification(selectedElements.length);
  } else {
    // 如果还没有主UI，使用临时信息
    showTemporaryMessage(`${t('ui_current_element')} ${count}: ${info}`);
  }
}

// =============================================
// 元素层级导航系统 - 管理元素的父子关系和层级结构
// 核心功能之一，支持精确的层级导航和选择
// =============================================
// 收集元素的父元素链
function collectParentChain(element) {
  parentChain = [];
  let current = element;

  while (current && current !== document.body) {
    parentChain.push(current);
    current = current.parentElement;
  }

  // 添加body作为最顶层
  if (current === document.body) {
    parentChain.push(current);
  }

  // 重置索引
  parentChainIndex = 0;

  // 同时收集子元素链
  collectChildrenChain(element);
}

// 收集元素的子元素链
function collectChildrenChain(element) {
  childrenChain = getTextFieldCandidates(element);
}

// 查看元素内部内容
function viewInside() {
  if (selectedElements.length === 0) return;

  // 获取当前选中元素
  let referenceElement = null;

  // 如果有特定元素类型被选中，使用该类型的第一个元素
  if (currentElementTypeKey) {
    referenceElement = selectedElements.find(el => matchesElementType(el, currentElementTypeKey)) || null;
  }

  // 如果没有找到特定类型的元素，使用第一个选中元素
  if (!referenceElement) {
    referenceElement = selectedElements[0];
  }

  // 收集子元素
  collectChildrenChain(referenceElement);

  // 如果没有子元素，不进行操作
  if (childrenChain.length === 0) {
    showTemporaryGlobalMessage(t('msg_no_internal_elements'), 3000);
    return;
  }

  // 标记正在查看子元素
  isViewingChildren = true;
  if (getSelectionUIDetent() === 'details') {
    updateNotification(selectedElements.length);
  } else {
    transitionSelectionUIDetent('details');
  }
}

// 返回父元素视图
function returnToParentView() {
  isViewingChildren = false;
  updateNotification(selectedElements.length);
}

// 选择子元素
function selectChildElement(childIndex) {
  if (childIndex < 0 || childIndex >= childrenChain.length) return;

  // 获取选择的子元素
  const childElement = childrenChain[childIndex];

  // 检查当前是否有特定元素类型被选中
  if (currentElementTypeKey) {
    const typeElements = selectedElements.filter(el => matchesElementType(el, currentElementTypeKey));
    typeElements.forEach(unmarkElementSelected);

    // 从选中列表中移除当前类型的元素
    selectedElements = selectedElements.filter(el => !matchesElementType(el, currentElementTypeKey));

    const newTypeKey = getElementTypeKey(childElement);

    // 只在当前选中元素内部查找匹配的子元素，而不是在整个文档中查找
    const matchingChildElements = [];

    // 遍历每个当前类型的元素，查找其内部的匹配子元素
    typeElements.forEach(parentEl => {
      const childrenOfParent = getElementsByTypeKey(newTypeKey, parentEl);
      childrenOfParent.forEach(child => {
        if (!matchingChildElements.includes(child)) {
          matchingChildElements.push(child);
        }
      });
    });

    // 添加匹配的子元素到选中列表
    matchingChildElements.forEach(el => {
      markElementSelected(el);
      selectedElements.push(el);
    });

    // 更新当前元素类型
    currentElementTypeKey = newTypeKey;

    // 更新父元素链
    collectParentChain(childElement);

    // 返回到父元素视图
    isViewingChildren = false;

    // 更新通知
    updateNotification(selectedElements.length);

    // 更新剪贴板
    updateClipboard();

    return;
  }

  // 如果没有特定元素类型被选中，使用原有逻辑
  // 获取父元素选择器（当前选中的元素）
  const parentSelector = currentSelector;

  // 生成子元素的相对选择器
  let childSelector = generateRelativeSelector(childElement);

  // 构建组合选择器，选择所有父元素下符合子元素特征的元素
  let newSelector = `${parentSelector} ${childSelector}`;

  // 更新选择器并重新选择元素（不清除当前选择）
  updateSelection(newSelector, false);

  // 返回到父元素视图
  isViewingChildren = false;
}
// =============================================
// 选择器生成系统 - 为元素创建CSS选择器
// 支持多种选择器生成策略以适应不同场景
// =============================================
// 生成相对于父元素的选择器
function generateRelativeSelector(element) {
  let selector = element.tagName.toLowerCase();

  // 如果是链接元素，尝试生成更通用的选择器
  if (selector === 'a') {
    // 获取标签内的文本
    const text = element.textContent.trim();

    // 如果链接有类名，使用类名
    const className = getElementClassName(element);
    if (className) {
      const classes = className.split(' ');
      for (const cls of classes) {
        if (cls.trim()) {
          selector += `.${escapeCssIdentifier(cls.trim())}`;
        }
      }
      return selector;
    }

    // 如果链接有title属性，使用内部匹配器，避免把页面内容拼进CSS选择器
    if (element.title) {
      return `${selector}:treeclip-title-contains(${encodeURIComponent(element.title.split('.')[0])})`;
    }

    // 如果链接文本不空，使用文本内容作为选择器
    if (text) {
      // 如果文本有明显特征（如域名），使用部分文本作为选择器
      const domainMatch = text.match(/([a-zA-Z0-9-]+)\.[a-zA-Z]{2,}(\.[a-zA-Z]{2,})?/);
      if (domainMatch) {
        const domainPart = domainMatch[1];
        return `${selector}:treeclip-contains(${encodeURIComponent(domainPart)})`;
      }

      // 否则使用整个文本
      return `${selector}:treeclip-contains(${encodeURIComponent(text)})`;
    }
  }

  // 添加ID（如果有）
  if (element.id) {
    return `${selector}#${escapeCssIdentifier(element.id)}`;
  }

  // 添加类名（如果有）
  const className = getElementClassName(element);
  if (className) {
    const classes = className.split(' ');
    classes.forEach(cls => {
      if (cls.trim()) {
        selector += `.${escapeCssIdentifier(cls.trim())}`;
      }
    });
  }

  return selector;
}

// TreeClip内部选择器扩展。保持在扩展作用域内，不修改宿主页面的document对象。
function queryElements(selector) {
  const customMatchers = [
    {
      marker: ':treeclip-title-contains(',
      getValue: element => element.title || ''
    },
    {
      marker: ':treeclip-contains(',
      getValue: element => element.textContent || ''
    }
  ];

  try {
    for (const { marker, getValue } of customMatchers) {
      const markerIndex = selector.indexOf(marker);
      if (markerIndex === -1) continue;
      if (!selector.endsWith(')')) return [];

      const baseSelector = selector.slice(0, markerIndex);
      const encodedSearchText = selector.slice(markerIndex + marker.length, -1);
      const searchText = decodeURIComponent(encodedSearchText);
      return Array.from(document.querySelectorAll(baseSelector)).filter(element =>
        getValue(element).includes(searchText)
      );
    }

    return Array.from(document.querySelectorAll(selector));
  } catch (error) {
    console.warn('TreeClip: 无法解析选择器', selector, error);
    return [];
  }
}

// =============================================
// 选择更新系统 - 更新当前选中的元素集合
// 处理选择器变化和选中元素更新
// =============================================
// 更新选择内容
function updateSelection(newSelector, clearCurrent = false) {
  // 如果需要清除当前选择（默认不清除，保持累加选择）
  if (clearCurrent) {
    selectedElements.forEach(el => {
      if (el && el.style) {
        unmarkElementSelected(el);
      }
    });
    selectedElements = [];
  }

  // 更新当前选择器
  currentSelector = newSelector;

  const newSelectedElements = queryElements(newSelector);

  // 累加新结果；只有明确要求时才替换现有选择。
  const mergedSelection = clearCurrent ? [] : [...selectedElements];
  const newSelectionArray = Array.from(newSelectedElements);
  newSelectionArray.forEach(el => {
    if (!mergedSelection.includes(el)) {
      markElementSelected(el);
      mergedSelection.push(el);
    }
  });
  selectedElements = mergedSelection;

  // 尝试自动检测是否有单一链接元素
  if (!isViewingChildren && newSelectionArray.length > 0) {
    // 检查第一个元素是否只有一个链接子元素
    const firstElement = newSelectionArray[0];
    const linkElements = firstElement.querySelectorAll('a');

    if (linkElements.length === 1) {
      // 检查这个选择器是否能在所有选中元素中找到相似结构
      let allHaveSimilarLink = true;

      for (let i = 1; i < newSelectionArray.length; i++) {
        const links = newSelectionArray[i].querySelectorAll('a');
        if (links.length !== 1) {
          allHaveSimilarLink = false;
          break;
        }
      }

      if (allHaveSimilarLink) {
        showAutoDetectLink();
      }
    }
  }

  // 更新剪贴板
  updateClipboard();

  // 更新通知 (统一调用 updateNotification)
  updateNotification(selectedElements.length);
}

// 显示自动检测到链接的提示
function showAutoDetectLink() {
  const notification = document.getElementById('batch-selector-notification');
  if (!notification) return;

  const autoDetectElement = document.createElement('div');
  autoDetectElement.style.marginTop = '10px';
  autoDetectElement.style.padding = '8px';
  autoDetectElement.style.backgroundColor = 'rgba(33, 150, 243, 0.2)';
  autoDetectElement.style.borderRadius = '3px';
  autoDetectElement.style.fontSize = '0.9em';

  autoDetectElement.innerHTML = `
    <div style="margin-bottom: 5px;">${t('tip_internal_links')}</div>
    <div style="font-size: 0.85em; margin-bottom: 8px; color: #ccc;">
      ${t('tip_internal_links_desc')}
    </div>
    <button id="view-inner-links" style="
      padding: 3px 8px;
      background-color: rgba(33, 150, 243, 0.8);
      border: none;
      color: white;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.9em;
    ">${t('btn_view_internal_links')}</button>
  `;

  notification.appendChild(autoDetectElement);

  // 添加按钮事件
  setTimeout(() => {
    const viewButton = document.getElementById('view-inner-links');
    if (viewButton) {
      viewButton.addEventListener('click', function() {
        viewInside();
      });
    }
  }, 0);
}

// =============================================
// UI核心系统 - 管理通知和交互界面
// 集中管理所有UI元素的创建、更新和交互
// =============================================
function getSelectionUIDetent() {
  if (isDetailsPanelOpen) return 'details';
  return isActionBarCompact ? 'compact' : 'actions';
}

function getFloatingBoxViewportBounds(rect) {
  const documentElement = document.documentElement;
  const scrollbarWidth = Math.max(0, window.innerWidth - (documentElement?.clientWidth || window.innerWidth));
  const scrollbarHeight = Math.max(0, window.innerHeight - (documentElement?.clientHeight || window.innerHeight));
  const rightGap = FLOATING_BOX_EDGE_GAP + Math.max(FLOATING_BOX_SCROLLBAR_SAFE_GAP, scrollbarWidth);
  const bottomGap = FLOATING_BOX_EDGE_GAP + Math.max(FLOATING_BOX_SCROLLBAR_SAFE_GAP, scrollbarHeight);
  return {
    minLeft: FLOATING_BOX_EDGE_GAP,
    minTop: FLOATING_BOX_EDGE_GAP,
    maxLeft: Math.max(window.innerWidth - rect.width - rightGap, FLOATING_BOX_EDGE_GAP),
    maxTop: Math.max(window.innerHeight - rect.height - bottomGap, FLOATING_BOX_EDGE_GAP)
  };
}

function applyFloatingBoxPosition(shell) {
  if (!floatingBoxCenter) return;
  const rect = shell.getBoundingClientRect();
  const { minLeft, minTop, maxLeft, maxTop } = getFloatingBoxViewportBounds(rect);
  let left = Math.min(Math.max(floatingBoxCenter.x - rect.width / 2, minLeft), maxLeft);
  let top = Math.min(Math.max(floatingBoxCenter.y - rect.height / 2, minTop), maxTop);

  if (floatingBoxAnchor === 'left' || floatingBoxAnchor === 'right') {
    left = floatingBoxAnchor === 'left' ? minLeft : maxLeft;
    top = Math.min(Math.max(floatingBoxSideTop ?? top, minTop), maxTop);
    floatingBoxSideTop = top;
  } else if (floatingBoxAnchor === 'bottom') {
    top = maxTop;
  } else {
    const anchoredBottom = floatingBoxFreeBottom ?? (top + rect.height);
    top = Math.min(Math.max(anchoredBottom - rect.height, minTop), maxTop);
    floatingBoxFreeBottom = top + rect.height;
  }

  shell.style.left = `${left}px`;
  shell.style.top = `${top}px`;
  shell.style.right = 'auto';
  shell.style.bottom = 'auto';
  shell.style.transform = 'none';
  floatingBoxCenter = { x: left + rect.width / 2, y: top + rect.height / 2 };
}

function cacheCurrentDetentSize(shell) {
  const rect = shell.getBoundingClientRect();
  detentSizeCache[getSelectionUIDetent()] = { width: rect.width, height: rect.height };
}

function playPendingShellMorph(shell) {
  applyFloatingBoxPosition(shell);
  if (!pendingShellMorphRect) {
    cacheCurrentDetentSize(shell);
    isDetailsTransitioning = false;
    return;
  }

  const fromRect = pendingShellMorphRect;
  pendingShellMorphRect = null;
  const toRect = shell.getBoundingClientRect();
  const contentNodes = shell.querySelectorAll(':scope > .batch-selector-details, :scope > .batch-selector-action-bar');
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || typeof shell.animate !== 'function') {
    isDetailsTransitioning = false;
    return;
  }

  const animation = shell.animate([
    {
      width: `${fromRect.width}px`,
      height: `${fromRect.height}px`,
      translate: `${fromRect.left - toRect.left}px ${fromRect.top - toRect.top}px`,
      borderRadius: '16px'
    },
    {
      width: `${toRect.width}px`,
      height: `${toRect.height}px`,
      translate: '0 0',
      borderRadius: '16px'
    }
  ], {
    duration: 320,
    easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
    fill: 'both'
  });
  contentNodes.forEach(node => {
    node.animate([
      { opacity: 0.18, transform: 'scale(0.985)', filter: 'blur(1px)' },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }
    ], {
      duration: 260,
      delay: 35,
      easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
      fill: 'both'
    });
  });
  animation.finished.catch(() => {}).finally(() => {
    animation.cancel();
    cacheCurrentDetentSize(shell);
    isDetailsTransitioning = false;
  });
}

function transitionSelectionUIDetent(targetDetent, shell = document.querySelector('#batch-selector-notification .batch-selector-shell')) {
  if (isDetailsTransitioning || targetDetent === getSelectionUIDetent()) return;
  isDetailsTransitioning = true;
  if (shell) {
    const rect = shell.getBoundingClientRect();
    pendingShellMorphRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    if (!floatingBoxCenter) floatingBoxCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  if (targetDetent === 'actions' || targetDetent === 'compact') {
    preferredCollapsedDetent = targetDetent;
  }
  isDetailsPanelOpen = targetDetent === 'details';
  isActionBarCompact = targetDetent === 'compact';
  if (!isDetailsPanelOpen && isViewingChildren) isViewingChildren = false;
  persistSelectionUIState();
  updateNotification(selectedElements.length);
}

function toggleSelectionUIDetentFromHandle(shell) {
  transitionSelectionUIDetent(
    getHandleTargetDetent(getSelectionUIDetent(), preferredCollapsedDetent),
    shell
  );
}

function toggleCollapsedSelectionUIDetent(shell) {
  transitionSelectionUIDetent(getSummaryTargetDetent(getSelectionUIDetent()), shell);
}

function getNearestFloatingAnchor(rect) {
  return getNearestViewportAnchor(rect, window.innerWidth, window.innerHeight);
}

function snapFloatingBox(shell, movedRect) {
  floatingBoxAnchor = getNearestFloatingAnchor(movedRect) || 'free';
  floatingBoxCenter = { x: movedRect.left + movedRect.width / 2, y: movedRect.top + movedRect.height / 2 };
  floatingBoxSideTop = floatingBoxAnchor === 'left' || floatingBoxAnchor === 'right' ? movedRect.top : null;
  floatingBoxFreeBottom = floatingBoxAnchor === 'free' ? movedRect.bottom : null;
  shell.style.removeProperty('translate');
  applyFloatingBoxPosition(shell);
  persistFloatingBoxPosition();
  const snappedRect = shell.getBoundingClientRect();
  if (typeof shell.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  shell.animate([
    { translate: `${movedRect.left - snappedRect.left}px ${movedRect.top - snappedRect.top}px` },
    { translate: '0 0' }
  ], {
    duration: 280,
    easing: 'cubic-bezier(0.32, 0.72, 0, 1)'
  });
}

function bindFloatingSheetMove(notification, shell) {
  const moveSurface = notification.querySelector('.batch-selector-move-surface');
  if (!moveSurface) return;

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let deltaY = 0;
  let moved = false;
  let frameId = null;
  let baseRect = null;

  const renderDrag = () => {
    frameId = null;
    if (!baseRect) return;
    const { minLeft, minTop, maxLeft, maxTop } = getFloatingBoxViewportBounds(baseRect);
    const targetLeft = Math.min(Math.max(baseRect.left + deltaX, minLeft), maxLeft);
    const targetTop = Math.min(Math.max(baseRect.top + deltaY, minTop), maxTop);
    shell.style.translate = `${targetLeft - baseRect.left}px ${targetTop - baseRect.top}px`;
  };

  const finish = event => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (moveSurface.hasPointerCapture(pointerId)) moveSurface.releasePointerCapture(pointerId);
    pointerId = null;
    if (frameId !== null) cancelAnimationFrame(frameId);
    renderDrag();

    if (moved && event.type !== 'pointercancel') {
      const movedRect = shell.getBoundingClientRect();
      snapFloatingBox(shell, movedRect);
    } else {
      shell.style.removeProperty('translate');
    }
    shell.classList.remove('batch-selector-shell-dragging');

  };

  moveSurface.addEventListener('pointerdown', event => {
    if (event.target.closest('#batch-selector-sheet-grabber')) return;
    if (event.button !== 0 || isDetailsTransitioning) return;
    event.preventDefault();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    deltaX = 0;
    deltaY = 0;
    moved = false;
    baseRect = shell.getBoundingClientRect();
    shell.classList.add('batch-selector-shell-dragging');
    moveSurface.setPointerCapture(pointerId);
  });
  moveSurface.addEventListener('pointermove', event => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    event.preventDefault();
    deltaX = event.clientX - startX;
    deltaY = event.clientY - startY;
    if (Math.hypot(deltaX, deltaY) > 5) moved = true;
    if (frameId === null) frameId = requestAnimationFrame(renderDrag);
  });
  moveSurface.addEventListener('pointerup', finish);
  moveSurface.addEventListener('pointercancel', finish);
}

function getDetentTargetSize(detent) {
  if (detentSizeCache[detent]) return detentSizeCache[detent];
  if (detent === 'compact') return { width: 104, height: 42 };
  if (detent === 'actions') return { width: Math.min(360, window.innerWidth - 16), height: 65 };
  return { width: Math.min(360, window.innerWidth - 16), height: Math.min(520, window.innerHeight - 16) };
}

function bindCompactHoverPosition(shell) {
  if (!shell.classList.contains('batch-selector-shell-compact') || typeof ResizeObserver !== 'function') return;

  let previousHeight = shell.getBoundingClientRect().height;
  let pendingTransitionPositionTimeoutId = null;
  const observer = new ResizeObserver(entries => {
    if (!shell.isConnected) {
      if (pendingTransitionPositionTimeoutId !== null) clearTimeout(pendingTransitionPositionTimeoutId);
      observer.disconnect();
      return;
    }
    const nextHeight = entries[0]?.contentRect?.height ?? shell.getBoundingClientRect().height;
    if (Math.abs(nextHeight - previousHeight) < 0.25) return;
    previousHeight = nextHeight;
    if (!floatingBoxCenter || shell.classList.contains('batch-selector-sheet-pulling')) return;
    if (isDetailsTransitioning) {
      if (pendingTransitionPositionTimeoutId !== null) clearTimeout(pendingTransitionPositionTimeoutId);
      pendingTransitionPositionTimeoutId = setTimeout(() => {
        pendingTransitionPositionTimeoutId = null;
        if (shell.isConnected && shell.matches(':hover')) applyFloatingBoxPosition(shell);
      }, 340);
      return;
    }
    applyFloatingBoxPosition(shell);
  });
  observer.observe(shell);
}

function bindDetentPullHandle(notification, shell) {
  const grabber = notification.querySelector('#batch-selector-sheet-grabber');
  if (!grabber) return;

  const detents = ['compact', 'actions', 'details'];
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let deltaY = 0;
  let baseRect = null;
  let targetDetent = null;
  let progress = 0;
  let frameId = null;
  let renderedWidth = 0;
  let renderedHeight = 0;
  let renderedTranslate = '0 0';
  const pullContents = shell.querySelectorAll(':scope > .batch-selector-details, :scope > .batch-selector-action-bar');

  const pullDistance = 180;
  const commitDistance = 68;
  const expansionDistance = () => -deltaY;

  const clearPullStyles = () => {
    shell.style.removeProperty('width');
    shell.style.removeProperty('height');
    shell.style.removeProperty('translate');
    shell.style.removeProperty('opacity');
    shell.classList.remove('batch-selector-sheet-pulling');
    pullContents.forEach(node => {
      node.style.removeProperty('opacity');
      node.style.removeProperty('transform');
      node.style.removeProperty('filter');
    });
  };

  const renderPull = () => {
    frameId = null;
    if (!baseRect) return;
    const distance = expansionDistance();
    const currentIndex = detents.indexOf(getSelectionUIDetent());
    const direction = distance >= 0 ? 1 : -1;
    const targetIndex = currentIndex + direction;

    if (targetIndex < 0 || targetIndex >= detents.length) {
      targetDetent = null;
      progress = 0;
      const resistance = distance * 0.12;
      renderedTranslate = `0 ${-resistance}px`;
      shell.style.translate = renderedTranslate;
      return;
    }

    targetDetent = detents[targetIndex];
    progress = Math.min(Math.abs(distance) / pullDistance, 1);
    const eased = progress * progress * (3 - 2 * progress);
    const targetSize = getDetentTargetSize(targetDetent);
    renderedWidth = baseRect.width + (targetSize.width - baseRect.width) * eased;
    renderedHeight = baseRect.height + (targetSize.height - baseRect.height) * eased;
    let translateX = (baseRect.width - renderedWidth) / 2;
    let translateY = (baseRect.height - renderedHeight) / 2;
    if (floatingBoxAnchor === 'left') translateX = 0;
    if (floatingBoxAnchor === 'right') translateX = baseRect.width - renderedWidth;
    if (floatingBoxAnchor === 'left' || floatingBoxAnchor === 'right') translateY = 0;
    else translateY = baseRect.height - renderedHeight;
    renderedTranslate = `${translateX}px ${translateY}px`;
    shell.style.width = `${renderedWidth}px`;
    shell.style.height = `${renderedHeight}px`;
    shell.style.translate = renderedTranslate;
    pullContents.forEach(node => {
      node.style.opacity = String(1 - eased * 0.64);
      node.style.transform = `scale(${1 - eased * 0.012})`;
      node.style.filter = `blur(${eased * 0.7}px)`;
    });
  };

  const snapBack = () => {
    if (typeof shell.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      clearPullStyles();
      return;
    }
    const animation = shell.animate([
      { width: `${renderedWidth || baseRect.width}px`, height: `${renderedHeight || baseRect.height}px`, translate: renderedTranslate },
      { width: `${baseRect.width}px`, height: `${baseRect.height}px`, translate: '0 0' }
    ], { duration: 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    pullContents.forEach(node => {
      node.animate([
        { opacity: node.style.opacity || 1, transform: node.style.transform || 'scale(1)', filter: node.style.filter || 'blur(0)' },
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }
      ], { duration: 220, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    });
    animation.finished.catch(() => {}).finally(clearPullStyles);
  };

  const finish = event => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (grabber.hasPointerCapture(pointerId)) grabber.releasePointerCapture(pointerId);
    pointerId = null;
    if (frameId !== null) cancelAnimationFrame(frameId);
    renderPull();
    const moved = Math.hypot(deltaX, deltaY) > 5;

    if (event.type === 'pointercancel') {
      snapBack();
    } else if (!moved) {
      clearPullStyles();
      toggleSelectionUIDetentFromHandle(shell);
    } else if (targetDetent && Math.abs(expansionDistance()) >= commitDistance) {
      transitionSelectionUIDetent(targetDetent, shell);
    } else {
      snapBack();
    }
  };

  grabber.addEventListener('pointerdown', event => {
    if (event.button !== 0 || isDetailsTransitioning) return;
    event.preventDefault();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    deltaX = 0;
    deltaY = 0;
    targetDetent = null;
    progress = 0;
    baseRect = shell.getBoundingClientRect();
    renderedWidth = baseRect.width;
    renderedHeight = baseRect.height;
    renderedTranslate = '0 0';
    shell.classList.add('batch-selector-sheet-pulling');
    grabber.setPointerCapture(pointerId);
  });
  grabber.addEventListener('pointermove', event => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    event.preventDefault();
    deltaX = event.clientX - startX;
    deltaY = event.clientY - startY;
    if (frameId === null) frameId = requestAnimationFrame(renderPull);
  });
  grabber.addEventListener('pointerup', finish);
  grabber.addEventListener('pointercancel', finish);
  grabber.addEventListener('click', event => {
    if (event.detail === 0) toggleSelectionUIDetentFromHandle(shell);
  });
}

const detailsDisclosureTokens = new WeakMap();
const detailsDisclosureBaseOverflow = new WeakMap();

function animateDetailsDisclosure(content, opening, isStillOpen, notification) {
  if (!detailsDisclosureBaseOverflow.has(content)) {
    detailsDisclosureBaseOverflow.set(content, content.style.overflow);
  }

  const currentHeight = content.getBoundingClientRect().height;
  content.getAnimations?.().forEach(animation => animation.cancel());
  const token = {};
  detailsDisclosureTokens.set(content, token);
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || typeof content.animate !== 'function') {
    content.style.display = opening ? 'block' : 'none';
    fitSelectionDetailsWithinViewport(notification, false);
    return;
  }

  if (opening) content.style.display = 'block';
  const expandedHeight = content.scrollHeight;
  const expandedMarginTop = Number.parseFloat(getComputedStyle(content).marginTop) || 0;
  const startHeight = opening ? Math.min(currentHeight, expandedHeight) : currentHeight;
  const endHeight = opening ? expandedHeight : 0;
  content.style.overflow = 'hidden';
  const animation = content.animate([
    {
      height: `${startHeight}px`,
      marginTop: `${opening ? 0 : expandedMarginTop}px`,
      opacity: opening ? 0.72 : 1
    },
    {
      height: `${endHeight}px`,
      marginTop: `${opening ? expandedMarginTop : 0}px`,
      opacity: opening ? 1 : 0.72
    }
  ], {
    duration: 160,
    fill: 'both',
    easing: 'cubic-bezier(0.32, 0.72, 0, 1)'
  });

  let positionFrameId = null;
  const keepPositionAnchored = () => {
    if (detailsDisclosureTokens.get(content) !== token || !content.isConnected) return;
    const shell = notification.querySelector('.batch-selector-shell-open');
    if (shell) applyFloatingBoxPosition(shell);
    positionFrameId = requestAnimationFrame(keepPositionAnchored);
  };
  positionFrameId = requestAnimationFrame(keepPositionAnchored);

  animation.finished.catch(() => {}).finally(() => {
    if (detailsDisclosureTokens.get(content) !== token) return;
    if (positionFrameId !== null) cancelAnimationFrame(positionFrameId);
    animation.cancel();
    content.style.removeProperty('height');
    content.style.removeProperty('opacity');
    content.style.overflow = detailsDisclosureBaseOverflow.get(content) || '';
    content.style.display = isStillOpen() ? 'block' : 'none';
    fitSelectionDetailsWithinViewport(notification, false);
  });
}

function fitSelectionDetailsWithinViewport(notification, animatePosition = true) {
  const shell = notification.querySelector('.batch-selector-shell-open');
  const details = notification.querySelector('.batch-selector-details');
  if (!shell || !details) return;

  const beforeRect = shell.getBoundingClientRect();
  const moveHeight = notification.querySelector('.batch-selector-move-surface')?.getBoundingClientRect().height || 0;
  const actionHeight = notification.querySelector('.batch-selector-action-bar')?.getBoundingClientRect().height || 0;
  details.style.maxHeight = `${Math.max(150, window.innerHeight - moveHeight - actionHeight - 20)}px`;

  requestAnimationFrame(() => {
    applyFloatingBoxPosition(shell);
    const afterRect = shell.getBoundingClientRect();
    if (animatePosition && typeof shell.animate === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      shell.animate([
        { translate: `${beforeRect.left - afterRect.left}px ${beforeRect.top - afterRect.top}px` },
        { translate: '0 0' }
      ], { duration: 200, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    }
    cacheCurrentDetentSize(shell);
  });
}

// 更新通知内容 (合并后的核心函数)
function updateNotification(count) {
  // 移除可能已存在的通知
  const existingNotification = document.getElementById('batch-selector-notification');
  if (existingNotification) {
    document.body.removeChild(existingNotification);
  }

  // 如果没有元素被选中，不显示通知
  if (count === 0) {
    return;
  }

  // 检查当前选中元素是否仍然有效（可能已被删除）
  // 过滤掉已经不在DOM中的元素
  selectedElements = selectedElements.filter(el => document.body.contains(el));

  // 如果过滤后没有元素了，清空选择并返回
  if (selectedElements.length === 0) {
    currentElementTypeKey = '';
    parentChain = [];
    parentChainIndex = 0;
    childrenChain = [];
    // 清除所有层级匹配索引
    matchedLevelIndices = {};
    return;
  }

  count = selectedElements.length;

  // 如果当前元素类型的元素已经不存在，更新当前元素类型
  if (currentElementTypeKey) {
    const typeElements = selectedElements.filter(el => matchesElementType(el, currentElementTypeKey));

    // 如果当前类型的元素已经不存在，使用第一个选中元素的类型
    if (typeElements.length === 0) {
      // 清除当前元素类型的匹配层级索引
      delete matchedLevelIndices[currentElementTypeKey];

      const firstElement = selectedElements[0];
      currentElementTypeKey = getElementTypeKey(firstElement);

      // 更新父元素链
      collectParentChain(firstElement);
    } else if (parentChain.length === 0 || !document.body.contains(parentChain[parentChainIndex])) {
      // 如果父元素链为空或当前层级元素已不在DOM中，使用当前类型的第一个元素更新父元素链
      collectParentChain(typeElements[0]);
    }

    // 检查父元素链中的元素是否仍然有效
    const validParentChain = parentChain.filter(el => document.body.contains(el));

    // 如果父元素链已经变化，更新父元素链
    if (validParentChain.length !== parentChain.length) {
      if (typeElements.length > 0) {
        // 使用当前类型的第一个元素更新父元素链
        collectParentChain(typeElements[0]);
      }
    }
  } else if (selectedElements.length > 0) {
    // 如果没有当前元素类型但有选中元素，使用第一个选中元素的类型
    const firstElement = selectedElements[0];
    currentElementTypeKey = getElementTypeKey(firstElement);

    // 更新父元素链
    collectParentChain(firstElement);
  }

  // 创建新通知
  const notification = document.createElement('div');
  notification.id = 'batch-selector-notification';
  notification.className = 'batch-selector-ui batch-selector-layer';

  const similarShortcut = escapeHtml(typeSelectKeyConfig.keys.map(formatKeyForDisplay).join('+'));
  const copyShortcut = escapeHtml(copyKeyConfig.keys.map(formatKeyForDisplay).join('+'));
  const sheetHandleHTML = `
    <div class="batch-selector-move-surface batch-selector-ui" title="${t('ui_move_box')}">
      <button id="batch-selector-sheet-grabber" class="batch-selector-sheet-grabber batch-selector-ui" type="button" aria-label="${t('ui_drag_to_close')}" title="${t('ui_drag_to_close')}"></button>
    </div>
  `;
  const actionBarHTML = isActionBarCompact
    ? `
      <div class="batch-selector-action-bar batch-selector-action-bar-compact batch-selector-ui" role="toolbar" aria-label="${t('ui_action_bar_label')}">
        <button id="batch-selector-action-mode-toggle" class="batch-selector-action-summary batch-selector-ui" title="${t('ui_btn_toggle_compact')}">
          <span class="batch-selector-action-count">${count}</span>
          <span>${t('ui_selected_short')}</span>
        </button>
      </div>
    `
    : `
      <div class="batch-selector-action-bar batch-selector-ui" role="toolbar" aria-label="${t('ui_action_bar_label')}">
        <button id="batch-selector-action-mode-toggle" class="batch-selector-action-summary batch-selector-ui" title="${t('ui_btn_toggle_compact')}">
          <span class="batch-selector-action-count">${count}</span>
          <span>${t('ui_selected_elements')}</span>
        </button>
        <button id="batch-selector-select-similar" class="batch-selector-ui" title="${t('ui_select_similar_hint', similarShortcut)}" ${isViewingChildren ? 'disabled' : ''}>${t('ui_btn_select_similar')}</button>
        <button id="batch-selector-copy-btn" class="batch-selector-ui batch-selector-primary-action" title="${t('ui_copy_hint', copyShortcut)}">${t('ui_btn_copy')}</button>
        <button id="batch-selector-details-toggle" class="batch-selector-ui" aria-expanded="${isDetailsPanelOpen}">${isDetailsPanelOpen ? t('ui_btn_hide_details') : t('ui_btn_more')}</button>
        <button id="batch-selector-cancel" class="batch-selector-ui batch-selector-danger-action" title="${t('ui_btn_clear')}">✕</button>
      </div>
    `;

  // 设置通知样式
  if (!isDetailsPanelOpen) {
    // =============================
    // 第一层：仅显示底部操作条
    // =============================
    notification.style.position = 'fixed';
    notification.style.inset = '0';
    notification.style.zIndex = '10000';
    notification.innerHTML = `<div class="batch-selector-shell${isActionBarCompact ? ' batch-selector-shell-compact' : ''} batch-selector-ui">${sheetHandleHTML}${actionBarHTML}</div>`;

    // 添加到文档
    document.body.appendChild(notification);
    const collapsedShell = notification.querySelector('.batch-selector-shell');
    if (collapsedShell) {
      bindFloatingSheetMove(notification, collapsedShell);
      bindDetentPullHandle(notification, collapsedShell);
      bindCompactHoverPosition(collapsedShell);
      playPendingShellMorph(collapsedShell);
    }

    // === 第一层操作条事件监听 ===
    notification.addEventListener('click', function(event) {
      if (event.target.closest('#batch-selector-action-mode-toggle')) {
        toggleCollapsedSelectionUIDetent(event.target.closest('.batch-selector-shell'));
      } else if (event.target.closest('#batch-selector-select-similar')) {
        selectAllElements();
      } else if (event.target.closest('#batch-selector-copy-btn')) {
        copySelectionToClipboard();
      } else if (event.target.closest('#batch-selector-details-toggle')) {
        transitionSelectionUIDetent('details', event.target.closest('.batch-selector-shell'));
      } else if (event.target.closest('#batch-selector-cancel')) {
        cancelSelection();
      }
    });
    // 详情关闭时不绑定第二层控件

  } else {
    // =============================
    // 第二层详情面板 UI 渲染
    // =============================
    notification.style.position = 'fixed';
    notification.style.inset = '0';
    notification.style.zIndex = '10000';

    // --- 构建通用部分 ---
    let hierarchyHTML = '';
    if (parentChain.length > 0) {
      // (元素层级HTML生成逻辑 - 从原 updateNotification / updateChildrenNotification 提取并统一)
      hierarchyHTML = `
        <div class="treeclip-ios-disclosure-section">
          <div id="hierarchy-section-header" class="treeclip-ios-section-header batch-selector-ui" role="button" aria-expanded="${isHierarchySectionOpen}">
            <span style="font-size: 0.9em;">${t('ui_hierarchy')}</span>
            <span class="toggle-arrow" aria-hidden="true" style="transform: rotate(${isHierarchySectionOpen ? '90deg' : '0deg'});">›</span>
          </div>
          <div id="hierarchy-section-content" style="display: ${isHierarchySectionOpen ? 'block' : 'none'}; max-width: 100%; margin-top: 8px; overflow: hidden;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
      `;
      const MAX_LEVELS_TO_SHOW = 5;
      const needCollapse = !isHierarchyExpanded && parentChain.length > MAX_LEVELS_TO_SHOW;
      let elementsToShow = [];
      if (needCollapse) {
        const topElements = parentChain.slice(parentChain.length - 2);
        const bottomElements = parentChain.slice(0, 3);
        elementsToShow = [...topElements.reverse(), null, ...bottomElements.reverse()];
      } else {
        elementsToShow = [...parentChain].reverse();
      }

      for (let j = 0; j < elementsToShow.length; j++) {
        const el = elementsToShow[j];
        if (el === null) {
          const collapsedCount = parentChain.length - 5;
          hierarchyHTML += `
            <div style="margin: 8px 0; text-align: center; position: relative;">
              <div style="position: absolute; height: 100%; left: 18px; top: 0; border-left: 1px dashed rgba(180, 180, 180, 0.4); z-index: 0;"></div>
              <div id="toggle-middle-levels" class="batch-selector-ui" role="button" aria-expanded="false" style="display: inline-flex; align-items: center; justify-content: center; padding: 4px 14px; background-color: rgba(255, 255, 255, 0.08); border-radius: 15px; font-size: 0.85em; cursor: pointer; color: #bbb; border: 1px dashed rgba(180, 180, 180, 0.4); gap: 8px; position: relative; margin-left: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: all 0.2s ease; z-index: 1;">
                <span style="font-size: 1.5em; line-height: 1em;">⋮</span>
                <span>${t('ui_omit_levels', collapsedCount)}</span>
                <span style="font-size: 0.9em; opacity: 0.7; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 8px;">${t('ui_click_to_expand')}</span>
          </div>
        </div>
          `; // 注意这里是反引号 `
          continue;
        }
        const i = parentChain.indexOf(el);
        const tag = el.tagName.toLowerCase();
        let desc = tag;
        if (el.id) { desc += `#${el.id}`; }
        else { const mainClass = getElementClassName(el).split(' ')[0]; if (mainClass) { desc += `.${mainClass}`; } }
        const { level, indent } = getAdjustedLevelIndent(j, i, needCollapse, parentChain);
        const visualIndent = Math.min(indent, 92);
        const isCurrentLevel = i === parentChainIndex;
        const isMatchedLevel = matchedLevelIndices[currentElementTypeKey] === i;
        hierarchyHTML += `
          <div style="margin-bottom: 3px;">
            <div style="display: flex; max-width: 100%; min-width: 0; align-items: center;">
              <div style="width: ${visualIndent}px; flex-shrink: 0;"></div>
              ${level > 0 ? '<span style="margin-right: 5px; color: rgba(180, 180, 180, 0.6); font-size: 0.85em;">└─</span>' : ''}
              <span class="level-selector batch-selector-ui" data-level="${i}" data-current="${isCurrentLevel}" data-matched="${isMatchedLevel}" style="display: inline-flex; max-width: calc(100% - ${visualIndent + (level > 0 ? 24 : 0)}px); min-width: 0; overflow: hidden; align-items: center; padding: 3px 8px; background-color: ${isCurrentLevel ? 'rgba(66, 133, 244, 0.8)' : isMatchedLevel ? 'rgba(247, 152, 29, 0.8)' : 'rgba(255, 255, 255, 0.08)'}; border-radius: 4px; font-size: 0.85em; cursor: pointer; ${isCurrentLevel || isMatchedLevel ? 'font-weight: bold;' : ''} transition: all 0.2s ease; box-shadow: ${isCurrentLevel || isMatchedLevel ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 2px rgba(0,0,0,0.1)'}; color: ${isCurrentLevel || isMatchedLevel ? 'white' : '#ddd'}; border: 1px solid ${isCurrentLevel ? 'rgba(66, 133, 244, 0.6)' : isMatchedLevel ? 'rgba(247, 152, 29, 0.6)' : 'transparent'};">
                <span style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(desc)}</span>
                ${isCurrentLevel ? ` <span style="margin-left: 5px; color: #8effb7; font-size: 0.9em; display: inline-flex; align-items: center;"><span style="margin-right: 2px;">✓</span>${t('ui_current')}</span>` : ''}
                ${isMatchedLevel ? ` <span style="margin-left: 5px; color: #ffcc80; font-size: 0.9em; display: inline-flex; align-items: center;"><span style="margin-right: 2px;">⊙</span>${t('ui_match')}</span>` : ''}
                ${i === 0 ? ` <span style="margin-left: 5px; color: #ffcc80; font-size: 0.85em; background: rgba(255,150,30,0.15); padding: 1px 4px; border-radius: 3px;">${t('ui_bottom')}</span>` : ''}
                ${i === parentChain.length - 1 ? ` <span style="margin-left: 5px; color: #ffcc80; font-size: 0.85em; background: rgba(255,150,30,0.15); padding: 1px 4px; border-radius: 3px;">${t('ui_top')}</span>` : ''}
              </span>
            </div>
          </div>
        `; // 注意这里是反引号 `
      }
      if (parentChain.length > MAX_LEVELS_TO_SHOW && isHierarchyExpanded) {
        hierarchyHTML += `
          <div style="margin-top: 8px; text-align: center;">
            <div id="toggle-middle-levels" class="batch-selector-ui" role="button" aria-expanded="true" style="display: inline-flex; align-items: center; justify-content: center; padding: 4px 12px; border-radius: 14px; cursor: pointer; color: #aebbd0; background: rgba(255, 255, 255, 0.06); gap: 7px; font-size: 0.82em;">
              <span aria-hidden="true">⌃</span>
              <span>${t('ui_collapse_middle_levels')}</span>
            </div>
          </div>
        `;
      }
      hierarchyHTML += '</div></div></div>';
    }

    // --- 构建条件部分 ---
    let contentHTML = '';
    let buttonsHTML = '';

    if (isViewingChildren) {
      // =============================
      // 内部查看模式 UI 内容
      // =============================
      let childrenHTML = '';
      if (childrenChain.length > 0) {
        childrenHTML = '<div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">';
        childrenHTML += `<div style="margin-bottom: 8px; font-weight: 650;">${t('ui_internal_elements')}</div>`;
        childrenHTML += '<div class="batch-selector-flow-grid">';
        childrenChain.forEach((el, index) => {
          const tag = el.tagName.toLowerCase();
          let desc = tag;
          if (el.id) { desc += `#${el.id}`; }
          else { const mainClass = getElementClassName(el).split(' ')[0]; if (mainClass) { desc += `.${mainClass}`; } }
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const preview = text.length > 48 ? text.substring(0, 48) + '…' : text;
          const flowWidthClass = preview.length > 34 ? ' batch-selector-flow-wide' : '';
          childrenHTML += `
            <button class="child-selector batch-selector-flow-item${flowWidthClass} batch-selector-ui" data-index="${index}">
              <span class="batch-selector-flow-preview" title="${escapeHtml(text)}">${escapeHtml(preview || t('ui_no_text_preview'))}</span>
              <code class="batch-selector-hierarchy-chip batch-selector-field-hierarchy" title="${escapeHtml(desc)}">${escapeHtml(desc)}</code>
            </button>
          `; // 注意这里是反引号 `
        });
        childrenHTML += '</div></div>';
      }

      contentHTML = `
        <div style="font-size: 16px; font-weight: 700;">${t('ui_viewing_internal')}</div>
        <div style="font-size: 0.9em; margin: 5px 0; text-align: left; color: #aaa;">${t('ui_internal_desc')}</div>
        ${childrenHTML}
        ${hierarchyHTML}
        <div style="font-size: 0.8em; margin-top: 8px; color: #aaa;">${t('ui_shortcut_nav_hint')}</div>
      `; // 注意这里是反引号 `

      buttonsHTML = `
        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <button id="batch-selector-back" class="batch-selector-ui">← ${t('ui_btn_back')}</button>
        </div>
      `; // 注意这里是反引号 `

    } else {
      // =============================
      // 主界面模式 UI 内容
      // =============================
      let selectorInfo = '';
      if (currentSelector) {
        selectorInfo = `<details style="margin-top: 8px; color: #aebbd0; font-size: 0.82em;"><summary style="cursor: pointer;">${t('ui_current_selector')}</summary><code style="display: block; margin-top: 5px; overflow-wrap: anywhere;">${escapeHtml(currentSelector)}</code></details>`;
      }

      let selectedTypesHTML = '';
      if (selectedElements.length > 0) {
        const elementTypes = {};
        selectedElements.forEach(el => {
          const tagName = el.tagName.toLowerCase(); const className = getElementClassName(el); const key = getElementTypeKey(el);
          if (!elementTypes[key]) { elementTypes[key] = { count: 0, tagName: tagName, className: className }; }
          elementTypes[key].count++;
        });
      const typeKeys = Object.keys(elementTypes);
      if (typeKeys.length > 0) {
          selectedTypesHTML = `<div class="treeclip-selected-groups"><div class="treeclip-groups-label">${t('ui_groups_title')}</div><div class="batch-selector-flow-grid">`;
          for (const key of typeKeys) {
            const typeInfo = elementTypes[key]; let typeName = typeInfo.tagName;
            if (typeInfo.className) { const displayClassName = typeInfo.className.length > 15 ? typeInfo.className.substring(0, 15) + '...' : typeInfo.className; typeName += `.${displayClassName}`; }
            const isCurrentType = currentElementTypeKey === key;
            selectedTypesHTML += `
              <button class="element-type-selector batch-selector-flow-item batch-selector-ui" data-type="${escapeHtml(key)}" style="border-color: ${isCurrentType ? '#4ade80' : 'rgba(255,255,255,0.14)'}; background: ${isCurrentType ? 'rgba(34,197,94,0.16)' : 'rgba(255,255,255,0.06)'};">
                <code class="batch-selector-hierarchy-chip batch-selector-group-hierarchy" title="${escapeHtml(typeName)}">${escapeHtml(typeName)}</code>
                <strong class="batch-selector-group-count" style="color: ${isCurrentType ? '#86efac' : '#cbd5e1'};">${typeInfo.count}</strong>
              </button>
            `;
        }
        selectedTypesHTML += '</div>';
        selectedTypesHTML += `<div style="margin-top: 6px; color: #93a4bc; font-size: 0.78em;">${t('ui_group_hint')}</div>`;
        selectedTypesHTML += '</div>';
      }
    }

    // 定义"输出格式"区块，包含折叠功能和原内容
    const outputFormatHTML = `
      <div class="treeclip-ios-disclosure-section">
        <div id="output-format-header" class="treeclip-ios-section-header batch-selector-ui" role="button" aria-expanded="${isOutputFormatExpanded}">
          <span style="font-size: 0.9em;">${t('ui_output_settings')}</span>
          <span class="toggle-arrow" aria-hidden="true" style="transform: rotate(${isOutputFormatExpanded ? '90deg' : '0deg'});">›</span>
        </div>
        <div id="output-format-content" style="display: ${isOutputFormatExpanded ? 'block' : 'none'};">
          <div class="treeclip-ios-settings-card">
            <div class="treeclip-ios-settings-label">${t('ui_clipboard_sep')}</div>
            <div class="treeclip-ios-segmented">
              <label><input type="radio" name="clipboardFormat" value="newline" ${clipboardFormat === 'newline' ? 'checked' : ''}><span>${t('ui_sep_newline')}</span></label>
              <label><input type="radio" name="clipboardFormat" value="space" ${clipboardFormat === 'space' ? 'checked' : ''}><span>${t('ui_sep_space')}</span></label>
              <label><input type="radio" name="clipboardFormat" value="comma" ${clipboardFormat === 'comma' ? 'checked' : ''}><span>${t('ui_sep_comma')}</span></label>
            </div>
            <div class="treeclip-ios-settings-label">${t('ui_clean_options')}</div>
            <div class="treeclip-ios-clean-grid">
              <label><input type="checkbox" id="removeInternalSpaces" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeInternalSpaces ? 'checked' : ''}><span class="treeclip-ios-clean-chip">${t('ui_clean_spaces')}</span></label>
              <label><input type="checkbox" id="removeCodePatterns" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeCodePatterns ? 'checked' : ''}><span class="treeclip-ios-clean-chip">${t('ui_clean_code')}</span></label>
              <label><input type="checkbox" id="removeSymbols" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeSymbols ? 'checked' : ''}><span class="treeclip-ios-clean-chip">${t('ui_clean_symbols')}</span></label>
              <label><input type="checkbox" id="removeEnglish" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeEnglish ? 'checked' : ''}><span class="treeclip-ios-clean-chip">${t('ui_clean_english')}</span></label>
              <label><input type="checkbox" id="removeChinese" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeChinese ? 'checked' : ''}><span class="treeclip-ios-clean-chip">${t('ui_clean_chinese')}</span></label>
              <label><input type="checkbox" id="removeNumbers" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeNumbers ? 'checked' : ''}><span class="treeclip-ios-clean-chip">${t('ui_clean_numbers')}</span></label>
            </div>
          </div>
          <div class="treeclip-ios-settings-card treeclip-ios-behavior-card">
            <div class="treeclip-ios-settings-label">${t('ui_copy_behavior')}</div>
            <label class="treeclip-ios-setting-row"><span>${t('ui_clean_duplicates')}</span><input type="checkbox" id="removeDuplicates" class="batch-selector-ui batch-selector-cleanup-checkbox treeclip-ios-switch-input" ${removeDuplicates ? 'checked' : ''}><span class="treeclip-ios-switch" aria-hidden="true"></span></label>
            <label class="treeclip-ios-setting-row">
              <span class="treeclip-ios-setting-copy"><span>${t('ui_realtime_copy')}</span><small>${t('ui_realtime_copy_desc')}</small></span>
              <input type="checkbox" id="realtimeCopyEnabled" class="batch-selector-ui treeclip-ios-switch-input" ${isRealtimeCopyEnabled ? 'checked' : ''}>
              <span class="treeclip-ios-switch" aria-hidden="true"></span>
            </label>
          </div>
        </div>
      </div>
    `;

      // 详情面板承载选择分组、文本边界和输出设置。
      contentHTML = `
        <div>
          <div class="treeclip-details-title">${t('ui_details_title')}</div>
        </div>
        ${selectedTypesHTML}
        ${selectorInfo}
        ${hierarchyHTML}
        ${outputFormatHTML}
      `; // 注意这里是反引号 `

      // 详情面板底部只保留低频工具。
      const hasChildren = childrenChain && childrenChain.length > 0;
      const insideButtonStyle = hasChildren
          ? 'border-color: rgba(74, 222, 128, 0.5); color: #dcfce7; background: rgba(34, 197, 94, 0.14);'
          : 'opacity: 0.45; cursor: not-allowed;';
      buttonsHTML = `
      <div style="display: flex; gap: 8px; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 10px;">
        <button id="batch-selector-inside" class="batch-selector-ui" style="${insideButtonStyle}" ${hasChildren ? '' : 'disabled'}>${t('ui_btn_internal')}</button>
        <button id="batch-selector-key-config-btn" class="batch-selector-ui">${t('ui_btn_shortcuts')}</button>
      </div>
      `;
    }

    // --- 组装完整UI ---
    notification.innerHTML = `
      <div class="batch-selector-shell batch-selector-shell-open batch-selector-ui">
        ${sheetHandleHTML}
        <aside class="batch-selector-details batch-selector-ui" aria-label="${t('ui_details_title')}">
          ${contentHTML}
          ${buttonsHTML}
        </aside>
        ${actionBarHTML}
      </div>
    `; // 注意这里是反引号 `

  // 添加到文档
  document.body.appendChild(notification);

    const detailsShell = notification.querySelector('.batch-selector-shell-open');
    if (detailsShell) {
      bindFloatingSheetMove(notification, detailsShell);
      bindDetentPullHandle(notification, detailsShell);
      playPendingShellMorph(detailsShell);
    }

    // =============================
    // 统一事件监听器绑定
    // =============================
    setTimeout(() => {
      // --- 通用监听器 ---
      addLevelSelectorsClickEvents(notification);
      addHierarchyLevelsToggleEvents(notification);

      // --- 添加事件委托处理展开/折叠 ---
      notification.addEventListener('click', function(event) {
        const target = event.target;

        const actionModeToggle = target.closest('#batch-selector-action-mode-toggle');
        if (actionModeToggle) {
          toggleCollapsedSelectionUIDetent(actionModeToggle.closest('.batch-selector-shell'));
          return;
        }

        // 处理输出格式展开/折叠
        const outputFormatHeader = target.closest('#output-format-header');
        if (outputFormatHeader) {
          const outputFormatContent = notification.querySelector('#output-format-content'); // 从 notification 内部查找
          if (outputFormatContent) {
            isOutputFormatExpanded = !isOutputFormatExpanded;
            try { chrome.storage.local.set({ [OUTPUT_SECTION_OPEN_STORAGE_KEY]: isOutputFormatExpanded }); } catch (e) { /* 保留当前会话状态。 */ }
            outputFormatHeader.setAttribute('aria-expanded', String(isOutputFormatExpanded));
            animateDetailsDisclosure(
              outputFormatContent,
              isOutputFormatExpanded,
              () => isOutputFormatExpanded,
              notification
            );
            const arrow = outputFormatHeader.querySelector('.toggle-arrow');
            if (arrow) arrow.style.transform = `rotate(${isOutputFormatExpanded ? '90deg' : '0deg'})`;
          }
        }

        // 像输出设置一样展开或关闭整个“文本所在层级”区块。
        const hierarchyHeader = target.closest('#hierarchy-section-header');
        if (hierarchyHeader) {
          event.stopPropagation();
          event.preventDefault();
          const hierarchyContent = notification.querySelector('#hierarchy-section-content');
          isHierarchySectionOpen = !isHierarchySectionOpen;
          try { chrome.storage.local.set({ [HIERARCHY_SECTION_OPEN_STORAGE_KEY]: isHierarchySectionOpen }); } catch (e) { /* 保留当前会话状态。 */ }
          hierarchyHeader.setAttribute('aria-expanded', String(isHierarchySectionOpen));
          if (hierarchyContent) {
            animateDetailsDisclosure(
              hierarchyContent,
              isHierarchySectionOpen,
              () => isHierarchySectionOpen,
              notification
            );
          }
          const arrow = hierarchyHeader.querySelector('.toggle-arrow');
          if (arrow) arrow.style.transform = `rotate(${isHierarchySectionOpen ? '90deg' : '0deg'})`;
        }

         // 显示或收起第二层详情面板
         const detailsToggle = target.closest('#batch-selector-details-toggle');
         if (detailsToggle) {
           transitionSelectionUIDetent(preferredCollapsedDetent, detailsToggle.closest('.batch-selector-shell'));
         }

         // 处理取消按钮
         const cancelButton = target.closest('#batch-selector-cancel');
         if (cancelButton) {
           cancelSelection();
         }

         // --- 其他按钮的点击事件处理 ---
         // 注意: 需要根据按钮的 ID 或 class 来区分并执行相应操作
         // 例如: viewInside, returnToParentView, selectChildElement 等原有的独立按钮事件需要移入或调整

         // 处理“块内字段”按钮
         const insideButton = target.closest('#batch-selector-inside');
         if (insideButton && !isViewingChildren) { // 仅在主界面模式下响应
             viewInside();
         }

         // 处理 "快捷键" 按钮
         const keyConfigButton = target.closest('#batch-selector-key-config-btn');
         if (keyConfigButton && !isViewingChildren) { // 仅在主界面模式下响应
             // 如果配置面板已经显示，则关闭它
             if (isShowingKeyConfig) {
                 hideKeyConfigPanel();
             } else {
                 // 否则显示配置面板
                 showKeyConfigPanel();
             }
         }

         // 处理 "返回" 按钮 (内部查看模式)
         const backButton = target.closest('#batch-selector-back');
         if (backButton && isViewingChildren) { // 仅在内部查看模式下响应
             returnToParentView();
         }

         // 处理子元素选择 (内部查看模式)
         const childSelector = target.closest('.child-selector');
         if (childSelector && isViewingChildren) { // 仅在内部查看模式下响应
             const index = parseInt(childSelector.getAttribute('data-index'));
             selectChildElement(index);
         }

         // 处理元素类型切换 (主界面模式)
         const typeSelector = target.closest('.element-type-selector');
         if (typeSelector && !isViewingChildren) { // 仅在主界面模式下响应
             const typeKey = typeSelector.getAttribute('data-type');

             // 检查是否按住Shift键（同时检查原生shift键和自定义选择键）
             if (event.shiftKey || isShiftPressed) {
                 // Shift+点击元素类型选择器，取消选择该类型的所有元素
                 cancelElementTypeSelection(typeKey);

                 // 阻止事件冒泡，确保不会触发其他处理
                 event.stopPropagation();
             } else {
                 // 普通点击，切换到该类型
                 switchToElementType(typeKey);
             }
         }

         // 第一层直接扩展同结构文本。
         const selectSimilarButton = target.closest('#batch-selector-select-similar');
         if (selectSimilarButton && !isViewingChildren) {
           selectAllElements();
         }

         // 新增：处理复制按钮点击
         const copyButton = target.closest('#batch-selector-copy-btn');
         if (copyButton && !isViewingChildren) { // 仅在主界面模式下响应
            copySelectionToClipboard();
         }

      });
      // --- 事件委托结束 ---

      // --- 移除取消按钮的旧处理 (已移入事件委托) ---
      /*
      const cancelButton = document.getElementById('batch-selector-cancel');
      if (cancelButton) {
        cancelButton.addEventListener('click', function() { cancelSelection(); });
      }
      */

      // --- 条件监听器 ---
      // --- 大部分按钮的监听器已移入事件委托 ---

      // --- 保留需要直接操作 input/checkbox 的监听器 ---

      // 剪贴板格式 Radio 按钮 (需要特殊处理以更新选中状态和样式)
      const formatRadios = notification.querySelectorAll('input[name="clipboardFormat"]');
      formatRadios.forEach(radio => {
        // Change 事件处理状态更新和后台存储
        radio.addEventListener('change', function() {
          if (this.checked) {
            const newlySelectedFormat = this.value;
            clipboardFormat = newlySelectedFormat;
            try { chrome.storage.local.set({'batch-selector-clipboard-format': clipboardFormat}); } catch (e) { /* console.error('无法保存设置:', e); */ }
            updateClipboard(); // 更新剪贴板

          }
        });
      });

      // 文本清理 Checkbox (保持不变)
      const cleanupCheckboxes = notification.querySelectorAll('.batch-selector-cleanup-checkbox');
      cleanupCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
          const option = this.id;
          const isChecked = this.checked;
          let settingKey = '';

          switch (option) {
            case 'removeInternalSpaces': removeInternalSpaces = isChecked; settingKey = 'batch-selector-remove-internal'; break;
            case 'removeCodePatterns': removeCodePatterns = isChecked; settingKey = 'batch-selector-remove-code'; break;
            case 'removeSymbols': removeSymbols = isChecked; settingKey = 'batch-selector-remove-symbols'; break;
            case 'removeEnglish': removeEnglish = isChecked; settingKey = 'batch-selector-remove-english'; break;
            case 'removeChinese': removeChinese = isChecked; settingKey = 'batch-selector-remove-chinese'; break;
            case 'removeNumbers': removeNumbers = isChecked; settingKey = 'batch-selector-remove-numbers'; break;
            case 'removeDuplicates': removeDuplicates = isChecked; settingKey = 'batch-selector-remove-duplicates'; break;
          }
          if (settingKey) { try { chrome.storage.local.set({ [settingKey]: isChecked }); } catch (e) { /* console.error('无法保存设置:', e); */ } }
          updateClipboard(); // 更新剪贴板
        });
      });

      // --- 移除已移入事件委托的按钮监听器 ---
      /*
      if (isViewingChildren) {
        // ... 内部查看模式监听器 ...
        const childSelectors = notification.querySelectorAll('.child-selector');
        childSelectors.forEach(selector => { ... }); // 移入委托
        const backButton = document.getElementById('batch-selector-back');
        if (backButton) { ... } // 移入委托
      } else {
        // ... 主界面模式监听器 ...
        const typeSelectors = notification.querySelectorAll('.element-type-selector');
        typeSelectors.forEach(selector => { ... }); // 移入委托
        // ... formatRadios ... (保留)
        // ... cleanupCheckboxes ... (保留)
        const insideButton = document.getElementById('batch-selector-inside');
        if (insideButton) { ... } // 移入委托
      }
      */

      // 新增：实时复制 Checkbox
      const realtimeCopyCheckbox = notification.querySelector('#realtimeCopyEnabled');
      if (realtimeCopyCheckbox) {
        realtimeCopyCheckbox.addEventListener('change', function() {
          isRealtimeCopyEnabled = this.checked;
          try {
            chrome.storage.local.set({'batch-selector-realtime-copy': isRealtimeCopyEnabled});
          } catch (e) {
            /* console.error('无法保存实时复制设置:', e); */
          }
          // 如果开启了实时复制，立即更新一次剪贴板
          if (isRealtimeCopyEnabled) {
            updateClipboard();
          }
        });
      }

    }, 0); // End of setTimeout
  } // End of else (完整状态)

  // console.log(`Rendering UI: removeSpaces=${removeSpaces}, removeCodePatterns=${removeCodePatterns}`);
}

// =============================================
// 元素类型切换系统 - 在不同类型的选中元素间切换
// =============================================
// 取消选择指定类型的所有元素
function cancelElementTypeSelection(typeKey) {
  // 找出所有匹配该类型的元素
  const typeElements = selectedElements.filter(el => matchesElementType(el, typeKey));

  // 如果没有找到匹配的元素，直接返回
  if (typeElements.length === 0) {
    return;
  }

  // 清除所有匹配元素的高亮
  typeElements.forEach(el => {
    unmarkElementSelected(el);
  });

  // 从选中列表中移除该类型的所有元素
  selectedElements = selectedElements.filter(el => !matchesElementType(el, typeKey));

  // 如果当前选中的元素类型是被取消的类型，重置当前元素类型
  if (currentElementTypeKey === typeKey) {
    // 如果还有其他类型的元素被选中，设置为第一个元素的类型
    if (selectedElements.length > 0) {
      const firstElement = selectedElements[0];
      currentElementTypeKey = getElementTypeKey(firstElement);

      // 更新父元素链，确保层级UI正确显示
      collectParentChain(firstElement);
    } else {
      // 如果没有其他元素被选中，重置当前元素类型和父元素链
      currentElementTypeKey = '';
      parentChain = [];
      parentChainIndex = 0;
      childrenChain = [];

      // 清除所有层级匹配索引
      matchedLevelIndices = {};
    }
  }

  // 更新UI
  updateNotification(selectedElements.length);

  // 更新剪贴板
  updateClipboard();
}

// 切换到指定类型的元素并显示其层级
function switchToElementType(typeKey) {
  // 查找第一个匹配的元素
  const targetElement = selectedElements.find(el => matchesElementType(el, typeKey)) || null;

  if (!targetElement) {
    return; // 未找到匹配元素
  }

  // 更新当前选中的元素类型
  currentElementTypeKey = typeKey;

  // 重置字段视图状态，确保可以重新查看块内字段
  isViewingChildren = false;

  // 更新父元素链并重置索引
  collectParentChain(targetElement);

  // 高亮显示该元素的层级，但不重新选择元素
  updateNotification(selectedElements.length);

  // 更新剪贴板
  updateClipboard();
}

// =============================================
// 层级导航功能 - 在元素层级间上下移动
// =============================================
// 切换到指定的层级索引
function switchToLevel(index) {
  if (index < 0 || index >= parentChain.length) {
    return;
  }

  // 更新当前索引
  parentChainIndex = index;

  // 获取当前层级的元素
  const currentElement = parentChain[parentChainIndex];

  // 如果当前正在查看某个特定元素类型，仅影响该类型的层级视图
  if (currentElementTypeKey) {
    // 先移除旧的高亮
    selectedElements.forEach(el => {
      if (matchesElementType(el, currentElementTypeKey)) {
        unmarkElementSelected(el);
      }
    });

    // 存储当前选中的所有同类型元素
    const currentTypeElements = selectedElements.filter(el => matchesElementType(el, currentElementTypeKey));

    // 从选中列表中移除当前类型的元素
    selectedElements = selectedElements.filter(el => !matchesElementType(el, currentElementTypeKey));

    // 收集要添加的新元素
    const newElements = [];

    // 为每一个当前类型的元素查找对应层级的目标元素
    currentTypeElements.forEach(element => {
      // 收集元素的父元素链
      const elementParentChain = [];
      let current = element;

      while (current && current !== document.body) {
        elementParentChain.push(current);
        current = current.parentElement;
      }

      // 添加body作为最顶层
      if (current === document.body) {
        elementParentChain.push(current);
      }

      // 如果父元素链足够长，找到对应层级的元素
      const targetIndex = elementParentChain.length - 1 - (parentChain.length - 1 - index);
      if (targetIndex >= 0 && targetIndex < elementParentChain.length) {
        const targetElement = elementParentChain[targetIndex];
        // 如果目标元素未在新元素列表中，添加它
        if (!newElements.includes(targetElement)) {
          newElements.push(targetElement);
        }
      }
    });

    // 添加新元素到选中列表并高亮
    newElements.forEach(el => {
      markElementSelected(el);
      selectedElements.push(el);
    });

    // 如果有新元素，更新当前元素类型
    if (newElements.length > 0) {
      const firstElement = newElements[0];
      currentElementTypeKey = getElementTypeKey(firstElement);

      // 重置子元素链
      collectChildrenChain(firstElement);
    } else {
      // 如果没有找到新元素，保持原样但更新UI
      markElementSelected(currentElement);
      selectedElements.push(currentElement);
      currentElementTypeKey = getElementTypeKey(currentElement);

      // 重置子元素链
      collectChildrenChain(currentElement);
    }

    // 更新通知
    updateNotification(selectedElements.length);

    // 更新剪贴板
    updateClipboard();

    return;
  }

  // 没有特定查看的元素类型时
  // 清除当前选择
  selectedElements.forEach(el => {
    if (el && el.style) {
      unmarkElementSelected(el);
    }
  });

  // 高亮当前层级的元素
  markElementSelected(currentElement);

  // 更新选中元素列表，只包含当前元素
  selectedElements = [currentElement];

  // 更新当前元素类型
  currentElementTypeKey = getElementTypeKey(currentElement);

  // 更新通知
  updateNotification(selectedElements.length);

  // 更新剪贴板
  updateClipboard();

  // 重新收集子元素链
  collectChildrenChain(currentElement);
}

// 向上移动选择器（选择父元素）
function moveUp() {
  if (parentChain.length === 0 || parentChainIndex >= parentChain.length - 1) {
    // 已经到达最顶层
    return;
  }

  // 移动到上一级
  parentChainIndex++;

  // 切换到新层级
  switchToLevel(parentChainIndex);
}

// 向下移动选择器（选择更具体的元素）
function moveDown() {
  if (parentChain.length === 0 || parentChainIndex <= 0) {
    // 已经到达最底层
    return;
  }

  // 移动到下一级
  parentChainIndex--;

  // 切换到新层级
  switchToLevel(parentChainIndex);
}

// =============================================
// 元素信息生成 - 创建元素的文本描述
// =============================================
// 为元素生成选择器
function generateSelectorForElement(element) {
  let selector = element.tagName.toLowerCase();

  // 添加ID（如果有）
  if (element.id) {
    return `${selector}#${element.id}`;
  }

  // 添加类名（如果有）
  const className = getElementClassName(element);
  if (className) {
    const classes = className.split(' ');
    classes.forEach(cls => {
      if (cls.trim()) {
        selector += `.${cls.trim()}`;
      }
    });
  }

  return selector;
}

// =============================================
// 临时消息系统 - 显示操作反馈和提示
// =============================================
// 显示临时消息
function showTemporaryMessage(message) {
  const notification = document.getElementById('batch-selector-notification');
  if (!notification) return;

  const messageElement = document.createElement('div');
  messageElement.style.padding = '5px 10px';
  messageElement.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
  messageElement.style.borderRadius = '3px';
  messageElement.style.marginTop = '10px';
  messageElement.style.color = '#fff';
  messageElement.style.fontSize = '0.9em';
  messageElement.textContent = message;

  notification.appendChild(messageElement);

  setTimeout(() => {
    if (notification.contains(messageElement)) {
      notification.removeChild(messageElement);
    }
  }, 3000);
}

// 显示一个全局临时消息
function showTemporaryGlobalMessage(message, duration) {
  const msgElement = document.createElement('div');
  msgElement.id = 'batch-selector-global-msg';
  msgElement.textContent = message;
  msgElement.className = 'batch-selector-ui treeclip-floating-surface treeclip-global-toast';

  // 阻止默认点击行为
  msgElement.addEventListener('mousedown', function(e) {
    if (isShiftPressed) {
      e.stopPropagation();
    }
  }, true);

  msgElement.addEventListener('click', function(e) {
    if (isShiftPressed) {
      e.stopPropagation();
    }
  }, true);

  // 如果已有消息，先移除
  const existingMsg = document.getElementById('batch-selector-global-msg');
  if (existingMsg) {
    document.body.removeChild(existingMsg);
  }

  document.body.appendChild(msgElement);

  // 设置淡出动画
  setTimeout(() => {
    msgElement.style.transition = 'opacity 0.5s ease-out';
    msgElement.style.opacity = '0';

    setTimeout(() => {
      if (document.body.contains(msgElement)) {
        document.body.removeChild(msgElement);
      }
    }, 500);
  }, duration - 500);
}

// =============================================
// 选择状态管理 - 重置和取消选择状态
// =============================================
// 取消选择，移除所有高亮和通知
function cancelSelection() {
  // 只清除 TreeClip 添加的高亮类，不修改宿主页面原有的 outline。
  clearSelectionHighlights();

  // 移除通知
  const notification = document.getElementById('batch-selector-notification');
  if (notification) {
    document.body.removeChild(notification);
  }

  const infoNotification = document.getElementById('batch-selector-info');
  if (infoNotification) {
    document.body.removeChild(infoNotification);
  }

  if (typePromptTimeoutId !== null) {
    clearTimeout(typePromptTimeoutId);
    typePromptTimeoutId = null;
  }
  document.getElementById('batch-selector-prompt')?.remove();

  if (copyFeedbackTimeoutId !== null) {
    clearTimeout(copyFeedbackTimeoutId);
    copyFeedbackTimeoutId = null;
  }

  // 重置所有状态
  selectedElements = [];
  currentSelector = '';
  parentChain = [];
  parentChainIndex = 0;
  childrenChain = [];
  isViewingChildren = false;
  currentElementTypeKey = '';
  pendingShellMorphRect = null;
  Object.keys(detentSizeCache).forEach(key => { delete detentSizeCache[key]; });
  isDetailsTransitioning = false;

}

// =============================================
// 剪贴板管理系统 - 处理选中内容的复制和格式化
// =============================================
// 更新剪贴板内容函数
function updateClipboard({ write = isRealtimeCopyEnabled } = {}) {
  if (selectedElements.length === 0) {
    return ''; // 没有选中元素时保留用户现有剪贴板内容
  }

  // 检查当前选中元素是否仍然有效（可能已被删除）
  // 过滤掉已经不在DOM中的元素
  const validElements = selectedElements.filter(el => document.body.contains(el));

  // 如果有无效元素，更新selectedElements并可能更新UI
  if (validElements.length !== selectedElements.length) {
    selectedElements = validElements;

    // 如果过滤后没有元素了，清空选择并返回
    if (selectedElements.length === 0) {
      currentElementTypeKey = '';
      parentChain = [];
      parentChainIndex = 0;
      childrenChain = [];
      return '';
    }
  }

  // 在处理前过滤掉所有属于UI自身的元素
  const elementsToCopy = selectedElements.filter(el =>
    !el.closest('.batch-selector-ui') &&
    el.id !== 'batch-selector-box' && // 明确排除选择框本身
    el.id !== 'batch-selector-notification' &&
    el.id !== 'batch-selector-info' &&
    el.id !== 'batch-selector-prompt' &&
    el.id !== 'batch-selector-global-msg'
    // 可以根据需要添加更多要排除的特定ID
  );

  // 如果过滤后没有元素了，也直接返回
  if (elementsToCopy.length === 0) {
      return '';
  }

  const collectedText = formatSelectedTexts(
    elementsToCopy.map(element => element.textContent || ''),
    {
      clipboardFormat,
      removeCodePatterns,
      removeSymbols,
      removeEnglish,
      removeChinese,
      removeNumbers,
      removeInternalSpaces,
      removeDuplicates
    }
  );

  // 仅在启用实时复制时才写入剪贴板
  if (write) {
    navigator.clipboard.writeText(collectedText)
      // .then(() => console.log('已更新剪贴板内容'))
      .catch(err => { /* console.error('更新剪贴板失败: ', err); */ });
  }

  return collectedText; // 总是返回处理后的文本
}

async function copySelectionToClipboard() {
  const hasVisibleCopyButton = playCopyButtonFeedback();
  const textToCopy = updateClipboard({ write: false });
  if (!textToCopy) {
    if (!hasVisibleCopyButton) showTemporaryMessage(t('msg_no_content'));
    return;
  }

  try {
    await navigator.clipboard.writeText(textToCopy);
    if (!hasVisibleCopyButton) showTemporaryMessage(t('msg_copied'));
  } catch {
    if (!hasVisibleCopyButton) showTemporaryMessage(t('msg_copy_failed'));
  }
}

function playCopyButtonFeedback() {
  const button = document.getElementById('batch-selector-copy-btn');
  if (!button) return false;

  if (copyFeedbackTimeoutId !== null) {
    clearTimeout(copyFeedbackTimeoutId);
    copyFeedbackTimeoutId = null;
  }

  button.classList.remove('batch-selector-copy-feedback');
  void button.offsetWidth;
  button.classList.add('batch-selector-copy-feedback');
  copyFeedbackTimeoutId = setTimeout(() => {
    if (button.isConnected) button.classList.remove('batch-selector-copy-feedback');
    copyFeedbackTimeoutId = null;
  }, 200);

  return true;
}

// =============================================
// 层级匹配系统 - 基于元素层级关系进行精确匹配
// =============================================
// 添加一个新函数，根据元素层级进行精确匹配
function selectByHierarchy(levelIndex) {
  if (parentChain.length === 0 || levelIndex < 0 || levelIndex >= parentChain.length) {
    return;
  }

  // 检查是否尝试绑定高层级（低索引）到低层级（高索引）
  if (levelIndex < parentChainIndex) {
    // 显示无法绑定的提示，但不中断操作
    showTemporaryMessage(t('msg_invalid_hierarchy_binding'));
    return;
  }

  // 获取当前元素类型
  const currentElement = parentChain[parentChainIndex];
  const currentTypeKey = getElementTypeKey(currentElement);

  // 获取目标层级元素
  const targetElement = parentChain[levelIndex];
  const targetTypeKey = getElementTypeKey(targetElement);

  // 寻找页面上所有符合当前元素类型的元素
  const potentialElements = getElementsByTypeKey(currentTypeKey);
  const matchedElements = [];

  // 对每个潜在元素检查其层级
  for (const element of potentialElements) {
    // 收集元素的父元素链
    const elementChain = [];
    let current = element;

    while (current && current !== document.body) {
      elementChain.unshift(current); // 从上到下添加
      current = current.parentElement;
    }

    // 添加body作为最顶层
    if (current === document.body) {
      elementChain.unshift(current);
    }

    // 检查是否存在目标层级匹配
    let hasMatchingHierarchy = false;

    // 遍历元素链，查找是否有匹配的目标层级
    for (let i = 0; i < elementChain.length; i++) {
      const hierarchyElement = elementChain[i];

      if (matchesElementType(hierarchyElement, targetTypeKey)) {
        // 如果找到匹配的目标层级，检查相对位置关系是否与参考链一致
        if (i < elementChain.length - 1 &&
            matchesElementType(elementChain[elementChain.length - 1], currentTypeKey)) {
          hasMatchingHierarchy = true;
          break;
        }
      }
    }

    // 如果找到了匹配的层级关系，添加到结果中
    if (hasMatchingHierarchy) {
      matchedElements.push(element);
    }
  }

  // 检查是否是当前层级
  const isCurrentLevel = levelIndex === parentChainIndex;

  // 只有在不是当前层级时，才清除当前元素类型的高亮
  if (currentElementTypeKey && !isCurrentLevel) {
    selectedElements.forEach(el => {
      if (matchesElementType(el, currentElementTypeKey)) {
        unmarkElementSelected(el);
      }
    });

    // 从选中列表中移除当前类型的元素
    selectedElements = selectedElements.filter(el => !matchesElementType(el, currentElementTypeKey));
  }

  // 如果是当前层级，只添加新的匹配元素
  if (isCurrentLevel) {
    // 检查这些元素是否已经在选中列表中
    const newElements = matchedElements.filter(el => !selectedElements.includes(el));

    // 高亮新的匹配元素并添加到选中列表
    newElements.forEach(el => {
      markElementSelected(el);
      selectedElements.push(el);
    });
  } else {
    // 不是当前层级，添加所有匹配元素
    matchedElements.forEach(el => {
      markElementSelected(el);
      selectedElements.push(el);
    });
  }

  // 更新当前元素类型
  currentElementTypeKey = getElementTypeKey(currentElement);

  // 存储匹配的层级索引，用于高亮显示
  // 使用元素类型关联的匹配层级索引
  matchedLevelIndices[currentElementTypeKey] = levelIndex;

  // 更新UI
  updateNotification(selectedElements.length);

  // 更新剪贴板
  updateClipboard();
}

// 添加层级选择器的点击事件
function addLevelSelectorsClickEvents(notification) {
  const levelSelectors = notification.querySelectorAll('.level-selector');
  levelSelectors.forEach(selector => {
    // 添加点击事件
    selector.addEventListener('click', function(event) {

      // 检查是否按住Shift键（固定使用Shift键）
      if (event.shiftKey) {
        // 获取点击的层级索引
        const level = parseInt(this.getAttribute('data-level'));

        // 防止冒泡，避免被UI点击保护逻辑阻止
        event.stopPropagation();

        // 在"查看内部"模式下的特殊处理
        if (isViewingChildren) {
          // 如果点击的是已匹配的层级，则取消匹配并保持在"查看内部"模式
        if (matchedLevelIndices[currentElementTypeKey] === level) {
            // console.log("在查看内部模式下取消层级匹配");
            cancelHierarchyMatchInside();
          } else {
            // 否则执行精确层级匹配并保持在"查看内部"模式
            // console.log("在查看内部模式下执行精确层级匹配, 层级:", level);
            selectByHierarchyInside(level);
          }
        } else {
          // 正常模式下的层级匹配
        if (matchedLevelIndices[currentElementTypeKey] === level) {
          // console.log("取消层级匹配");
          cancelHierarchyMatch();
        } else {
          // console.log("执行精确层级匹配, 层级:", level);
          selectByHierarchy(level);
          }
        }
      } else {
        // 正常点击行为，切换到该层级
        const level = parseInt(this.getAttribute('data-level'));
        // console.log("执行普通层级切换, 层级:", level);

        // 在"查看内部"模式下，层级操作应该保持在当前页面
        if (isViewingChildren) {
          // 调用内部层级导航函数
          switchToLevelInside(level);
        } else {
          // 正常的层级切换
        switchToLevel(level);
        }
      }
    });

    // 添加鼠标悬停事件
    selector.addEventListener('mouseover', function() {
      const isCurrentLevel = this.getAttribute('data-current') === 'true';
      const isMatchedLevel = this.getAttribute('data-matched') === 'true';

      this.style.backgroundColor = isCurrentLevel ? 'rgba(66, 133, 244, 0.9)' :
                                  isMatchedLevel ? 'rgba(247, 152, 29, 0.9)' :
                                  'rgba(255, 255, 255, 0.15)';
      this.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    });

    // 添加鼠标离开事件
    selector.addEventListener('mouseout', function() {
      const isCurrentLevel = this.getAttribute('data-current') === 'true';
      const isMatchedLevel = this.getAttribute('data-matched') === 'true';

      this.style.backgroundColor = isCurrentLevel ? 'rgba(66, 133, 244, 0.8)' :
                                  isMatchedLevel ? 'rgba(247, 152, 29, 0.8)' :
                                  'rgba(255, 255, 255, 0.08)';
      this.style.boxShadow = (isCurrentLevel || isMatchedLevel) ?
                           '0 1px 3px rgba(0,0,0,0.3)' :
                           '0 1px 2px rgba(0,0,0,0.1)';
    });
  });
}

// 取消层级匹配
function cancelHierarchyMatch() {
  // 如果没有当前元素类型的匹配层级，不执行任何操作
  if (matchedLevelIndices[currentElementTypeKey] === undefined) {
    return;
  }

  const typeKeyToRestore = currentElementTypeKey;

  // 检查当前选中元素是否仍然有效（可能已被删除）
  // 过滤掉已经不在DOM中的元素
  selectedElements = selectedElements.filter(el => document.body.contains(el));

  // 如果过滤后没有元素了，清空选择并返回
  if (selectedElements.length === 0) {
    delete matchedLevelIndices[typeKeyToRestore];
    currentElementTypeKey = '';
    parentChain = [];
    parentChainIndex = 0;
    childrenChain = [];
    return;
  }

  // 重置当前元素类型的匹配层级索引
  delete matchedLevelIndices[typeKeyToRestore];

  // 如果当前元素类型存在
  if (currentElementTypeKey) {
    // 获取当前选中的该类型元素
    const currentTypeElements = selectedElements.filter(el => matchesElementType(el, currentElementTypeKey));

    // 无论是否有选中的元素，都重新选择所有匹配当前元素类型的元素（不考虑层级）
    // 清除当前类型元素的高亮
    currentTypeElements.forEach(el => {
      unmarkElementSelected(el);
    });

    // 从选中列表中移除当前类型的元素
    selectedElements = selectedElements.filter(el => !matchesElementType(el, currentElementTypeKey));

    // 重新选择所有匹配当前元素类型的元素
    const filteredElements = getElementsByTypeKey(currentElementTypeKey);

    // 高亮所有匹配元素
    filteredElements.forEach(el => {
      markElementSelected(el);
      selectedElements.push(el);
    });

    // 更新UI
    updateNotification(selectedElements.length);

    // 更新剪贴板
    updateClipboard();
  }
}
// =============================================
// 用户设置管理 - 加载和保存用户偏好设置
// =============================================
// 检查并加载用户设置
function loadUserSettings() {
  try {
    const defaults = {
      'batch-selector-clipboard-format': 'newline',
      'batch-selector-remove-internal': false,      // 默认关闭
      'batch-selector-remove-code': false, // 默认不勾选
      'batch-selector-remove-symbols': false,
      'batch-selector-remove-english': false,
      'batch-selector-remove-chinese': false,
      'batch-selector-remove-numbers': false,
      'batch-selector-remove-duplicates': false,
      'batch-selector-hide-type-prompt': false,
      'batch-selector-hierarchy-expanded': false,
      [HIERARCHY_SECTION_OPEN_STORAGE_KEY]: false,
      [OUTPUT_SECTION_OPEN_STORAGE_KEY]: false,
      [TREECLIP_LOCALE_STORAGE_KEY]: null,
      [SELECTION_UI_DETENT_STORAGE_KEY]: 'actions',
      [SELECTION_UI_COLLAPSED_DETENT_STORAGE_KEY]: 'actions',
      [FLOATING_BOX_POSITION_STORAGE_KEY]: null,
      'batch-selector-realtime-copy': false, // 新增：实时复制设置默认值
      'batch-selector-select-key-keys': JSON.stringify(['Shift']), // 默认选择键
      'batch-selector-type-select-key-keys': JSON.stringify(['f']), // 默认类型选择键
      'batch-selector-copy-key-keys': JSON.stringify(['Control', 'c']) // 默认复制组合键
    };
    // console.log("loadUserSettings: Requesting storage with defaults:", JSON.stringify(defaults)); // Log defaults - REMOVED

    chrome.storage.local.get(defaults, function(items) {
      // console.log("loadUserSettings: Received items from storage:", JSON.stringify(items)); // Log received items - REMOVED

      clipboardFormat = items['batch-selector-clipboard-format'];
      removeInternalSpaces = items['batch-selector-remove-internal'];
      removeCodePatterns = items['batch-selector-remove-code'];
      removeSymbols = items['batch-selector-remove-symbols'];
      removeEnglish = items['batch-selector-remove-english'];
      removeChinese = items['batch-selector-remove-chinese'];
      removeNumbers = items['batch-selector-remove-numbers'];
      removeDuplicates = items['batch-selector-remove-duplicates'];
      hideTypePrompt = items['batch-selector-hide-type-prompt'];
      isHierarchyExpanded = Boolean(items['batch-selector-hierarchy-expanded']);
      isHierarchySectionOpen = Boolean(items[HIERARCHY_SECTION_OPEN_STORAGE_KEY]);
      isOutputFormatExpanded = Boolean(items[OUTPUT_SECTION_OPEN_STORAGE_KEY]);
      const storedLocale = items[TREECLIP_LOCALE_STORAGE_KEY];
      if (SUPPORTED_TREECLIP_LOCALES.has(storedLocale)) {
        void setTreeClipLocale(storedLocale).then(applied => {
          if (applied) refreshLocalizedTreeClipUI();
        });
      }
      const savedDetent = ['actions', 'compact', 'details'].includes(items[SELECTION_UI_DETENT_STORAGE_KEY])
        ? items[SELECTION_UI_DETENT_STORAGE_KEY]
        : 'actions';
      preferredCollapsedDetent = items[SELECTION_UI_COLLAPSED_DETENT_STORAGE_KEY] === 'compact' ? 'compact' : 'actions';
      isDetailsPanelOpen = savedDetent === 'details';
      isActionBarCompact = savedDetent === 'compact';
      if (savedDetent === 'actions' || savedDetent === 'compact') preferredCollapsedDetent = savedDetent;
      restoreFloatingBoxPosition(items[FLOATING_BOX_POSITION_STORAGE_KEY]);
      isRealtimeCopyEnabled = items['batch-selector-realtime-copy']; // 新增：加载实时复制设置

      // 加载快捷键配置
      try {
        selectKeyConfig = { keys: JSON.parse(items['batch-selector-select-key-keys']) };
        typeSelectKeyConfig = { keys: JSON.parse(items['batch-selector-type-select-key-keys']) };
        copyKeyConfig = { keys: JSON.parse(items['batch-selector-copy-key-keys']) };
      } catch (e) {
        // 如果解析失败，使用默认值
        selectKeyConfig = { keys: ['Shift'] };
        typeSelectKeyConfig = { keys: ['f'] };
        copyKeyConfig = { keys: ['Control', 'c'] };
      }

      // 新的 Log (如果需要)
    });
  } catch (e) {
    console.error('loadUserSettings Error:', e);
  }
}

// 检查快捷键是否冲突
function checkKeyConflicts() {
  // 将键数组转换为排序后的字符串，用于比较
  function keysToString(keyConfig) {
    return keyConfig.keys.slice().sort().join(',').toLowerCase();
  }

  const selectKeyStr = keysToString(selectKeyConfig);
  const typeSelectKeyStr = keysToString(typeSelectKeyConfig);
  const copyKeyStr = keysToString(copyKeyConfig);

  // 存储冲突信息
  const conflicts = {
    select: { hasConflict: false, conflictWith: [] },
    typeSelect: { hasConflict: false, conflictWith: [] },
    copy: { hasConflict: false, conflictWith: [] },
    isEmpty: false
  };

  // 检查是否有空配置
  if (selectKeyConfig.keys.length === 0 ||
      typeSelectKeyConfig.keys.length === 0 ||
      copyKeyConfig.keys.length === 0) {
    conflicts.isEmpty = true;

    if (selectKeyConfig.keys.length === 0) {
      conflicts.select.hasConflict = true;
      conflicts.select.conflictWith.push('empty');
    }

    if (typeSelectKeyConfig.keys.length === 0) {
      conflicts.typeSelect.hasConflict = true;
      conflicts.typeSelect.conflictWith.push('empty');
    }

    if (copyKeyConfig.keys.length === 0) {
      conflicts.copy.hasConflict = true;
      conflicts.copy.conflictWith.push('empty');
    }
  }

  // 检查冲突
  if (selectKeyStr === typeSelectKeyStr && selectKeyStr !== '') {
    conflicts.select.hasConflict = true;
    conflicts.select.conflictWith.push('typeSelect');

    conflicts.typeSelect.hasConflict = true;
    conflicts.typeSelect.conflictWith.push('select');
  }

  if (selectKeyStr === copyKeyStr && selectKeyStr !== '') {
    conflicts.select.hasConflict = true;
    conflicts.select.conflictWith.push('copy');

    conflicts.copy.hasConflict = true;
    conflicts.copy.conflictWith.push('select');
  }

  if (typeSelectKeyStr === copyKeyStr && typeSelectKeyStr !== '') {
    conflicts.typeSelect.hasConflict = true;
    conflicts.typeSelect.conflictWith.push('copy');

    conflicts.copy.hasConflict = true;
    conflicts.copy.conflictWith.push('typeSelect');
  }

  return conflicts;
}

// 检查并显示冲突
function checkAndDisplayConflicts() {
  const conflicts = checkKeyConflicts();

  // 获取冲突提示元素
  const selectKeyConflict = document.getElementById('select-key-conflict');
  const typeSelectKeyConflict = document.getElementById('type-select-key-conflict');
  const copyKeyConflict = document.getElementById('copy-key-conflict');

  // 获取按键显示元素
  const selectKeyDisplay = document.getElementById('select-key-display');
  const typeSelectKeyDisplay = document.getElementById('type-select-key-display');
  const copyKeyDisplay = document.getElementById('copy-key-display');

  // 显示或隐藏冲突提示
  if (selectKeyConflict) {
    // 只在当前输入框下显示文字提示
    if (conflicts.select.hasConflict && currentCaptureTarget === 'select-key') {
      selectKeyConflict.style.display = 'block';
      if (conflicts.select.conflictWith.includes('empty')) {
        selectKeyConflict.textContent = '⚠️ 快捷键不能为空';
      } else {
        selectKeyConflict.textContent = '⚠️ 与其他快捷键冲突';
      }
    } else {
      selectKeyConflict.style.display = 'none';
    }

    // 设置输入框样式
    if (selectKeyDisplay) {
      if (conflicts.select.hasConflict) {
        if (currentCaptureTarget === 'select-key') {
          // 当前正在编辑的输入框标红
          selectKeyDisplay.style.backgroundColor = 'rgba(255, 107, 107, 0.3)';
        } else {
          // 其他冲突输入框标黄
          selectKeyDisplay.style.backgroundColor = 'rgba(255, 193, 7, 0.3)';
        }
        selectKeyDisplay.style.color = '#fff';
      } else {
        // 恢复正常样式，但只有在不是捕获状态时
        if (!isCapturingKeys || currentCaptureTarget !== 'select-key') {
          selectKeyDisplay.style.backgroundColor = 'rgba(255,255,255,0.2)';
          selectKeyDisplay.style.color = '#fff';
          // 添加过渡效果
          selectKeyDisplay.style.transition = 'background-color 0.2s ease-in-out';
        }
      }
    }
  }

  if (typeSelectKeyConflict) {
    // 只在当前输入框下显示文字提示
    if (conflicts.typeSelect.hasConflict && currentCaptureTarget === 'type-select-key') {
      typeSelectKeyConflict.style.display = 'block';
      if (conflicts.typeSelect.conflictWith.includes('empty')) {
        typeSelectKeyConflict.textContent = '⚠️ 快捷键不能为空';
      } else {
        typeSelectKeyConflict.textContent = '⚠️ 与其他快捷键冲突';
      }
    } else {
      typeSelectKeyConflict.style.display = 'none';
    }

    // 设置输入框样式
    if (typeSelectKeyDisplay) {
      if (conflicts.typeSelect.hasConflict) {
        if (currentCaptureTarget === 'type-select-key') {
          // 当前正在编辑的输入框标红
          typeSelectKeyDisplay.style.backgroundColor = 'rgba(255, 107, 107, 0.3)';
        } else {
          // 其他冲突输入框标黄
          typeSelectKeyDisplay.style.backgroundColor = 'rgba(255, 193, 7, 0.3)';
        }
        typeSelectKeyDisplay.style.color = '#fff';
      } else {
        // 恢复正常样式，但只有在不是捕获状态时
        if (!isCapturingKeys || currentCaptureTarget !== 'type-select-key') {
          typeSelectKeyDisplay.style.backgroundColor = 'rgba(255,255,255,0.2)';
          typeSelectKeyDisplay.style.color = '#fff';
          // 添加过渡效果
          typeSelectKeyDisplay.style.transition = 'background-color 0.2s ease-in-out';
        }
      }
    }
  }

  if (copyKeyConflict) {
    // 只在当前输入框下显示文字提示
    if (conflicts.copy.hasConflict && currentCaptureTarget === 'copy-key') {
      copyKeyConflict.style.display = 'block';
      if (conflicts.copy.conflictWith.includes('empty')) {
        copyKeyConflict.textContent = '⚠️ 快捷键不能为空';
      } else {
        copyKeyConflict.textContent = '⚠️ 与其他快捷键冲突';
      }
    } else {
      copyKeyConflict.style.display = 'none';
    }

    // 设置输入框样式
    if (copyKeyDisplay) {
      if (conflicts.copy.hasConflict) {
        if (currentCaptureTarget === 'copy-key') {
          // 当前正在编辑的输入框标红
          copyKeyDisplay.style.backgroundColor = 'rgba(255, 107, 107, 0.3)';
        } else {
          // 其他冲突输入框标黄
          copyKeyDisplay.style.backgroundColor = 'rgba(255, 193, 7, 0.3)';
        }
        copyKeyDisplay.style.color = '#fff';
      } else {
        // 恢复正常样式，但只有在不是捕获状态时
        if (!isCapturingKeys || currentCaptureTarget !== 'copy-key') {
          copyKeyDisplay.style.backgroundColor = 'rgba(255,255,255,0.2)';
          copyKeyDisplay.style.color = '#fff';
          // 添加过渡效果
          copyKeyDisplay.style.transition = 'background-color 0.2s ease-in-out';
        }
      }
    }
  }

  return !conflicts.isEmpty &&
         !conflicts.select.hasConflict &&
         !conflicts.typeSelect.hasConflict &&
         !conflicts.copy.hasConflict;
}

// 保存快捷键配置
function saveKeyConfig() {
  try {
    // 检查快捷键冲突
    if (!checkAndDisplayConflicts()) {
      // 不在主UI上显示冲突提示，只在配置面板中显示
      return false;
    }

    chrome.storage.local.set({
      'batch-selector-select-key-keys': JSON.stringify(selectKeyConfig.keys),
      'batch-selector-type-select-key-keys': JSON.stringify(typeSelectKeyConfig.keys),
      'batch-selector-copy-key-keys': JSON.stringify(copyKeyConfig.keys)
    });

    // 显示保存成功的蓝色效果
    showSaveSuccessEffect();

    // 不在主UI上显示保存提示
    return true;
  } catch (e) {
    console.error('saveKeyConfig Error:', e);
    return false;
  }
}

// 显示保存成功的蓝色效果
function showSaveSuccessEffect(allDisplays = false) {
  // 获取当前冲突状态
  const conflicts = checkKeyConflicts();

  // 获取所有输入框的当前背景色
  const getOriginalBg = (element) => {
    // 检查元素是否有冲突
    let hasConflict = false;
    const id = element.id;

    if (id === 'select-key-display') {
      hasConflict = conflicts.select.hasConflict;
    } else if (id === 'type-select-key-display') {
      hasConflict = conflicts.typeSelect.hasConflict;
    } else if (id === 'copy-key-display') {
      hasConflict = conflicts.copy.hasConflict;
    }

    // 如果有冲突，返回冲突状态的背景色
    if (hasConflict) {
      if (currentCaptureTarget === id.replace('-display', '')) {
        return 'rgba(255, 107, 107, 0.3)'; // 红色（当前编辑的冲突输入框）
      } else {
        return 'rgba(255, 193, 7, 0.3)'; // 黄色（其他冲突输入框）
      }
    }

    // 如果没有冲突，返回默认背景色
    return 'rgba(255,255,255,0.2)';
  };

  if (allDisplays) {
    // 如果是恢复默认，显示所有输入框的蓝色效果
    const displays = [
      'select-key-display',
      'type-select-key-display',
      'copy-key-display'
    ];

    displays.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        // 检查是否有冲突
        let hasConflict = false;
        if (id === 'select-key-display') {
          hasConflict = conflicts.select.hasConflict;
        } else if (id === 'type-select-key-display') {
          hasConflict = conflicts.typeSelect.hasConflict;
        } else if (id === 'copy-key-display') {
          hasConflict = conflicts.copy.hasConflict;
        }

        // 只对没有冲突的输入框显示蓝色效果
        if (!hasConflict) {
          // 保存将要恢复的背景色
          const returnBg = getOriginalBg(element);

          // 设置蓝色效果，使用淡入淡出效果
          element.style.transition = 'background-color 0.2s ease-in-out';
          element.style.backgroundColor = 'rgba(66, 133, 244, 0.3)';

          // 0.5秒后恢复原始背景色，带淡出效果
          setTimeout(() => {
            element.style.transition = 'background-color 0.3s ease-in-out';
            element.style.backgroundColor = returnBg;
          }, 500);
        }
      }
    });

    return;
  }

  // 只在刚刚编辑的输入框显示蓝色效果
  // 获取刚刚编辑的输入框元素
  let targetDisplay = null;

  // 根据刚刚结束捕获的目标确定要显示效果的输入框
  // 注意：此时currentCaptureTarget已经被清空，所以我们需要在finishKeyCapture中保存它
  if (lastCaptureTarget === 'select-key') {
    targetDisplay = document.getElementById('select-key-display');
  } else if (lastCaptureTarget === 'type-select-key') {
    targetDisplay = document.getElementById('type-select-key-display');
  } else if (lastCaptureTarget === 'copy-key') {
    targetDisplay = document.getElementById('copy-key-display');
  }

  // 如果找到目标输入框，且没有冲突，显示蓝色效果
  if (targetDisplay) {
    let hasConflict = false;

    // 检查目标输入框是否有冲突
    if (lastCaptureTarget === 'select-key') {
      hasConflict = conflicts.select.hasConflict;
    } else if (lastCaptureTarget === 'type-select-key') {
      hasConflict = conflicts.typeSelect.hasConflict;
    } else if (lastCaptureTarget === 'copy-key') {
      hasConflict = conflicts.copy.hasConflict;
    }

    // 如果没有冲突，显示蓝色效果
    if (!hasConflict) {
      // 保存将要恢复的背景色
      const returnBg = getOriginalBg(targetDisplay);

      // 设置蓝色效果，使用淡入淡出效果
      targetDisplay.style.transition = 'background-color 0.2s ease-in-out';
      targetDisplay.style.backgroundColor = 'rgba(66, 133, 244, 0.3)';

      // 0.5秒后恢复原始背景色，带淡出效果
      setTimeout(() => {
        targetDisplay.style.transition = 'background-color 0.3s ease-in-out';
        targetDisplay.style.backgroundColor = returnBg;
      }, 500);
    }
  }
}

// 显示快捷键配置面板
function showKeyConfigPanel() {
  // 如果已经显示了配置面板，则不重复创建
  if (isShowingKeyConfig) {
    return;
  }

  isShowingKeyConfig = true;

  // 创建配置面板
  const configPanel = document.createElement('div');
  configPanel.id = 'batch-selector-key-config';
  configPanel.className = 'batch-selector-ui treeclip-floating-surface treeclip-key-config';

  // 配置面板内容
  configPanel.innerHTML = `
    <div class="treeclip-floating-header">
      <h3 class="treeclip-floating-title">${t('ui_shortcuts_config')}</h3>
      <button id="batch-selector-key-config-close" class="batch-selector-ui treeclip-floating-close" aria-label="${t('ui_close')}">×</button>
    </div>
    <div class="treeclip-floating-body">
      <div class="treeclip-shortcut-list">
        <div id="select-key-container" class="treeclip-floating-card treeclip-shortcut-item">
          <div class="treeclip-shortcut-label">${t('ui_select_key')}</div>
          <div id="select-key-display" class="treeclip-shortcut-display">${escapeHtml(selectKeyConfig.keys.map(formatKeyForDisplay).join(' + '))}</div>
          <div id="select-key-conflict" class="treeclip-shortcut-conflict">${t('ui_conflict_warning')}</div>
          <div class="treeclip-shortcut-description">${t('ui_select_key_desc')}</div>
        </div>
        <div id="type-select-key-container" class="treeclip-floating-card treeclip-shortcut-item">
          <div class="treeclip-shortcut-label">${t('ui_type_select_key')}</div>
          <div id="type-select-key-display" class="treeclip-shortcut-display">${escapeHtml(typeSelectKeyConfig.keys.map(formatKeyForDisplay).join(' + '))}</div>
          <div id="type-select-key-conflict" class="treeclip-shortcut-conflict">${t('ui_conflict_warning')}</div>
          <div class="treeclip-shortcut-description">${t('ui_type_select_key_desc')}</div>
        </div>
        <div id="copy-key-container" class="treeclip-floating-card treeclip-shortcut-item">
          <div class="treeclip-shortcut-label">${t('ui_copy_key')}</div>
          <div id="copy-key-display" class="treeclip-shortcut-display">${escapeHtml(copyKeyConfig.keys.map(formatKeyForDisplay).join(' + '))}</div>
          <div id="copy-key-conflict" class="treeclip-shortcut-conflict">${t('ui_conflict_warning')}</div>
          <div class="treeclip-shortcut-description">${t('ui_copy_key_desc')}</div>
        </div>
      </div>
      <div class="treeclip-floating-card treeclip-shortcut-reference">
        <div class="treeclip-guide-section-title">${t('shortcut_reference_title')}</div>
        <div class="treeclip-guide-row"><span class="treeclip-guide-keys"><kbd class="treeclip-guide-key">Shift + ↑ / ↓</kbd></span><span class="treeclip-guide-description">${t('shortcut_hierarchy_desc')}</span></div>
        <div class="treeclip-guide-row"><span class="treeclip-guide-keys"><kbd class="treeclip-guide-key">Shift + → / ←</kbd></span><span class="treeclip-guide-description">${t('shortcut_fields_desc')}</span></div>
        <div class="treeclip-guide-row"><span class="treeclip-guide-keys"><kbd class="treeclip-guide-key">${t('shortcut_bind_label')}</kbd></span><span class="treeclip-guide-description">${t('guide_bind_level')}</span></div>
        <div class="treeclip-guide-row"><span class="treeclip-guide-keys"><kbd class="treeclip-guide-key">${t('shortcut_switch_group_label')}</kbd></span><span class="treeclip-guide-description">${t('shortcut_switch_group_desc')}</span></div>
        <div class="treeclip-guide-row"><span class="treeclip-guide-keys"><kbd class="treeclip-guide-key">${t('shortcut_remove_group_label')}</kbd></span><span class="treeclip-guide-description">${t('shortcut_remove_group_desc')}</span></div>
        <div class="treeclip-guide-row"><span class="treeclip-guide-keys"><kbd class="treeclip-guide-key">Esc</kbd></span><span class="treeclip-guide-description">${t('shortcut_clear_desc')}</span></div>
      </div>
      <div class="treeclip-shortcut-help">${t('shortcut_edit_help')}</div>
      <div class="treeclip-floating-footer">
        <span id="save-status-message" class="treeclip-floating-status"></span>
        <div style="display: flex; gap: 7px;">
          <button id="reset-key-defaults" class="batch-selector-ui treeclip-floating-button">${t('ui_reset_defaults')}</button>
          <button id="batch-selector-key-config-save" class="batch-selector-ui treeclip-floating-button treeclip-floating-button-primary">${t('ui_save')}</button>
        </div>
      </div>
    </div>
  `;

  // 添加到文档
  document.body.appendChild(configPanel);

  // 添加事件监听器
  setupKeyConfigEvents();
}

// 设置快捷键配置面板的事件监听器
function setupKeyConfigEvents() {
  // 添加点击面板外部关闭的功能
  keyConfigOutsideMouseDownHandler = function(event) {
    if (isShowingKeyConfig && !event.target.closest('#batch-selector-key-config')) {
      // 如果正在捕获按键，先结束捕获
      if (isCapturingKeys) {
        finishKeyCapture();
      }
      // 然后关闭面板
      hideKeyConfigPanel();
    }
  };
  document.addEventListener('mousedown', keyConfigOutsideMouseDownHandler);

  // 顶部关闭按钮
  const closeButton = document.getElementById('batch-selector-key-config-close');
  if (closeButton) {
    closeButton.addEventListener('click', function() {
      // 如果正在捕获按键，先结束捕获
      if (isCapturingKeys) {
        finishKeyCapture();
      }
      // 然后关闭面板
      hideKeyConfigPanel();
    });
  }

  // 添加点击配置面板空白区域结束捕获的功能
  const configPanel = document.getElementById('batch-selector-key-config');
  if (configPanel) {
    configPanel.addEventListener('mousedown', function(event) {
      // 如果点击的不是输入框或关闭按钮，且正在捕获按键
      if (isCapturingKeys &&
          !event.target.id.includes('-display') &&
          event.target.id !== 'batch-selector-key-config-close') {
        // 结束捕获
        finishKeyCapture();
      }
    });
  }

  // 选择键显示框
  const selectKeyDisplay = document.getElementById('select-key-display');
  if (selectKeyDisplay) {
    selectKeyDisplay.addEventListener('click', function() {
      if (isCapturingKeys && currentCaptureTarget === 'select-key') {
        // 如果已经在捕获这个按键，则结束捕获
        finishKeyCapture();
      } else if (isCapturingKeys) {
        // 如果正在捕获其他按键，先结束那个捕获
        finishKeyCapture();
        // 然后开始捕获这个按键
        startKeyCapture('select-key');
      } else {
        // 开始捕获按键
        startKeyCapture('select-key');
      }
    });

    // 添加悬停效果
    selectKeyDisplay.addEventListener('mouseover', function() {
      // 获取当前冲突状态
      const conflicts = checkKeyConflicts();

      // 只有在没有冲突且不在捕获状态时才改变背景色
      if ((!conflicts.select.hasConflict) &&
          (!isCapturingKeys || currentCaptureTarget !== 'select-key')) {
        this.style.transition = 'background-color 0.2s ease-in-out';
        this.style.backgroundColor = 'rgba(255,255,255,0.3)';
      }
    });

    selectKeyDisplay.addEventListener('mouseout', function() {
      // 获取当前冲突状态
      const conflicts = checkKeyConflicts();

      // 只有在没有冲突且不在捕获状态时才恢复背景色
      if ((!conflicts.select.hasConflict) &&
          (!isCapturingKeys || currentCaptureTarget !== 'select-key')) {
        this.style.transition = 'background-color 0.2s ease-in-out';
        this.style.backgroundColor = 'rgba(255,255,255,0.2)';
      }
    });
  }

  // 类型选择键显示框
  const typeSelectKeyDisplay = document.getElementById('type-select-key-display');
  if (typeSelectKeyDisplay) {
    typeSelectKeyDisplay.addEventListener('click', function() {
      if (isCapturingKeys && currentCaptureTarget === 'type-select-key') {
        // 如果已经在捕获这个按键，则结束捕获
        finishKeyCapture();
      } else if (isCapturingKeys) {
        // 如果正在捕获其他按键，先结束那个捕获
        finishKeyCapture();
        // 然后开始捕获这个按键
        startKeyCapture('type-select-key');
      } else {
        // 开始捕获按键
        startKeyCapture('type-select-key');
      }
    });

    // 添加悬停效果
    typeSelectKeyDisplay.addEventListener('mouseover', function() {
      // 获取当前冲突状态
      const conflicts = checkKeyConflicts();

      // 只有在没有冲突且不在捕获状态时才改变背景色
      if ((!conflicts.typeSelect.hasConflict) &&
          (!isCapturingKeys || currentCaptureTarget !== 'type-select-key')) {
        this.style.transition = 'background-color 0.2s ease-in-out';
        this.style.backgroundColor = 'rgba(255,255,255,0.3)';
      }
    });

    typeSelectKeyDisplay.addEventListener('mouseout', function() {
      // 获取当前冲突状态
      const conflicts = checkKeyConflicts();

      // 只有在没有冲突且不在捕获状态时才恢复背景色
      if ((!conflicts.typeSelect.hasConflict) &&
          (!isCapturingKeys || currentCaptureTarget !== 'type-select-key')) {
        this.style.transition = 'background-color 0.2s ease-in-out';
        this.style.backgroundColor = 'rgba(255,255,255,0.2)';
      }
    });
  }

  // 复制键显示框
  const copyKeyDisplay = document.getElementById('copy-key-display');
  if (copyKeyDisplay) {
    copyKeyDisplay.addEventListener('click', function() {
      if (isCapturingKeys && currentCaptureTarget === 'copy-key') {
        // 如果已经在捕获这个按键，则结束捕获
        finishKeyCapture();
      } else if (isCapturingKeys) {
        // 如果正在捕获其他按键，先结束那个捕获
        finishKeyCapture();
        // 然后开始捕获这个按键
        startKeyCapture('copy-key');
      } else {
        // 开始捕获按键
        startKeyCapture('copy-key');
      }
    });

    // 添加悬停效果
    copyKeyDisplay.addEventListener('mouseover', function() {
      // 获取当前冲突状态
      const conflicts = checkKeyConflicts();

      // 只有在没有冲突且不在捕获状态时才改变背景色
      if ((!conflicts.copy.hasConflict) &&
          (!isCapturingKeys || currentCaptureTarget !== 'copy-key')) {
        this.style.transition = 'background-color 0.2s ease-in-out';
        this.style.backgroundColor = 'rgba(255,255,255,0.3)';
      }
    });

    copyKeyDisplay.addEventListener('mouseout', function() {
      // 获取当前冲突状态
      const conflicts = checkKeyConflicts();

      // 只有在没有冲突且不在捕获状态时才恢复背景色
      if ((!conflicts.copy.hasConflict) &&
          (!isCapturingKeys || currentCaptureTarget !== 'copy-key')) {
        this.style.transition = 'background-color 0.2s ease-in-out';
        this.style.backgroundColor = 'rgba(255,255,255,0.2)';
      }
    });
  }

  // 恢复默认按钮
  const resetDefaultsButton = document.getElementById('reset-key-defaults');
  if (resetDefaultsButton) {
    resetDefaultsButton.addEventListener('click', function() {
      // 获取状态提示元素
      const statusMessage = document.getElementById('save-status-message');

      // 恢复默认配置
      selectKeyConfig.keys = ['Shift'];
      typeSelectKeyConfig.keys = ['F'];
      copyKeyConfig.keys = ['Control', 'C'];

      // 更新显示
      updateKeyDisplays();

      // 检查冲突（应该没有冲突）
      checkAndDisplayConflicts();

      // 保存配置
      saveKeyConfig();

      // 显示所有输入框的成功提示
      showSaveSuccessEffect(true);

      // 显示恢复默认提示
      if (statusMessage) {
        statusMessage.textContent = '已恢复默认设置';
        statusMessage.style.opacity = '1';
        // 3秒后隐藏提示
        setTimeout(() => {
          statusMessage.style.opacity = '0';
        }, 3000);
      }

      // 重置lastCaptureTarget，防止后续点击"保存"按钮时显示"已保存成功"
      lastCaptureTarget = '';
    });

  }

  // 保存按钮
  const saveButton = document.getElementById('batch-selector-key-config-save');
  if (saveButton) {
    saveButton.addEventListener('click', function() {
      // 获取状态提示元素
      const statusMessage = document.getElementById('save-status-message');

      // 检查是否有修改
      const hasChanges = lastCaptureTarget !== '';

      // 保存配置
      if (saveKeyConfig()) {
        // 如果保存成功，只对最后修改的键显示成功提示
        if (hasChanges) {
          // 显示蓝色效果
          showSaveSuccessEffect();
          // 显示保存成功提示
          if (statusMessage) {
            statusMessage.textContent = t('ui_saved_success');
            statusMessage.style.opacity = '1';
            // 3秒后隐藏提示
            setTimeout(() => {
              statusMessage.style.opacity = '0';
            }, 3000);
          }
          // 重置lastCaptureTarget，防止重复点击"保存"按钮时仍然显示蓝色效果
          lastCaptureTarget = '';
        } else {
          // 显示无更改提示
          if (statusMessage) {
            statusMessage.textContent = t('ui_no_changes');
            statusMessage.style.opacity = '1';
            // 3秒后隐藏提示
            setTimeout(() => {
              statusMessage.style.opacity = '0';
            }, 3000);
          }
        }
      }
    });

  }

  // 初始检查冲突
  checkAndDisplayConflicts();
}

// 开始捕获按键
function startKeyCapture(targetType) {
  // 更新显示为等待状态
  const displayElement = document.getElementById(`${targetType}-display`);
  if (displayElement) {
    displayElement.textContent = t('ui_press_keys_to_capture');
    displayElement.style.backgroundColor = 'rgba(255, 193, 7, 0.3)';
  }

  // 设置捕获状态
  isCapturingKeys = true;
  currentCaptureTarget = targetType;
}

// 处理按键捕获输入
function handleKeyCaptureInput(event) {
  // 阻止默认行为
  event.preventDefault();
  event.stopPropagation();

  // 如果按下Enter键，结束捕获
  if (event.key === 'Enter') {
    finishKeyCapture();
    return;
  }

  // 获取当前所有按下的按键
  const pressedKeys = [];

  // 检查修饰键
  if (event.ctrlKey) pressedKeys.push('Ctrl');
  if (event.shiftKey) pressedKeys.push('Shift');
  if (event.altKey) pressedKeys.push('Alt');
  if (event.metaKey) pressedKeys.push('Meta');

  // 添加当前按键（如果不是修饰键）
  let keyName = event.key;

  // 对于特殊键，使用更友好的名称
  if (keyName === ' ') keyName = 'Space';
  if (keyName === 'Control') keyName = 'Ctrl';
  if (keyName === 'Meta') keyName = 'Meta';

  // 格式化按键名称，使单个字符大写
  if (keyName.length === 1) {
    keyName = keyName.toUpperCase();
  }

  // 如果当前按键不是修饰键，或者是唯一按下的修饰键，则添加到列表
  if (keyName !== 'Ctrl' && keyName !== 'Shift' && keyName !== 'Alt' && keyName !== 'Meta') {
    pressedKeys.push(keyName);
  } else if (pressedKeys.length === 0) {
    // 如果只按下了一个修饰键，也添加到列表
    pressedKeys.push(keyName);
  }

  // 获取当前配置
  let currentConfig;
  switch (currentCaptureTarget) {
    case 'select-key':
      currentConfig = selectKeyConfig;
      break;
    case 'type-select-key':
      currentConfig = typeSelectKeyConfig;
      break;
    case 'copy-key':
      currentConfig = copyKeyConfig;
      break;
  }

  // 更新配置为当前按下的按键组合
  currentConfig.keys = pressedKeys;

  // 更新显示
  updateKeyDisplays();

  // 实时检查冲突
  checkAndDisplayConflicts();
}

// 结束按键捕获
function finishKeyCapture() {
  isCapturingKeys = false;

  // 获取当前配置的显示元素
  const displayElement = document.getElementById(`${currentCaptureTarget}-display`);
  if (displayElement) {
    displayElement.style.backgroundColor = 'rgba(255,255,255,0.2)';
  }

  // 保存当前捕获目标，用于显示保存效果
  lastCaptureTarget = currentCaptureTarget;

  // 清除当前捕获目标
  currentCaptureTarget = '';

  // 检查冲突
  const noConflicts = checkAndDisplayConflicts();

  // 如果没有冲突，自动保存配置
  if (noConflicts) {
    saveKeyConfig();
  }
  // 冲突只在配置面板中显示，不在主UI上提示
}

// 格式化按键显示，首字母大写
function formatKeyForDisplay(key) {
  if (!key) return '';

  // 特殊键保持原样
  if (key === 'Ctrl' || key === 'Alt' || key === 'Shift' || key === 'Meta' ||
      key === 'Space' || key === 'Enter' || key === 'Tab' || key === 'Escape' ||
      key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
    return key;
  }

  // 单个字符的键，转为大写
  if (key.length === 1) {
    return key.toUpperCase();
  }

  // 其他键，首字母大写
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// 更新按键显示
function updateKeyDisplays() {
  const selectKeyDisplay = document.getElementById('select-key-display');
  const typeSelectKeyDisplay = document.getElementById('type-select-key-display');
  const copyKeyDisplay = document.getElementById('copy-key-display');

  if (selectKeyDisplay) {
    const formattedKeys = selectKeyConfig.keys.map(formatKeyForDisplay);
    selectKeyDisplay.textContent = formattedKeys.join(' + ');
    selectKeyDisplay.style.backgroundColor = 'rgba(255,255,255,0.2)';
  }

  if (typeSelectKeyDisplay) {
    const formattedKeys = typeSelectKeyConfig.keys.map(formatKeyForDisplay);
    typeSelectKeyDisplay.textContent = formattedKeys.join(' + ');
    typeSelectKeyDisplay.style.backgroundColor = 'rgba(255,255,255,0.2)';
  }

  if (copyKeyDisplay) {
    const formattedKeys = copyKeyConfig.keys.map(formatKeyForDisplay);
    copyKeyDisplay.textContent = formattedKeys.join(' + ');
    copyKeyDisplay.style.backgroundColor = 'rgba(255,255,255,0.2)';
  }
}

// 隐藏快捷键配置面板
function hideKeyConfigPanel() {
  const configPanel = document.getElementById('batch-selector-key-config');
  if (configPanel) {
    document.body.removeChild(configPanel);
  }

  if (keyConfigOutsideMouseDownHandler) {
    document.removeEventListener('mousedown', keyConfigOutsideMouseDownHandler);
    keyConfigOutsideMouseDownHandler = null;
  }

  isShowingKeyConfig = false;
}

// 在初始化时加载设置（在文件靠近底部添加调用）
// ...其他初始化代码...
loadUserSettings();

// =============================================
// UI交互增强 - 添加额外的交互功能
// =============================================
// 切换中间层的完整显示，并把选择保存为用户偏好。
function addHierarchyLevelsToggleEvents(notification) {
  const toggle = notification.querySelector('#toggle-middle-levels');
  if (!toggle) return;

  toggle.addEventListener('click', function(event) {
    event.stopPropagation();
    event.preventDefault();
    isHierarchyExpanded = !isHierarchyExpanded;
    try {
      chrome.storage.local.set({ 'batch-selector-hierarchy-expanded': isHierarchyExpanded });
    } catch (e) {
      /* 页面关闭时可能无法写入扩展存储；当前会话状态仍然有效。 */
    }
    updateNotification(selectedElements.length);
  });

  toggle.addEventListener('mouseover', function() {
    this.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
    this.style.color = '#fff';
  });
  toggle.addEventListener('mouseout', function() {
    this.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
    this.style.color = '#bbb';
  });
}

// =============================================
// 内部视图特殊处理 - 处理查看内部模式的特殊功能
// 这些函数与主功能平行，专门处理内部视图模式
// =============================================
// 新增函数：在查看内部模式下切换层级 (现在调用统一的updateNotification)
function switchToLevelInside(index) {
  if (index < 0 || index >= parentChain.length) {
    return;
  }
  parentChainIndex = index;
  const currentElement = parentChain[parentChainIndex];
  // 仅更新层级链和子元素，不退出内部查看
  collectChildrenChain(currentElement); // 确保子元素链是最新的
  updateNotification(selectedElements.length); // <--- 修改点 (刷新UI)
}

// 新增函数：在查看内部模式下执行层级匹配 (现在调用统一的updateNotification)
function selectByHierarchyInside(levelIndex) {
  selectByHierarchy(levelIndex);
}

// 新增函数：在查看内部模式下取消层级匹配 (现在调用统一的updateNotification)
function cancelHierarchyMatchInside() {
  cancelHierarchyMatch();
  if (selectedElements.length === 0) {
    isViewingChildren = false;
  }
}
