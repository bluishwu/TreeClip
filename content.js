/**
 * 批量元素选择器(Batch Selector) - 网页元素快速选择与内容提取工具
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
const t = (key, ...args) => {
  // 如果第一个参数是数组，则直接使用它作为占位符替换数组
  // 否则使用 args 数组本身
  const substitutions = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
  // chrome.i18n.getMessage 的第二个参数要求是字符串或字符串数组
  // 确保所有参数都转换为字符串
  const stringSubstitutions = Array.isArray(substitutions) 
    ? substitutions.map(String) 
    : String(substitutions);
  return chrome.i18n.getMessage(key, stringSubstitutions) || key;
};

// =============================================
// 全局状态管理 - 追踪用户交互和选中元素的状态变量
// =============================================
// 存储已点击的元素
let clickedElements = [];
// 是否正在按住Shift键
let isShiftPressed = false;
// 存储被选中的元素
let selectedElements = [];
// 存储当前使用的选择器
let currentSelector = '';
// 存储选择器的层级历史
let selectorHistory = [];
// 当前选择器在历史中的索引
let selectorHistoryIndex = -1;
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
let isRealtimeCopyEnabled = true; // 默认开启

// 自定义快捷键配置
let selectKeyConfig = { keys: ['Shift'] }; // 默认选择键为Shift
let typeSelectKeyConfig = { keys: ['f'] }; // 默认选择相同类型的键为F
let copyKeyConfig = { keys: ['Control', 'c'] }; // 默认复制组合键为Ctrl+C
let isShowingKeyConfig = false; // 是否正在显示快捷键配置面板
let isCapturingKeys = false; // 是否正在捕获按键
let currentCaptureTarget = ''; // 当前正在捕获按键的目标
let lastCaptureTarget = ''; // 最后一次捕获按键的目标，用于显示保存效果
let isCopyKeyPressed = false; // 跟踪复制键是否处于按下状态
let selectKeyCombinationActive = false; // 跟踪选择键组合是否已经激活

// UI状态：是否最小化
let isUIMinimized = false; // 默认为展开状态
// 是否隐藏相同元素类型检测提示
let hideTypePrompt = false;
// 元素层级是否展开显示
let isHierarchyExpanded = false;
// 输出格式区块是否展开
let isOutputFormatExpanded = false;
// 搜索区块是否展开
let isSearchExpanded = false;
// 快捷键配置区块是否展开
let isKeyConfigExpanded = false;

// =============================================
// 文本搜索相关状态变量
// =============================================
let searchTerm = ''; // 当前搜索的文本
let searchResults = []; // 存储搜索结果（元素）
let currentSearchResultIndex = -1; // 当前高亮的搜索结果索引

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
  // 如果没有配置键，返回false
  if (!keyConfig || !keyConfig.keys || keyConfig.keys.length === 0) {
    return false;
  }

  // 如果是选择键配置，且选择键组合已激活，直接返回true
  if (keyConfig === selectKeyConfig && selectKeyCombinationActive) {
    return true;
  }

  // 检查所有键是否都被按下
  // 对于修饰键，我们需要特殊处理
  for (const key of keyConfig.keys) {
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

  // 按下选择键
  const isSelectKeyPressed = isKeyCombinationPressed(event, selectKeyConfig);

  // 只有在之前未按下的情况下才设置状态
  if (isSelectKeyPressed && !isShiftPressed) {
    isShiftPressed = true;
    selectKeyCombinationActive = true; // 标记选择键组合已激活
    // 添加临时样式到body，用于鼠标样式
    document.body.classList.add('batch-selector-shift-pressed');

    // 记录当前按下的选择键组合
    //console.log('选择键组合已激活:', selectKeyConfig.keys.join('+'));
  }
  // 如果之前按下了但现在没有按下完整组合键，且没有其他键干扰，则释放状态
  else if (!isSelectKeyPressed && isShiftPressed && !selectKeyCombinationActive) {
    isShiftPressed = false;
    document.body.classList.remove('batch-selector-shift-pressed');

    // 如果正在框选，取消框选
    if (isSelecting) {
      cancelBoxSelection();
    }
  }

  // 处理复制组合键 - 复制已选中的内容
  const isCopyKeyCombinationPressed = isKeyCombinationPressed(event, copyKeyConfig);

  // 如果复制键被按下，且之前不是按下状态，且有选中元素
  if (isCopyKeyCombinationPressed && !isCopyKeyPressed && selectedElements.length > 0) {
    event.preventDefault();
    // 先获取处理后的文本
    const textToCopy = updateClipboard();
    // 然后强制写入剪贴板，无论实时复制是否开启
    if (textToCopy !== undefined && textToCopy !== null) { // 确保有内容可写
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
                // 显示复制成功提示
                showTemporaryMessage(t('msg_copied'));
            })
            .catch(() => {
                 showTemporaryMessage(t('msg_copy_failed'));
                // console.error('复制组合键复制失败');
            });
    } else {
        showTemporaryMessage(t('msg_no_content'));
    }
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
      (selectedElements.length > 0) &&
      (!isViewingChildren) && // 在查看子元素时不触发
      (document.activeElement?.id !== 'batch-selector-search-input')) { // 焦点不在搜索框时才触发
    event.preventDefault();
    selectAllElements();
  }

  // 快捷键: Shift+向上键 - 扩大选择范围（固定使用Shift键）
  if (event.shiftKey && event.key === 'ArrowUp' && selectedElements.length > 0) {
    event.preventDefault();
    moveUp();
  }

  // 快捷键: Shift+向下键 - 缩小选择范围（固定使用Shift键）
  if (event.shiftKey && event.key === 'ArrowDown' && selectedElements.length > 0) {
    event.preventDefault();
    moveDown();
  }

  // 快捷键: Shift+向右键 - 查看元素内部内容（固定使用Shift键）
  if (event.shiftKey && event.key === 'ArrowRight' && selectedElements.length > 0) {
    event.preventDefault();
    viewInside();
  }

  // 快捷键: Shift+向左键 - 返回父元素视图（固定使用Shift键）
  if (event.shiftKey && event.key === 'ArrowLeft' && isViewingChildren) {
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

  // 获取当前按键的标准化名称
  let keyName = event.key;

  // 标准化按键名称
  if (keyName === 'Control') keyName = 'Ctrl';
  if (keyName === ' ') keyName = 'Space';
  if (keyName === 'Meta') keyName = 'Meta';

  // 检查是否释放了选择键中的任何一个键
  if (selectKeyConfig && selectKeyConfig.keys) {
    // 检查释放的键是否在选择键配置中
    const keyInConfig = selectKeyConfig.keys.some(k => k.toLowerCase() === keyName.toLowerCase());

    // 检查修饰键特殊情况
    const isCtrlReleased = (keyName === 'Ctrl' && selectKeyConfig.keys.includes('Ctrl'));
    const isShiftReleased = (keyName === 'Shift' && selectKeyConfig.keys.includes('Shift'));
    const isAltReleased = (keyName === 'Alt' && selectKeyConfig.keys.includes('Alt'));
    const isMetaReleased = (keyName === 'Meta' && selectKeyConfig.keys.includes('Meta'));

    // 如果释放的是配置中的任何键，或者是修饰键特殊情况
    if (keyInConfig || isCtrlReleased || isShiftReleased || isAltReleased || isMetaReleased) {
      isShiftPressed = false;
      selectKeyCombinationActive = false; // 重置选择键组合状态
      // 移除临时样式
      document.body.classList.remove('batch-selector-shift-pressed');

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
    // 检查释放的键是否在复制键配置中
    const keyInConfig = copyKeyConfig.keys.some(k => k.toLowerCase() === keyName.toLowerCase());

    // 检查修饰键特殊情况
    const isCtrlReleased = (keyName === 'Ctrl' && copyKeyConfig.keys.includes('Ctrl'));
    const isShiftReleased = (keyName === 'Shift' && copyKeyConfig.keys.includes('Shift'));
    const isAltReleased = (keyName === 'Alt' && copyKeyConfig.keys.includes('Alt'));
    const isMetaReleased = (keyName === 'Meta' && copyKeyConfig.keys.includes('Meta'));

    // 如果释放的是配置中的任何键，或者是修饰键特殊情况
    if (keyInConfig || isCtrlReleased || isShiftReleased || isAltReleased || isMetaReleased) {
      // 重置复制键状态
      isCopyKeyPressed = false;
    }
  }
});

// 添加CSS样式
const style = document.createElement('style');
style.textContent = `
  .batch-selector-shift-pressed {
    cursor: crosshair !important;
  }
  .batch-selector-shift-pressed a,
  .batch-selector-shift-pressed button,
  .batch-selector-shift-pressed input,
  .batch-selector-shift-pressed [role="button"],
  .batch-selector-shift-pressed [onclick] {
    pointer-events: none;
  }
  .batch-selector-prevent-events {
    pointer-events: none !important;
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
`;
document.head.appendChild(style);

// 添加搜索高亮样式
const searchHighlightStyle = document.createElement('style');
searchHighlightStyle.textContent = `
  .batch-selector-text-highlight {
    background-color: rgba(255, 235, 59, 0.4) !important; /* 黄色背景高亮文本 */
    color: black !important;
    padding: 0 1px;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(255, 235, 59, 0.7);
  }
  .batch-selector-text-highlight-current {
    background-color: rgba(255, 152, 0, 0.5) !important; /* 橙色背景高亮当前文本 */
    color: black !important;
    box-shadow: 0 0 0 1px rgba(255, 152, 0, 0.8);
  }
  .batch-selector-attribute-highlight {
    outline: 2px dashed orange !important; /* 橙色虚线轮廓标记属性匹配 */
    box-shadow: 0 0 5px rgba(255, 165, 0, 0.5) !important;
  }
`;
document.head.appendChild(searchHighlightStyle);

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

    // 对于链接和按钮等交互元素，禁用点击行为
    if (event.target.tagName === 'A' ||
        event.target.tagName === 'BUTTON' ||
        event.target.tagName === 'INPUT' ||
        event.target.hasAttribute('onclick') ||
        event.target.getAttribute('role') === 'button') {
      event.target.classList.add('batch-selector-prevent-events');

      // 恢复正常行为的定时器
      setTimeout(() => {
        event.target.classList.remove('batch-selector-prevent-events');
      }, 500);
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
        el.style.outline = '2px solid blue';
        selectedElements.push(el);
      }
    });

    // 如果有选中元素，更新父元素链和当前类型
    if (selectedElements.length > 0) {
      // 使用第一个元素作为参考
      const firstElement = selectedElements[0];
      collectParentChain(firstElement);

      // 更新当前元素类型
      const tagName = firstElement.tagName.toLowerCase();
      const className = firstElement.className || '';
      currentElementTypeKey = `${tagName}.${className}`;
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
    // 跳过隐藏或无法交互的元素
    if (isElementHiddenOrDisabled(el)) {
      return;
    }

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
      if (isSignificantElement(el)) {
        preFilteredElements.push({
          element: el,
          depth: getElementDepth(el)
        });
      }
    }
  });

  // 按深度排序所有预筛选的元素（从浅到深）
  preFilteredElements.sort((a, b) => a.depth - b.depth);

  // 创建一个函数来检查两个元素是否存在嵌套关系
  const isNested = (parent, child) => {
    return parent.element.contains(child.element);
  };

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
function isElementHiddenOrDisabled(el) {
  const style = window.getComputedStyle(el);

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
function isSignificantElement(el) {
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
      window.getComputedStyle(el).cursor === 'pointer') {
    return true;
  }

  // 检查是否有意义的样式特征(如边框、背景色等)
  const style = window.getComputedStyle(el);
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

// 优化选择元素列表，移除嵌套的元素
function optimizeSelectedElements(elements) {
  if (elements.length <= 1) return elements;

  // 优先选择最浅层级的元素
  const optimized = [];

  // 将元素按DOM树深度排序
  const elementsWithDepth = elements.map(el => {
    // 计算元素在DOM树中的深度
    let depth = 0;
    let current = el;
    while (current && current !== document.documentElement) {
      depth++;
      current = current.parentElement;
    }
    return { element: el, depth: depth };
  });

  // 按深度排序，浅的在前面
  elementsWithDepth.sort((a, b) => a.depth - b.depth);

  // 跟踪已处理的元素
  const processed = new Set();

  // 优先考虑最浅层级的元素
  for (const { element } of elementsWithDepth) {
    if (processed.has(element)) continue;

    // 标记当前元素为已处理
    processed.add(element);

    // 检查这个元素是否覆盖了其他未处理的元素
    let hasNestedElements = false;

    for (const { element: otherElement } of elementsWithDepth) {
      if (otherElement !== element && !processed.has(otherElement)) {
        if (element.contains(otherElement)) {
          // 如果当前元素包含其他元素，标记该其他元素为已处理
          processed.add(otherElement);
          hasNestedElements = true;
        }
      }
    }

    // 添加当前元素到优化列表
    optimized.push(element);
  }

  return optimized;
}

// =============================================
// 用户反馈系统 - 提供视觉和听觉反馈
// =============================================
// 播放选择声音（可选）
function playSelectSound() {
  // 创建一个音频上下文
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // 创建一个振荡器
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // 设置音量
    gainNode.gain.value = 0.1;

    // 连接节点
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // 设置频率和类型
    oscillator.type = 'sine';
    oscillator.frequency.value = 600;

    // 设置衰减
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);

    // 播放音频
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
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
      clickedElement.style.outline = '';
      selectedElements.splice(index, 1);

      // 更新通知
      updateNotification(selectedElements.length);

      // 更新剪贴板
      updateClipboard();

      return;
    }
  }

  // 高亮显示点击的元素并添加到已选中列表
  clickedElement.style.outline = '2px solid blue';
  selectedElements.push(clickedElement);

  // 更新父元素链，记录最新点击元素的层级
  collectParentChain(clickedElement);

  // 更新当前选中的元素类型
  const tagName = clickedElement.tagName.toLowerCase();
  const className = clickedElement.className || '';
  currentElementTypeKey = `${tagName}.${className}`;

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
    className: element.className
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
    promptContainer.style.position = 'fixed';
    promptContainer.style.bottom = '20px';
    promptContainer.style.left = '20px'; // 改为左侧
    promptContainer.style.padding = '10px 15px'; // 减小内边距
    promptContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    promptContainer.style.color = 'white';
    promptContainer.style.borderRadius = '5px';
    promptContainer.style.zIndex = '10001';
    promptContainer.style.maxWidth = '350px';
    promptContainer.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
    promptContainer.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    promptContainer.style.fontSize = '14px';
    promptContainer.classList.add('batch-selector-ui');
    promptContainer.setAttribute('class', 'batch-selector-ui');

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

  // 生成对应的选择器
  let selector = elementInfo.tagName.toLowerCase();

  // 如果有类名，添加到选择器
  if (elementInfo.className) {
    const classes = elementInfo.className.split(' ');
    classes.forEach(cls => {
      if (cls.trim()) {
        selector += '.' + cls.trim();
      }
    });
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
  const typeSelectKeyText = typeSelectKeyConfig.keys.map(formatKeyForDisplay).join('+');

  // 显示提示内容 - 优化文本
  promptContainer.innerHTML = `
    <div style="margin-bottom: 8px;">
      <strong>${t('prompt_batch_select')}</strong>
    </div>
    <div style="margin-bottom: 10px; font-size: 13px;">
      ${t('prompt_batch_select_desc', elementDesc)}
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
      <button id="select-all-of-type-confirm" class="batch-selector-ui" style="padding: 4px 10px; background-color: rgba(255,255,255,0.3); border: none; color: white; border-radius: 3px; cursor: pointer; flex: 1;">${t('btn_select_all')} (${typeSelectKeyText})</button>
      <button id="select-all-of-type-cancel" class="batch-selector-ui" style="padding: 4px 10px; background-color: rgba(255,255,255,0.15); border: none; color: white; border-radius: 3px; cursor: pointer;">${t('btn_cancel')}</button>
      <label style="
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.8em;
        cursor: pointer;
        white-space: nowrap;
      ">
        <input type="checkbox" id="hide-type-prompt" class="batch-selector-ui" style="margin:0; transform: scale(0.85);">
        <span>${t('checkbox_dont_show')}</span>
      </label>
    </div>
  `;

  // 设置自动消失计时器
  const promptTimeout = setTimeout(() => {
    if (document.body.contains(promptContainer)) {
      document.body.removeChild(promptContainer);
    }
  }, 8000);

  // 添加按钮事件
  setTimeout(() => {
    const confirmButton = document.getElementById('select-all-of-type-confirm');
    const cancelButton = document.getElementById('select-all-of-type-cancel');
    const hidePromptCheckbox = document.getElementById('hide-type-prompt');

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
        clearTimeout(promptTimeout);

        // 检查是否选中了"不再提示"
        const hidePromptCheckbox = document.getElementById('hide-type-prompt');
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

        selectAllOfType(selector);
        document.body.removeChild(promptContainer);
      });
    }

    if (cancelButton) {
      cancelButton.classList.add('batch-selector-ui');
      cancelButton.addEventListener('click', function() {
        clearTimeout(promptTimeout);

        // 检查是否选中了"不再提示"
        const hidePromptCheckbox = document.getElementById('hide-type-prompt');
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

        document.body.removeChild(promptContainer);
      });
    }
  }, 0);
}

// 选择所有相同类型的元素
function selectAllOfType(selector) {
  // console.log('执行selectAllOfType，选择器:', selector);

  // 如果没有当前选中元素类型，则无法进行精确匹配
  if (!currentElementTypeKey) {
    // console.log('未指定当前元素类型，无法精确匹配');
    return;
  }

  // 解析当前元素类型
  const [targetTagName, targetClassName] = currentElementTypeKey.split('.');
  // console.log('目标元素类型:', targetTagName, '目标类名:', targetClassName);

  // 清除当前未匹配的元素
  const currentTypeElements = [];
  const otherElements = [];

  // 分离当前类型元素和其他元素
  selectedElements.forEach(el => {
    const elTagName = el.tagName.toLowerCase();
    const elClassName = el.className || '';

    // 检查是否匹配当前类型
    if (elTagName === targetTagName && elClassName === targetClassName) {
      currentTypeElements.push(el);
    } else {
      otherElements.push(el);
      // 不再清除其他元素的高亮，保留所有已选中元素的蓝框
      // 确保元素仍然有高亮样式
      if (el && el.style && !el.style.outline) {
        el.style.outline = '2px solid blue';
      }
    }
  });

  // 在文档中查找所有具有相同标签的元素
  const allTagElements = document.querySelectorAll(targetTagName);
  // console.log(`找到 ${allTagElements.length} 个标签为 ${targetTagName} 的元素`);

  // 已选元素映射，避免重复添加
  const selectedMap = new Map();
  currentTypeElements.forEach(el => selectedMap.set(el, true));
  otherElements.forEach(el => selectedMap.set(el, true)); // 确保所有已选元素都在映射中

  // 选择具有完全相同类的元素
  let newSelectedCount = 0;

  allTagElements.forEach(el => {
    const elClassName = el.className || '';

    // 严格匹配：确保类名完全相同，而不是部分匹配
    if (elClassName === targetClassName) {
      // 如果元素已在当前选择中，跳过
      if (selectedMap.has(el)) {
        return;
      }

      // 添加到选中列表并高亮
      el.style.outline = '2px solid blue';
      currentTypeElements.push(el);
      newSelectedCount++;
    }
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
    currentElementTypeKey = `${lastElement.tagName.toLowerCase()}.${lastElement.className || ''}`;
    // console.log('设置当前元素类型为:', currentElementTypeKey);
  }

  // 直接调用选择相同类型元素的方法
  selectAllOfType(currentElementTypeKey);
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
  childrenChain = [];

  // 添加直接子元素
  let children = Array.from(element.children);
  if (children.length > 0) {
    childrenChain = childrenChain.concat(children);

    // 查找特定子元素，如链接
    const linkElements = element.querySelectorAll('a');
    if (linkElements.length > 0) {
      // 如果已有，则不重复添加
      linkElements.forEach(link => {
        if (!childrenChain.includes(link) && link.parentNode === element) {
          childrenChain.push(link);
        }
      });
    }

    // 查找有文本内容的子元素
    const textContainers = Array.from(element.querySelectorAll('*')).filter(el =>
      el.textContent.trim() &&
      !childrenChain.includes(el) &&
      el.children.length === 0 &&
      el.parentNode === element
    );

    if (textContainers.length > 0) {
      childrenChain = childrenChain.concat(textContainers);
    }
  }
}

// 查看元素内部内容
function viewInside() {
  if (selectedElements.length === 0) return;

  // 获取当前选中元素
  let referenceElement = null;

  // 如果有特定元素类型被选中，使用该类型的第一个元素
  if (currentElementTypeKey) {
    const [tagName, className] = currentElementTypeKey.split('.');

    // 查找第一个匹配的元素
    for (const el of selectedElements) {
      if (el.tagName.toLowerCase() === tagName &&
          (el.className || '') === className) {
        referenceElement = el;
        break;
      }
    }
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

  // 每次进入查看内部时，重置层级展开状态为折叠
  isHierarchyExpanded = false;

  // 标记正在查看子元素
  isViewingChildren = true;

  // 更新通知，显示子元素列表 (调用合并后的函数)
  updateNotification(selectedElements.length); // <--- 修改点
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
    // 获取当前类型的所有元素
    const [tagName, className] = currentElementTypeKey.split('.');
    const typeElements = [];

    // 找出所有匹配当前类型的元素
    for (let i = 0; i < selectedElements.length; i++) {
      const el = selectedElements[i];
      if (el.tagName.toLowerCase() === tagName &&
          (el.className || '') === className) {
        typeElements.push(el);
        // 清除原元素的蓝框高亮
        el.style.outline = '';
      }
    }

    // 从选中列表中移除当前类型的元素
    selectedElements = selectedElements.filter(el =>
      !(el.tagName.toLowerCase() === tagName &&
        (el.className || '') === className)
    );

    // 获取子元素的标签和类名
    const childTagName = childElement.tagName.toLowerCase();
    const childClassName = childElement.className || '';
    const newTypeKey = `${childTagName}.${childClassName}`;

    // 只在当前选中元素内部查找匹配的子元素，而不是在整个文档中查找
    const matchingChildElements = [];

    // 遍历每个当前类型的元素，查找其内部的匹配子元素
    typeElements.forEach(parentEl => {
      // 构建一个选择器，只查找当前父元素内部的匹配子元素
      let childSelector = childTagName;
      if (childClassName) {
        const classes = childClassName.split(' ');
        classes.forEach(cls => {
          if (cls.trim()) {
            childSelector += `.${cls.trim()}`;
          }
        });
      }

      // 在父元素内部查询
      const childrenOfParent = parentEl.querySelectorAll(childSelector);
      childrenOfParent.forEach(child => {
        if (!matchingChildElements.includes(child)) {
          matchingChildElements.push(child);
        }
      });
    });

    // 添加匹配的子元素到选中列表
    matchingChildElements.forEach(el => {
      el.style.outline = '2px solid blue';
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
    if (element.className) {
      const classes = element.className.split(' ');
      for (const cls of classes) {
        if (cls.trim()) {
          selector += `.${cls.trim()}`;
        }
      }
      return selector;
    }

    // 如果链接有title属性，使用部分title作为选择器
    if (element.title) {
      return `${selector}[title*="${element.title.split('.')[0]}"]`;
    }

    // 如果链接文本不空，使用文本内容作为选择器
    if (text) {
      // 如果文本有明显特征（如域名），使用部分文本作为选择器
      const domainMatch = text.match(/([a-zA-Z0-9-]+)\.[a-zA-Z]{2,}(\.[a-zA-Z]{2,})?/);
      if (domainMatch) {
        const domainPart = domainMatch[1];
        return `${selector}:contains("${domainPart}")`;
      }

      // 否则使用整个文本
      return `${selector}:contains("${text}")`;
    }
  }

  // 添加ID（如果有）
  if (element.id) {
    return `${selector}#${element.id}`;
  }

  // 添加类名（如果有）
  if (element.className) {
    const classes = element.className.split(' ');
    classes.forEach(cls => {
      if (cls.trim()) {
        selector += `.${cls.trim()}`;
      }
    });
  }

  return selector;
}

// 为特定元素生成选择器
function generateSelectorForSpecificElement(element) {
  let selector = element.tagName.toLowerCase();

  // 添加ID（如果有）
  if (element.id) {
    return `${selector}#${element.id}`;
  }

  // 添加类名（如果有）
  if (element.className) {
    const classes = element.className.split(' ');
    classes.forEach(cls => {
      if (cls.trim()) {
        selector += `.${cls.trim()}`;
      }
    });
  }

  // 尝试添加其他特性，如链接的href部分特征
  if (selector === 'a' && element.href) {
    // 提取URL中的一部分作为选择器，如域名或路径特征
    try {
      const url = new URL(element.href);
      const domain = url.hostname;
      if (domain) {
        selector += `[href*="${domain}"]`;
      }
    } catch(e) {
      // URL解析失败，则尝试使用其他特征
      if (element.getAttribute('href')) {
        const href = element.getAttribute('href');
        if (href.startsWith('/')) {
          // 对于站内链接
          selector += `[href^="${href.split('/').slice(0, 2).join('/')}"]`;
        }
      }
    }
  }

  return selector;
}

// 添加jQuery-like的contains选择器实现
function setupCustomSelectors() {
  // 为文档添加一个自定义查询方法，支持:contains选择器
  document.querySelectorForAll = function(selector) {
    // 检查选择器是否包含:contains
    if (selector.includes(':contains(')) {
      const parts = selector.split(':contains(');
      const baseSelector = parts[0];
      const searchText = parts[1].slice(0, -1).replace(/"/g, '');

      // 获取基础选择器的元素
      const baseElements = document.querySelectorAll(baseSelector);

      // 过滤包含指定文本的元素
      return Array.from(baseElements).filter(el =>
        el.textContent.includes(searchText)
      );
    }

    // 如果不包含特殊选择器，使用标准查询
    return document.querySelectorAll(selector);
  };
}

// 在页面加载时设置自定义选择器
setupCustomSelectors();

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
        el.style.outline = '';
      }
    });
    selectedElements = [];
  }

  // 更新当前选择器
  currentSelector = newSelector;

  // 添加到历史
  selectorHistory.push(currentSelector);
  selectorHistoryIndex = selectorHistory.length - 1;

  // 检查是否使用自定义选择器
  let newSelectedElements;
  if (newSelector.includes(':contains(')) {
    // 使用自定义查询方法
    newSelectedElements = document.querySelectorForAll(newSelector);
  } else {
    // 使用标准查询方法
    newSelectedElements = document.querySelectorAll(newSelector);
  }

  // 重置选中元素
  selectedElements = [];

  // 高亮并收集所有相似元素的文本
  newSelectedElements.forEach(el => {
    el.style.outline = '2px solid blue';
    selectedElements.push(el);
  });

  // 尝试自动检测是否有单一链接元素
  let hasAutoDetectedLinks = false;
  if (!isViewingChildren && selectedElements.length > 0) {
    // 检查第一个元素是否只有一个链接子元素
    const firstElement = selectedElements[0];
    const linkElements = firstElement.querySelectorAll('a');

    if (linkElements.length === 1) {
      const linkSelector = generateSelectorForSpecificElement(linkElements[0]);

      // 检查这个选择器是否能在所有选中元素中找到相似结构
      let allHaveSimilarLink = true;

      for (let i = 1; i < selectedElements.length; i++) {
        const links = selectedElements[i].querySelectorAll('a');
        if (links.length !== 1) {
          allHaveSimilarLink = false;
          break;
        }
      }

      if (allHaveSimilarLink) {
        showAutoDetectLink();
        hasAutoDetectedLinks = true;
      }
    }
  }

  // 更新剪贴板
  updateClipboard();

  // 更新通知 (统一调用 updateNotification)
  updateNotification(newSelectedElements.length); // <--- 修改点 (原先这里有 if/else 判断)
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

  // 如果当前元素类型的元素已经不存在，更新当前元素类型
  if (currentElementTypeKey) {
    const [tagName, className] = currentElementTypeKey.split('.');
    const typeElements = selectedElements.filter(el =>
      el.tagName.toLowerCase() === tagName &&
      (el.className || '') === className
    );

    // 如果当前类型的元素已经不存在，使用第一个选中元素的类型
    if (typeElements.length === 0) {
      // 清除当前元素类型的匹配层级索引
      delete matchedLevelIndices[currentElementTypeKey];

      const firstElement = selectedElements[0];
      currentElementTypeKey = `${firstElement.tagName.toLowerCase()}.${firstElement.className || ''}`;

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
    currentElementTypeKey = `${firstElement.tagName.toLowerCase()}.${firstElement.className || ''}`;

    // 更新父元素链
    collectParentChain(firstElement);
  }

  // 创建新通知
  const notification = document.createElement('div');
  notification.id = 'batch-selector-notification';
  notification.className = 'batch-selector-ui';

  // 设置通知样式
  if (isUIMinimized) {
    // =============================
    // 最小化状态 UI 渲染
    // =============================
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.left = '20px';
    notification.style.padding = '10px 12px';
    notification.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    notification.style.color = 'white';
    notification.style.borderRadius = '5px';
    notification.style.zIndex = '10000';
    notification.style.width = 'auto';
    notification.style.height = 'auto';
    notification.style.display = 'flex';
    notification.style.alignItems = 'center';
    notification.style.justifyContent = 'center';
    notification.style.cursor = 'pointer';
    notification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
    notification.style.fontFamily = 'system-ui, -apple-system, sans-serif';

    notification.innerHTML = `
      <div title="${t('ui_selected_count', count)} (${t('ui_click_to_expand')})" style="display: flex; align-items: center; gap: 8px;">
        <div style="font-size: 12px;">${t('ui_selected_elements')}</div>
        <div style="font-weight: bold; font-size: 15px;">${count}</div>
        <div style="margin-left: 5px; opacity: 0.7; font-size: 12px;">▼</div>
      </div>
    `;

    // 添加到文档
    document.body.appendChild(notification);

    // === 最小化状态事件监听 ===
    notification.addEventListener('click', function() {
      isUIMinimized = false;
      try {
        chrome.storage.local.set({'batch-selector-ui-minimized': false});
        // console.log('UI状态已保存为完整显示');
      } catch (e) {
        // console.error('无法保存UI状态:', e);
      }
      updateNotification(count); // 重新渲染为完整状态
    });
    // 最小化状态下不需要其他监听器

  } else {
    // =============================
    // 完整状态 UI 渲染
    // =============================
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.left = '20px';
    notification.style.padding = '10px 15px';
    notification.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    notification.style.color = 'white';
    notification.style.borderRadius = '5px';
    notification.style.zIndex = '10000';
    notification.style.maxWidth = '380px';
    notification.style.maxHeight = '80vh';
    notification.style.overflowY = 'auto';
    notification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
    notification.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    notification.style.fontSize = '14px';

    // --- 构建通用部分 ---
    let hierarchyHTML = '';
    if (parentChain.length > 0) {
      // (元素层级HTML生成逻辑 - 从原 updateNotification / updateChildrenNotification 提取并统一)
      hierarchyHTML = '<div style="margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 6px;">';
      hierarchyHTML += `
        <div style="margin-bottom: 6px; font-size: 0.9em; display: flex; justify-content: space-between; align-items: center;">
          <span>${t('ui_hierarchy')}:</span>
          <span id="hierarchy-toggle" class="batch-selector-ui" style="cursor: pointer; font-size: 0.8em; color: #aaa; user-select: none;">
            ${isHierarchyExpanded ? t('ui_collapse') : t('ui_expand')}
          </span>
        </div>
      `; // 注意这里是反引号 `
      hierarchyHTML += '<div style="display: flex; flex-direction: column; gap: 2px;">';
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
              <div id="show-more-levels" class="batch-selector-ui" style="display: inline-flex; align-items: center; justify-content: center; padding: 4px 14px; background-color: rgba(255, 255, 255, 0.08); border-radius: 15px; font-size: 0.85em; cursor: pointer; color: #bbb; border: 1px dashed rgba(180, 180, 180, 0.4); gap: 8px; position: relative; margin-left: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: all 0.2s ease; z-index: 1;">
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
        else if (el.className) { const mainClass = el.className.split(' ')[0]; if (mainClass) { desc += `.${mainClass}`; } }
        const { level, indent } = getAdjustedLevelIndent(j, i, needCollapse, parentChain);
        const isCurrentLevel = i === parentChainIndex;
        const isMatchedLevel = matchedLevelIndices[currentElementTypeKey] === i;
        hierarchyHTML += `
          <div style="margin-bottom: 3px;">
            <div style="display: flex; align-items: center;">
              <div style="width: ${indent}px; flex-shrink: 0;"></div>
              ${level > 0 ? '<span style="margin-right: 5px; color: rgba(180, 180, 180, 0.6); font-size: 0.85em;">└─</span>' : ''}
              <span class="level-selector batch-selector-ui" data-level="${i}" data-current="${isCurrentLevel}" data-matched="${isMatchedLevel}" style="display: inline-flex; align-items: center; padding: 3px 8px; background-color: ${isCurrentLevel ? 'rgba(66, 133, 244, 0.8)' : isMatchedLevel ? 'rgba(247, 152, 29, 0.8)' : 'rgba(255, 255, 255, 0.08)'}; border-radius: 4px; font-size: 0.85em; cursor: pointer; ${isCurrentLevel || isMatchedLevel ? 'font-weight: bold;' : ''} transition: all 0.2s ease; box-shadow: ${isCurrentLevel || isMatchedLevel ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 2px rgba(0,0,0,0.1)'}; color: ${isCurrentLevel || isMatchedLevel ? 'white' : '#ddd'}; border: 1px solid ${isCurrentLevel ? 'rgba(66, 133, 244, 0.6)' : isMatchedLevel ? 'rgba(247, 152, 29, 0.6)' : 'transparent'};">
                <span style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${desc}</span>
                ${isCurrentLevel ? ` <span style="margin-left: 5px; color: #8effb7; font-size: 0.9em; display: inline-flex; align-items: center;"><span style="margin-right: 2px;">✓</span>${t('ui_current')}</span>` : ''}
                ${isMatchedLevel ? ` <span style="margin-left: 5px; color: #ffcc80; font-size: 0.9em; display: inline-flex; align-items: center;"><span style="margin-right: 2px;">⊙</span>${t('ui_match')}</span>` : ''}
                ${i === 0 ? ` <span style="margin-left: 5px; color: #ffcc80; font-size: 0.85em; background: rgba(255,150,30,0.15); padding: 1px 4px; border-radius: 3px;">${t('ui_bottom')}</span>` : ''}
                ${i === parentChain.length - 1 ? ` <span style="margin-left: 5px; color: #ffcc80; font-size: 0.85em; background: rgba(255,150,30,0.15); padding: 1px 4px; border-radius: 3px;">${t('ui_top')}</span>` : ''}
              </span>
            </div>
          </div>
        `; // 注意这里是反引号 `
      }
      hierarchyHTML += '</div></div>';
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
        childrenHTML += `<div style="margin-bottom: 8px;">${t('ui_internal_elements')} <small>(${t('ui_click_to_select')})</small>:</div>`;
        childrenHTML += '<div style="display: flex; flex-direction: column;">';
        childrenChain.forEach((el, index) => {
          const tag = el.tagName.toLowerCase();
          let desc = tag;
          if (el.id) { desc += `#${el.id}`; }
          else if (el.className) { const mainClass = el.className.split(' ')[0]; if (mainClass) { desc += `.${mainClass}`; } }
          let preview = '';
          if (el.textContent) { const text = el.textContent.trim(); preview = text.length > 25 ? text.substring(0, 25) + '...' : text; if (preview) { preview = ` - "${preview}"`; } }
          childrenHTML += `
            <div style="margin-bottom: 4px;">
              <span class="child-selector batch-selector-ui" data-index="${index}" style="display: inline-block; padding: 3px 8px; background-color: rgba(255, 255, 255, 0.1); border-radius: 3px; font-size: 0.85em; cursor: pointer;">
                ${desc}${preview}
              </span>
            </div>
          `; // 注意这里是反引号 `
        });
        childrenHTML += '</div></div>';
      }

      contentHTML = `
        <div>${t('ui_viewing_internal')}</div>
        <div style="font-size: 0.9em; margin: 5px 0; text-align: left; color: #aaa;">${t('ui_internal_desc')}</div>
        ${childrenHTML}
        ${hierarchyHTML}
        <div style="font-size: 0.8em; margin-top: 8px; color: #aaa;">${t('ui_shortcut_nav_hint')}</div>
      `; // 注意这里是反引号 `

      buttonsHTML = `
        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <button id="batch-selector-back" class="batch-selector-ui" style="padding: 4px 8px; background-color: #444; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 0.85em;">← ${t('ui_btn_back')}</button>
          <button id="batch-selector-cancel" class="batch-selector-ui" style="padding: 4px 8px; background-color: #555; border: none; color: white; border-radius: 3px; cursor: pointer; margin-left: auto; font-size: 0.85em;">${t('ui_btn_cancel')} ✕</button>
        </div>
      `; // 注意这里是反引号 `

    } else {
      // =============================
      // 主界面模式 UI 内容
      // =============================
      let selectorInfo = '';
      if (currentSelector) {
        selectorInfo = `<div style="font-size: 0.85em; margin: 4px 0; text-align: left;">${t('ui_current_selector')}: <code>${currentSelector}</code></div>`;
      }

      let selectedTypesHTML = '';
      if (selectedElements.length > 0) {
        const elementTypes = {};
        selectedElements.forEach(el => {
          const tagName = el.tagName.toLowerCase(); const className = el.className || ''; const key = `${tagName}.${className}`;
          if (!elementTypes[key]) { elementTypes[key] = { count: 0, tagName: tagName, className: className, element: el }; }
        elementTypes[key].count++;
      });
      if (Object.keys(elementTypes).length > 0) {
          selectedTypesHTML = '<div style="margin-top: 6px;">';
          if (window.clickedElementInfo) {
            selectedTypesHTML += `<div style="font-size: 0.9em; margin-bottom: 8px;">${t('ui_current_element')}: <code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px; font-size: 0.9em;">${window.clickedElementInfo.info}</code></div>`;
          }
          selectedTypesHTML += `<div style="margin-bottom: 6px; font-size: 0.9em; display: flex; align-items: center; justify-content: space-between;">
                                  <span>${t('ui_selected')}: <span style="font-weight: bold;">${count}</span></span>
                                  <button id="batch-selector-copy-btn" class="batch-selector-ui" title="${t('ui_copy_title')}" style="padding: 2px 8px; background-color: rgba(66, 133, 244, 0.7); border: 1px solid rgba(66, 133, 244, 1); color: white; border-radius: 4px; cursor: pointer; font-size: 0.8em; margin-left: 10px;">${t('ui_btn_copy')}</button>
                               </div>`;
          for (const key in elementTypes) {
            const typeInfo = elementTypes[key]; let typeName = typeInfo.tagName;
            if (typeInfo.className) { const displayClassName = typeInfo.className.length > 15 ? typeInfo.className.substring(0, 15) + '...' : typeInfo.className; typeName += `.${displayClassName}`; }
          const isCurrentType = currentElementTypeKey === key;
          selectedTypesHTML += `
              <div class="element-type-selector batch-selector-ui" data-type="${key}" style="margin-bottom: 4px; padding: 3px 8px; background-color: ${isCurrentType ? 'rgba(76, 175, 80, 0.5)' : 'rgba(255, 255, 255, 0.1)'}; border-radius: 10px; font-size: 0.85em; cursor: pointer; display: inline-block; margin-right: 4px;">
              ${typeName} <span style="opacity: 0.7;">(${typeInfo.count})</span>
            </div>
            `; // 注意这里是反引号 `
        }
        selectedTypesHTML += '</div>';
      }
    }

    // 定义"输出格式"区块，包含折叠功能和原内容
    const outputFormatHTML = `
      <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 10px;">
        <div id="output-format-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: ${isOutputFormatExpanded ? '6px' : '0'};">
          <span style="font-size: 0.9em;">${t('ui_output_settings')}</span>
          <span class="toggle-arrow" style="font-size: 0.8em;">${isOutputFormatExpanded ? '▼' : '▶'}</span>
            </div>
        <div id="output-format-content" style="display: ${isOutputFormatExpanded ? 'block' : 'none'};">
          <!-- 修改剪贴板格式布局为单行 -->
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 6px;">
            <div style="font-size: 0.9em; flex-shrink: 0;">${t('ui_clipboard_sep')}:</div>
        <div style="display: flex; gap: 6px;">
                <label style="display: inline-block; padding: 3px 8px; background-color: ${clipboardFormat === 'newline' ? 'rgba(66, 133, 244, 0.8)' : 'rgba(255, 255, 255, 0.1)'}; border-radius: 10px; font-size: 0.8em; cursor: pointer;"><input type="radio" name="clipboardFormat" value="newline" style="display:none;" ${clipboardFormat === 'newline' ? 'checked' : ''}>${t('ui_sep_newline')}</label>
                <label style="display: inline-block; padding: 3px 8px; background-color: ${clipboardFormat === 'space' ? 'rgba(66, 133, 244, 0.8)' : 'rgba(255, 255, 255, 0.1)'}; border-radius: 10px; font-size: 0.8em; cursor: pointer;"><input type="radio" name="clipboardFormat" value="space" style="display:none;" ${clipboardFormat === 'space' ? 'checked' : ''}>${t('ui_sep_space')}</label>
                <label style="display: inline-block; padding: 3px 8px; background-color: ${clipboardFormat === 'comma' ? 'rgba(66, 133, 244, 0.8)' : 'rgba(255, 255, 255, 0.1)'}; border-radius: 10px; font-size: 0.8em; cursor: pointer;"><input type="radio" name="clipboardFormat" value="comma" style="display:none;" ${clipboardFormat === 'comma' ? 'checked' : ''}>${t('ui_sep_comma')}</label>
        </div>
      </div>
          <div style="margin-top: 8px; font-size: 0.9em; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">${t('ui_clean_options')}:</div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 8px; margin-top: 6px;">
            <label style="display: flex; align-items: center; gap: 4px; padding: 2px 0; font-size: 0.8em; cursor: pointer;"><input type="checkbox" id="removeInternalSpaces" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeInternalSpaces ? 'checked' : ''} style="margin:0; transform: scale(0.85);"><span>${t('ui_clean_spaces')}</span></label>
            <label style="display: flex; align-items: center; gap: 4px; padding: 2px 0; font-size: 0.8em; cursor: pointer;"><input type="checkbox" id="removeCodePatterns" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeCodePatterns ? 'checked' : ''} style="margin:0; transform: scale(0.85);"><span>${t('ui_clean_code')}</span></label>
            <label style="display: flex; align-items: center; gap: 4px; padding: 2px 0; font-size: 0.8em; cursor: pointer;"><input type="checkbox" id="removeSymbols" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeSymbols ? 'checked' : ''} style="margin:0; transform: scale(0.85);"><span>${t('ui_clean_symbols')}</span></label>
            <label style="display: flex; align-items: center; gap: 4px; padding: 2px 0; font-size: 0.8em; cursor: pointer;"><input type="checkbox" id="removeEnglish" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeEnglish ? 'checked' : ''} style="margin:0; transform: scale(0.85);"><span>${t('ui_clean_english')}</span></label>
            <label style="display: flex; align-items: center; gap: 4px; padding: 2px 0; font-size: 0.8em; cursor: pointer;"><input type="checkbox" id="removeChinese" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeChinese ? 'checked' : ''} style="margin:0; transform: scale(0.85);"><span>${t('ui_clean_chinese')}</span></label>
            <label style="display: flex; align-items: center; gap: 4px; padding: 2px 0; font-size: 0.8em; cursor: pointer;"><input type="checkbox" id="removeNumbers" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeNumbers ? 'checked' : ''} style="margin:0; transform: scale(0.85);"><span>${t('ui_clean_numbers')}</span></label>
          </div>
          <div style="margin-top: 8px; display: flex; align-items: center; gap: 8px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">
             <div style="font-size: 0.9em; flex-shrink: 0;">${t('ui_clean_duplicates')}:</div>
             <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8em; cursor: pointer;"><input type="checkbox" id="removeDuplicates" class="batch-selector-ui batch-selector-cleanup-checkbox" ${removeDuplicates ? 'checked' : ''} style="margin:0; transform: scale(0.85);"><span>${t('ui_clean_duplicates')}</span></label>
          </div>
          <!-- 新增：实时复制选项 -->
          <div style="margin-top: 8px; display: flex; align-items: center; gap: 8px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">
             <div style="font-size: 0.9em; flex-shrink: 0;">${t('ui_realtime_copy')}:</div>
             <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8em; cursor: pointer;"><input type="checkbox" id="realtimeCopyEnabled" class="batch-selector-ui" ${isRealtimeCopyEnabled ? 'checked' : ''} style="margin:0; transform: scale(0.85);"><span>${t('ui_realtime_copy_desc')}</span></label>
          </div>
        </div>
      </div>
    `;

    // 定义"文本搜索"区块，调整收起状态的边距
    const searchHTML = `
      <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 10px;">
        <div id="search-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: ${isSearchExpanded ? '6px' : '0'};">
          <div style="display: flex; align-items: center;">
            <span style="font-size: 0.9em;">${t('ui_search_title')}</span>
            <span id="search-help-icon" class="batch-selector-ui" title="${t('ui_search_help')}" style="
              margin-left: 5px;
              display: inline-flex;
              justify-content: center;
              align-items: center;
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: rgba(255,255,255,0.2);
              color: white;
              font-size: 10px;
              cursor: help;
              font-weight: bold;
            ">?</span>
          </div>
          <span class="toggle-arrow" style="font-size: 0.8em;">${isSearchExpanded ? '▼' : '▶'}</span>
      </div>
        <div id="search-content" style="display: ${isSearchExpanded ? 'block' : 'none'}">
          <div style="margin-bottom: 6px; font-size: 0.9em; display: flex; justify-content: space-between; align-items: center;">
             <span id="batch-selector-search-count" style="font-size: 0.9em; color: #ccc;"></span>
          </div>
          <div style="display: flex; gap: 5px; align-items: center;">
            <input type="text" id="batch-selector-search-input" placeholder="${t('ui_search_input_placeholder')}" value="${searchTerm}" style="flex-grow: 1; padding: 4px 6px; border-radius: 3px; border: 1px solid #555; background-color: #333; color: white; font-size: 0.9em;" class="batch-selector-ui">
            <button id="batch-selector-search-btn" style="padding: 4px 8px; background-color: #4CAF50; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 0.85em;" class="batch-selector-ui">${t('ui_search_btn')}</button>
          </div>
          <div id="batch-selector-search-results-nav" style="margin-top: 5px; display: flex; justify-content: space-between; align-items: center; font-size: 0.85em; color: #ccc; min-height: 20px;">
            <div>
              <button id="batch-selector-search-prev" style="padding: 2px 8px; background-color: #555; border: none; color: white; border-radius: 3px; cursor: pointer; margin-right: 4px;" class="batch-selector-ui" disabled>${t('ui_search_prev')}</button>
              <button id="batch-selector-search-next" style="padding: 2px 8px; background-color: #555; border: none; color: white; border-radius: 3px; cursor: pointer;" class="batch-selector-ui" disabled>${t('ui_search_next')}</button>
            </div>
            <button id="batch-selector-search-add-all" style="padding: 2px 6px; background-color: #2196F3; border: none; color: white; border-radius: 3px; cursor: pointer;" class="batch-selector-ui" disabled>${t('ui_search_add_all')}</button>
          </div>
          <div style="margin-top: 5px; display: none;">
            <button id="batch-selector-search-add-all-original" style="width: 100%; padding: 4px 8px; background-color: #2196F3; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 0.85em;" class="batch-selector-ui" disabled>${t('ui_search_add_all')}</button>
          </div>
        </div>
      </div>
    `;

      // 移除 guideButtonHTML 的旧定义，因为它是固定的，可以在后面直接使用
      // const guideButtonHTML = ...

      // 更新 contentHTML，使用新的 outputFormatHTML 和 searchHTML
      contentHTML = `
      ${selectorInfo}
      ${selectedTypesHTML}
      ${hierarchyHTML}
      ${searchHTML}
      ${outputFormatHTML}
      `; // 注意这里是反引号 `

      // 更新 buttonsHTML，添加分隔符和条件样式
      const hasChildren = childrenChain && childrenChain.length > 0;
      const insideButtonStyle = hasChildren
          ? 'padding: 4px 8px; background-color: #4CAF50; border: 1px solid #66BB6A; color: white; border-radius: 3px; cursor: pointer; font-size: 0.85em; box-shadow: 0 0 5px rgba(76, 175, 80, 0.7);'
          : 'padding: 4px 8px; background-color: #444; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 0.85em;';
      buttonsHTML = `
      <div style="display: flex; gap: 8px; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 10px;">
        <button id="batch-selector-inside" class="batch-selector-ui" style="${insideButtonStyle}">${t('ui_btn_internal')}</button>
        <button id="batch-selector-guide" class="batch-selector-ui" style="padding: 4px 8px; background-color: #444; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 0.85em;">${t('ui_btn_guide')}</button>
        <button id="batch-selector-key-config-btn" class="batch-selector-ui" style="padding: 4px 8px; background-color: #444; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 0.85em;">${t('ui_btn_shortcuts')}</button>
        <button id="batch-selector-cancel" class="batch-selector-ui" style="padding: 4px 8px; background-color: #555; border: none; color: white; border-radius: 3px; cursor: pointer; margin-left: auto; font-size: 0.85em;">${t('ui_btn_cancel')} ✕</button>
      </div>
      `;
    }

    // --- 组装完整UI ---
    notification.innerHTML = `
      <div style="position: relative;">
        <button id="batch-selector-minimize" class="batch-selector-ui" style="position: absolute; top: 0; right: 0; padding: 2px 8px; background-color: #555; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 0.8em;">${t('ui_btn_minimize')} ◢</button>
        ${contentHTML}
      ${buttonsHTML}
      </div>
    `; // 注意这里是反引号 `

  // 添加到文档
  document.body.appendChild(notification);

    // =============================
    // 统一事件监听器绑定
    // =============================
    setTimeout(() => {
      // --- 通用监听器 ---
      addLevelSelectorsClickEvents(notification);
      addExpandLevelsEvents(notification); // 处理 "省略几层"

      // --- 移除旧的直接绑定 ---
      /*
      const outputFormatHeader = document.getElementById('output-format-header');
      const outputFormatContent = document.getElementById('output-format-content');
      if (outputFormatHeader && outputFormatContent) {
        outputFormatHeader.addEventListener('click', () => {
          isOutputFormatExpanded = !isOutputFormatExpanded;
          outputFormatContent.style.display = isOutputFormatExpanded ? 'block' : 'none';
          outputFormatHeader.querySelector('.toggle-arrow').textContent = isOutputFormatExpanded ? '▼' : '▶';
        });
      }

      const searchHeader = document.getElementById('search-header');
      const searchContent = document.getElementById('search-content');
      if (searchHeader && searchContent) {
        searchHeader.addEventListener('click', () => {
          isSearchExpanded = !isSearchExpanded;
          searchContent.style.display = isSearchExpanded ? 'block' : 'none';
          searchHeader.querySelector('.toggle-arrow').textContent = isSearchExpanded ? '▼' : '▶';
        });
      }
      */
      // --- 移除旧的直接绑定结束 ---

      // --- 添加事件委托处理展开/折叠 ---
      notification.addEventListener('click', function(event) {
        const target = event.target;

        // 处理输出格式展开/折叠
        const outputFormatHeader = target.closest('#output-format-header');
        if (outputFormatHeader) {
          const outputFormatContent = notification.querySelector('#output-format-content'); // 从 notification 内部查找
          if (outputFormatContent) {
            isOutputFormatExpanded = !isOutputFormatExpanded;
            outputFormatContent.style.display = isOutputFormatExpanded ? 'block' : 'none';
            // 更新箭头图标
            const arrow = outputFormatHeader.querySelector('.toggle-arrow');
            if(arrow) arrow.textContent = isOutputFormatExpanded ? '▼' : '▶';
          }
        }

        // 处理搜索区展开/折叠
        const searchHeader = target.closest('#search-header');
        if (searchHeader) {
           const searchContent = notification.querySelector('#search-content'); // 从 notification 内部查找
           if (searchContent) {
             isSearchExpanded = !isSearchExpanded;
             searchContent.style.display = isSearchExpanded ? 'block' : 'none';
             // 更新箭头图标
             const arrow = searchHeader.querySelector('.toggle-arrow');
             if (arrow) arrow.textContent = isSearchExpanded ? '▼' : '▶';
           }
        }

        // 处理层级展开/折叠 (如果需要也可以移到这里，但当前逻辑可能没问题)
        const hierarchyToggle = target.closest('#hierarchy-toggle');
         if (hierarchyToggle) {
           event.stopPropagation(); event.preventDefault();
           isHierarchyExpanded = !isHierarchyExpanded;
           // console.log(`【层级切换】状态已切换: isHierarchyExpanded = ${isHierarchyExpanded}`);
           updateNotification(selectedElements.length); // 这个仍然需要重新渲染
         }

         // 处理最小化按钮
         const minimizeButton = target.closest('#batch-selector-minimize');
         if (minimizeButton) {
           isUIMinimized = true;
           try { chrome.storage.local.set({'batch-selector-ui-minimized': true}); } catch (e) { console.error('无法保存UI状态:', e); }
           if (isViewingChildren) { isViewingChildren = false; }
           const existingNotification = document.getElementById('batch-selector-notification');
           if (existingNotification) { document.body.removeChild(existingNotification); }
           updateNotification(selectedElements.length);
         }

         // 处理取消按钮
         const cancelButton = target.closest('#batch-selector-cancel');
         if (cancelButton) {
           cancelSelection();
         }

         // --- 其他按钮的点击事件处理 ---
         // 注意: 需要根据按钮的 ID 或 class 来区分并执行相应操作
         // 例如: viewInside, returnToParentView, selectChildElement 等原有的独立按钮事件需要移入或调整

         // 处理 "内部元素" 按钮
         const insideButton = target.closest('#batch-selector-inside');
         if (insideButton && !isViewingChildren) { // 仅在主界面模式下响应
             viewInside();
         }

         // 处理 "操作指南" 按钮
         const guideButton = target.closest('#batch-selector-guide');
         if (guideButton && !isViewingChildren) { // 仅在主界面模式下响应
             showGuide();
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

         // 处理搜索按钮 (主界面模式)
         const searchButton = target.closest('#batch-selector-search-btn');
         if (searchButton && !isViewingChildren) { // 仅在主界面模式下响应
             executeSearch();
         }

         // 处理搜索结果导航 (主界面模式)
         const searchPrevButton = target.closest('#batch-selector-search-prev');
         if (searchPrevButton && !isViewingChildren) { jumpToPreviousSearchResult(); }
         const searchNextButton = target.closest('#batch-selector-search-next');
         if (searchNextButton && !isViewingChildren) { jumpToNextSearchResult(); }
         const searchAddAllButton = target.closest('#batch-selector-search-add-all');
         if (searchAddAllButton && !isViewingChildren) { addAllSearchResultsToSelection(); }

         // 新增：处理复制按钮点击
         const copyButton = target.closest('#batch-selector-copy-btn');
         if (copyButton && !isViewingChildren) { // 仅在主界面模式下响应
            const textToCopy = updateClipboard(); // 获取处理后的文本
            // 强制写入剪贴板
            if (textToCopy !== undefined && textToCopy !== null) {
                 navigator.clipboard.writeText(textToCopy)
                    .then(() => {
                        showTemporaryMessage('已复制选中内容到剪贴板');
                    })
                    .catch(err => {
                         showTemporaryMessage('复制到剪贴板失败');
                         // console.error('复制按钮点击失败:', err);
                    });
            } else {
                showTemporaryMessage('没有内容可复制');
            }
         }

      });
      // --- 事件委托结束 ---

      // --- 移除帮助图标的旧处理 ---
      /*
      const searchHelpIcon = document.getElementById('search-help-icon');
      // 移除自定义帮助内容相关代码，现在使用系统tooltip
      */

      // --- 移除层级展开的旧处理 (已移入事件委托) ---
      /*
      const hierarchyToggle = document.getElementById('hierarchy-toggle');
      if (hierarchyToggle) {
        hierarchyToggle.addEventListener('click', function(event) {
          event.stopPropagation(); event.preventDefault();
          isHierarchyExpanded = !isHierarchyExpanded;
          // console.log(`【层级切换】状态已切换: isHierarchyExpanded = ${isHierarchyExpanded}`);
          updateNotification(selectedElements.length); // <--- 修改点
        });
      }
      */

      // --- 移除最小化按钮的旧处理 (已移入事件委托) ---
      /*
      const minimizeButton = document.getElementById('batch-selector-minimize');
      if (minimizeButton) {
         minimizeButton.addEventListener('click', function() {
           isUIMinimized = true;
           try { chrome.storage.local.set({'batch-selector-ui-minimized': true}); } catch (e) { console.error('无法保存UI状态:', e); }
           if (isViewingChildren) { isViewingChildren = false; }
           const existingNotification = document.getElementById('batch-selector-notification');
           if (existingNotification) { document.body.removeChild(existingNotification); }
           updateNotification(selectedElements.length);
         });
      }
      */

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

            // 更新所有 radio 按钮的父标签样式
            formatRadios.forEach(r => {
                const label = r.closest('label'); // 使用 closest 更安全
                if (label) {
                  label.style.backgroundColor = r.value === newlySelectedFormat ? 'rgba(66, 133, 244, 0.8)' : 'rgba(255, 255, 255, 0.1)';
                }
            });
          }
        });
        // Label 点击触发 Radio change (保持不变)
        const label = radio.closest('label');
        if(label){
          label.addEventListener('click', function(e) {
             // 防止 label 的点击事件触发 notification 的委托事件 (如果需要的话)
             // e.stopPropagation();
          const input = this.querySelector('input');
             if (input && !input.checked) { // 只有当未选中时才手动触发
                 input.checked = true;
                 // 手动触发 change 事件
                 input.dispatchEvent(new Event('change', { bubbles: true }));
             }
          });
        }
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

      // 搜索输入框 Enter 键处理 (保持不变)
      const searchInput = notification.querySelector('#batch-selector-search-input');
      if (searchInput && !isViewingChildren) {
          searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (searchResults.length > 0) { jumpToNextSearchResult(); }
              else { executeSearch(); }
            }
          });
        }

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
        const guideButton = document.getElementById('batch-selector-guide');
        if (guideButton) { ... } // 移入委托
        // ... 搜索功能事件监听器 ...
        const searchButton = notification.querySelector('#batch-selector-search-btn');
        if (searchButton) { ... } // 移入委托
        // ... searchInput keypress ... (保留)
        const searchPrevButton = notification.querySelector('#batch-selector-search-prev');
        if (searchPrevButton) { ... } // 移入委托
        const searchNextButton = notification.querySelector('#batch-selector-search-next');
        if (searchNextButton) { ... } // 移入委托
        const searchAddAllButton = notification.querySelector('#batch-selector-search-add-all');
        if (searchAddAllButton) { ... } // 移入委托
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
  // 从类型键中提取标签名和类名
  const [tagName, className] = typeKey.split('.');

  // 找出所有匹配该类型的元素
  const typeElements = selectedElements.filter(el =>
    el.tagName.toLowerCase() === tagName &&
    (el.className || '') === className
  );

  // 如果没有找到匹配的元素，直接返回
  if (typeElements.length === 0) {
    return;
  }

  // 清除所有匹配元素的高亮
  typeElements.forEach(el => {
    el.style.outline = '';
  });

  // 从选中列表中移除该类型的所有元素
  selectedElements = selectedElements.filter(el =>
    !(el.tagName.toLowerCase() === tagName &&
      (el.className || '') === className)
  );

  // 如果当前选中的元素类型是被取消的类型，重置当前元素类型
  if (currentElementTypeKey === typeKey) {
    // 如果还有其他类型的元素被选中，设置为第一个元素的类型
    if (selectedElements.length > 0) {
      const firstElement = selectedElements[0];
      currentElementTypeKey = `${firstElement.tagName.toLowerCase()}.${firstElement.className || ''}`;

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
  // 从选中元素中找到匹配指定类型的第一个元素
  const [tagName, className] = typeKey.split('.');

  // 查找第一个匹配的元素
  let targetElement = null;
  for (const el of selectedElements) {
    if (el.tagName.toLowerCase() === tagName &&
        (el.className || '') === className) {
      targetElement = el;
      break;
    }
  }

  if (!targetElement) {
    return; // 未找到匹配元素
  }

  // 更新当前选中的元素类型
  currentElementTypeKey = typeKey;

  // 重置子元素视图状态，确保可以重新查看内部元素
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
    const [tagName, className] = currentElementTypeKey.split('.');

    // 先移除旧的高亮
    selectedElements.forEach(el => {
      if (el.tagName.toLowerCase() === tagName &&
          (el.className || '') === className) {
        el.style.outline = '';
      }
    });

    // 存储当前选中的所有同类型元素
    const currentTypeElements = selectedElements.filter(el =>
      el.tagName.toLowerCase() === tagName &&
      (el.className || '') === className
    );

    // 从选中列表中移除当前类型的元素
    selectedElements = selectedElements.filter(el =>
      !(el.tagName.toLowerCase() === tagName &&
        (el.className || '') === className)
    );

    // 获取目标层级的标签和类名
    const targetTagName = currentElement.tagName.toLowerCase();
    const targetClassName = currentElement.className || '';

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
      el.style.outline = '2px solid blue';
      selectedElements.push(el);
    });

    // 如果有新元素，更新当前元素类型
    if (newElements.length > 0) {
      const firstElement = newElements[0];
      currentElementTypeKey = `${firstElement.tagName.toLowerCase()}.${firstElement.className || ''}`;

      // 重置子元素链
      collectChildrenChain(firstElement);
    } else {
      // 如果没有找到新元素，保持原样但更新UI
      currentElement.style.outline = '2px solid blue';
      selectedElements.push(currentElement);
      currentElementTypeKey = `${targetTagName}.${targetClassName}`;

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
      el.style.outline = '';
    }
  });

  // 高亮当前层级的元素
  currentElement.style.outline = '2px solid blue';

  // 更新选中元素列表，只包含当前元素
  selectedElements = [currentElement];

  // 更新当前元素类型
  currentElementTypeKey = `${currentElement.tagName.toLowerCase()}.${currentElement.className || ''}`;

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
  if (element.className) {
    const classes = element.className.split(' ');
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
  msgElement.style.position = 'fixed';
  msgElement.style.top = '50%';
  msgElement.style.left = '50%';
  msgElement.style.transform = 'translate(-50%, -50%)';
  msgElement.style.padding = '15px 25px';
  msgElement.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
  msgElement.style.color = 'white';
  msgElement.style.borderRadius = '5px';
  msgElement.style.zIndex = '10002';
  msgElement.style.fontSize = '16px';
  msgElement.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  msgElement.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  msgElement.style.textAlign = 'center';
  msgElement.textContent = message;
  msgElement.classList.add('batch-selector-ui');
  msgElement.setAttribute('class', 'batch-selector-ui');

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
// 重置选择状态
function resetSelection() {
  // 移除所有高亮
  clickedElements.forEach(el => {
    if (el && el.style) {
      el.style.outline = '';
    }
  });

 // 重置点击记录
  clickedElements = [];
}

// 取消选择，移除所有高亮和通知
function cancelSelection() {
  // 移除所有高亮 - 已点击的元素
  clickedElements.forEach(el => {
    if (el && el.style) {
      el.style.outline = '';
      el.style.outlineWidth = '';
      el.style.outlineStyle = '';
      el.style.outlineColor = '';
    }
  });

  // 移除所有高亮 - 已选中的元素
  selectedElements.forEach(el => {
    if (el && el.style) {
      el.style.outline = '';
      el.style.outlineWidth = '';
      el.style.outlineStyle = '';
      el.style.outlineColor = '';
    }
  });

  // 确保移除页面上所有可能被添加了高亮的元素
  // 使用多种选择器尝试匹配所有可能的边框样式
  const selectors = [
    '[style*="outline: 2px solid red"]',
    '[style*="outline:2px solid red"]',
    '[style*="outline: 2px solid #"]', // 匹配任何十六进制颜色
    '[style*="outline: 2px solid rgb"]', // 匹配RGB颜色
    '[style*="outline: 2px solid blue"]',
    '[style*="outline:2px solid blue"]',
    '[style*="outline-color: red"]',
    '[style*="outline-color: blue"]',
    '[style*="outline-width: 2px"]',
    '[style*="outline-style: solid"]'
  ];

  // 对每个选择器进行匹配和清除
  selectors.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        if (el && el.style) {
          el.style.outline = '';
          el.style.outlineWidth = '';
          el.style.outlineStyle = '';
          el.style.outlineColor = '';
        }
      });
          } catch (e) {
      console.error('清除样式错误:', e);
    }
  });

  // 备用方案：遍历所有元素，检查并清除包含red或blue的outline样式
  try {
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      if (el && el.style && el.style.outline) {
        const outlineStyle = el.style.outline.toLowerCase();
        if (outlineStyle.includes('red') || outlineStyle.includes('blue') ||
            outlineStyle.includes('solid') || outlineStyle.includes('2px')) {
          el.style.outline = '';
          el.style.outlineWidth = '';
          el.style.outlineStyle = '';
          el.style.outlineColor = '';
        }
      }
    });
  } catch (e) {
    console.error('备用清除样式错误:', e);
  }

  // 移除通知
  const notification = document.getElementById('batch-selector-notification');
  if (notification) {
    document.body.removeChild(notification);
  }

  const infoNotification = document.getElementById('batch-selector-info');
  if (infoNotification) {
    document.body.removeChild(infoNotification);
  }

  // 重置所有状态
  clickedElements = [];
  selectedElements = [];
  currentSelector = '';
  selectorHistory = [];
  selectorHistoryIndex = -1;
  parentChain = [];
  parentChainIndex = 0;
  childrenChain = [];
  isViewingChildren = false;
  currentElementTypeKey = '';

  // 清除文本搜索状态
  searchTerm = '';
  removeSearchHighlight(); // 移除搜索高亮
  searchResults = [];
  currentSearchResultIndex = -1;
}

// =============================================
// 剪贴板管理系统 - 处理选中内容的复制和格式化
// =============================================
// 更新剪贴板内容函数
function updateClipboard() {
  if (selectedElements.length === 0) {
    navigator.clipboard.writeText('').catch(err => {}); // 清空剪贴板
    return; // 如果没有选中元素，不进行操作
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
      navigator.clipboard.writeText('').catch(err => {}); // 清空剪贴板
      return;
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
      navigator.clipboard.writeText('').catch(err => {}); // 清空剪贴板
      return;
  }

  // --- 新逻辑：使用 textContent 并进行空白符规范化 ---
  let processedTexts = elementsToCopy.map(el => {
      // 1. 获取 textContent，它直接连接文本节点，避免innerText的空格问题
      let text = el.textContent || ''; // 使用 || '' 防止 null 或 undefined

      // 2. 全局空白符规范化：将所有连续空白替换为单个空格
      let normalizedText = text.replace(/\s+/g, ' ');

      // 3. 应用清理选项
      let cleaned = normalizedText; // 从规范化后的文本开始清理

      // 应用其他清理规则...
          if (removeCodePatterns) {
          cleaned = cleaned.replace(/{[^}]*}|\([^)]*\)|<[^>]*>|\[[^]]*\]/g, ' '); // 替换为 空格 以免单词粘连
          }
          if (removeSymbols) {
          // 保留空格，替换符号为空格
          cleaned = cleaned.replace(/[~`!@#$%^&*()_\-+={}\[\]|\\:;'"<>,.?\/]+/g, ' ');
          }
          if (removeEnglish) {
              cleaned = cleaned.replace(/[a-zA-Z]+/g, ' ');
          }
          if (removeChinese) {
              cleaned = cleaned.replace(/[\u4e00-\u9fa5]+/g, ' ');
          }
          if (removeNumbers) {
              cleaned = cleaned.replace(/[0-9]+/g, ' ');
          }
      // 应用 "文本空格" 选项，移除所有内部空格
          if (removeInternalSpaces) {
          // 移除所有单空格，实现单词连接
          cleaned = cleaned.replace(/ /g, '');
          }

      // 清理后可能产生额外的连续空格，再次进行规范化和 trim (可选但推荐)
      cleaned = cleaned.replace(/\s+/g, ' ').trim();

          return cleaned;
      });

  // 4. 过滤掉清理后为空字符串的项
  processedTexts = processedTexts.filter(text => text.length > 0);
  // --- 新逻辑结束 ---

  // 如果启用了去重选项 (现在对处理后的文本应用)
  if (removeDuplicates) {
    // 使用 Set 来获取唯一项，然后转回数组
    processedTexts = Array.from(new Set(processedTexts));
  }

  // 根据设置的格式组合文本 (使用新的 processedTexts)
  let collectedText = '';

  switch (clipboardFormat) {
    case 'space':
      collectedText = processedTexts.join(' ');
      break;
    case 'comma':
      collectedText = processedTexts.join(',');
      break;
    case 'newline':
    default:
      collectedText = processedTexts.join('\n');
      break;
  }

  // 仅在启用实时复制时才写入剪贴板
  if (isRealtimeCopyEnabled) {
    navigator.clipboard.writeText(collectedText)
      // .then(() => console.log('已更新剪贴板内容'))
      .catch(err => { /* console.error('更新剪贴板失败: ', err); */ });
  }

  return collectedText; // 总是返回处理后的文本
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
    showTemporaryMessage('无法绑定高层级到低层级元素');
    return;
  }

  // 获取当前元素链
  const targetElementChain = parentChain.slice(0, levelIndex + 1);
  // 颠倒顺序，从上到下（从根到叶）
  targetElementChain.reverse();

  // 获取当前元素类型
  const currentElement = parentChain[parentChainIndex];
  const currentTagName = currentElement.tagName.toLowerCase();
  const currentClassName = currentElement.className || '';

  // 获取目标层级元素
  const targetElement = parentChain[levelIndex];
  const targetTagName = targetElement.tagName.toLowerCase();
  const targetClassName = targetElement.className || '';

  // 保存当前选中的元素，以便后续恢复
  const currentSelectedElements = [...selectedElements];

  // 获取当前选中的该类型元素
  let currentTypeElements = [];
  if (currentElementTypeKey) {
    const [tagName, className] = currentElementTypeKey.split('.');
    currentTypeElements = selectedElements.filter(el =>
      el.tagName.toLowerCase() === tagName &&
      (el.className || '') === className
    );
  }

  // 寻找页面上所有符合当前元素类型的元素
  const potentialElements = document.querySelectorAll(currentTagName);
  const matchedElements = [];

  // 对每个潜在元素检查其层级
  for (const element of potentialElements) {
    // 如果元素类名不匹配，跳过
    if ((element.className || '') !== currentClassName) {
      continue;
    }

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

      if (hierarchyElement.tagName.toLowerCase() === targetTagName &&
          (hierarchyElement.className || '') === targetClassName) {
        // 如果找到匹配的目标层级，检查相对位置关系是否与参考链一致
        if (i < elementChain.length - 1 &&
            elementChain[elementChain.length - 1].tagName.toLowerCase() === currentTagName &&
            (elementChain[elementChain.length - 1].className || '') === currentClassName) {
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
    const [tagName, className] = currentElementTypeKey.split('.');
    selectedElements.forEach(el => {
      if (el.tagName.toLowerCase() === tagName &&
          (el.className || '') === className) {
        el.style.outline = '';
      }
    });

    // 从选中列表中移除当前类型的元素
    selectedElements = selectedElements.filter(el =>
      !(el.tagName.toLowerCase() === tagName &&
        (el.className || '') === className)
    );
  }

  // 如果是当前层级，只添加新的匹配元素
  if (isCurrentLevel) {
    // 检查这些元素是否已经在选中列表中
    const newElements = matchedElements.filter(el => !selectedElements.includes(el));

    // 高亮新的匹配元素并添加到选中列表
    newElements.forEach(el => {
      el.style.outline = '2px solid blue';
      selectedElements.push(el);
    });
  } else {
    // 不是当前层级，添加所有匹配元素
    matchedElements.forEach(el => {
      el.style.outline = '2px solid blue';
      selectedElements.push(el);
    });
  }

  // 更新当前元素类型
  currentElementTypeKey = `${currentTagName}.${currentClassName}`;

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
  if (!matchedLevelIndices[currentElementTypeKey]) {
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
    delete matchedLevelIndices[currentElementTypeKey];
    return;
  }

  // 获取当前匹配的层级
  const matchedLevel = matchedLevelIndices[currentElementTypeKey];

  // 重置当前元素类型的匹配层级索引
  delete matchedLevelIndices[currentElementTypeKey];

  // 如果当前元素类型存在
  if (currentElementTypeKey) {
    const [tagName, className] = currentElementTypeKey.split('.');

    // 获取当前选中的该类型元素
    const currentTypeElements = selectedElements.filter(el =>
      el.tagName.toLowerCase() === tagName &&
      (el.className || '') === className
    );

    // 无论是否有选中的元素，都重新选择所有匹配当前元素类型的元素（不考虑层级）
    // 清除当前类型元素的高亮
    currentTypeElements.forEach(el => {
      el.style.outline = '';
    });

    // 从选中列表中移除当前类型的元素
    selectedElements = selectedElements.filter(el =>
      !(el.tagName.toLowerCase() === tagName &&
        (el.className || '') === className)
    );

    // 重新选择所有匹配当前元素类型的元素
    const allMatchingElements = document.querySelectorAll(tagName);
    const filteredElements = Array.from(allMatchingElements).filter(el =>
      (el.className || '') === className
    );

    // 高亮所有匹配元素
    filteredElements.forEach(el => {
      el.style.outline = '2px solid blue';
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
      'batch-selector-ui-minimized': false, // Default changed back to expanded
      'batch-selector-hide-type-prompt': false,
      'batch-selector-realtime-copy': true, // 新增：实时复制设置默认值
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
      isUIMinimized = items['batch-selector-ui-minimized'];
      hideTypePrompt = items['batch-selector-hide-type-prompt'];
      isHierarchyExpanded = false; // Always start collapsed
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

      // console.log(`loadUserSettings: Globals set - removeSpaces=${removeSpaces}, removeCodePatterns=${removeCodePatterns}, isUIMinimized=${isUIMinimized}`); // Log after setting globals - REMOVED
      // 新的 Log (如果需要)
      // console.log(`loadUserSettings: Globals set - removeLeadingTrailing=${removeLeadingTrailingSpaces}, removeInternal=${removeInternalSpaces}, isUIMinimized=${isUIMinimized}`);
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
  isKeyConfigExpanded = true;

  // 创建配置面板
  const configPanel = document.createElement('div');
  configPanel.id = 'batch-selector-key-config';
  configPanel.className = 'batch-selector-ui';
  configPanel.style.position = 'fixed';
  configPanel.style.bottom = '20px';
  configPanel.style.left = '20px';
  configPanel.style.padding = '12px';
  configPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
  configPanel.style.color = 'white';
  configPanel.style.borderRadius = '5px';
  configPanel.style.zIndex = '10001';
  configPanel.style.width = '260px';
  configPanel.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
  configPanel.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  configPanel.style.fontSize = '13px';

  // 配置面板内容
  configPanel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <h3 style="margin: 0; font-size: 15px;">${t('ui_shortcuts_config')}</h3>
      <button id="batch-selector-key-config-close" class="batch-selector-ui" style="background: none; border: none; color: white; cursor: pointer; font-size: 18px; padding: 0 5px;">×</button>
    </div>

    <div style="margin-bottom: 10px;">
      <div style="margin-bottom: 5px; font-weight: bold; font-size: 12px;">${t('ui_select_key')}</div>
      <div id="select-key-container" style="background: rgba(255,255,255,0.1); padding: 6px; border-radius: 4px; margin-bottom: 3px;">
        <div id="select-key-display" style="height: 22px; line-height: 22px; padding: 0 6px; background: rgba(255,255,255,0.2); border-radius: 3px; cursor: pointer; text-align: center;">${selectKeyConfig.keys.map(formatKeyForDisplay).join(' + ')}</div>
        <div id="select-key-conflict" style="color: #ff6b6b; font-size: 11px; margin-top: 4px; display: none;">${t('ui_conflict_warning')}</div>
      </div>
      <div style="font-size: 11px; opacity: 0.7;">${t('ui_select_key_desc')}</div>
    </div>

    <div style="margin-bottom: 10px;">
      <div style="margin-bottom: 5px; font-weight: bold; font-size: 12px;">${t('ui_type_select_key')}</div>
      <div id="type-select-key-container" style="background: rgba(255,255,255,0.1); padding: 6px; border-radius: 4px; margin-bottom: 3px;">
        <div id="type-select-key-display" style="height: 22px; line-height: 22px; padding: 0 6px; background: rgba(255,255,255,0.2); border-radius: 3px; cursor: pointer; text-align: center;">${typeSelectKeyConfig.keys.map(formatKeyForDisplay).join(' + ')}</div>
        <div id="type-select-key-conflict" style="color: #ff6b6b; font-size: 11px; margin-top: 4px; display: none;">${t('ui_conflict_warning')}</div>
      </div>
      <div style="font-size: 11px; opacity: 0.7;">${t('ui_type_select_key_desc')}</div>
    </div>

    <div style="margin-bottom: 10px;">
      <div style="margin-bottom: 5px; font-weight: bold; font-size: 12px;">${t('ui_copy_key')}</div>
      <div id="copy-key-container" style="background: rgba(255,255,255,0.1); padding: 6px; border-radius: 4px; margin-bottom: 3px;">
        <div id="copy-key-display" style="height: 22px; line-height: 22px; padding: 0 6px; background: rgba(255,255,255,0.2); border-radius: 3px; cursor: pointer; text-align: center;">${copyKeyConfig.keys.map(formatKeyForDisplay).join(' + ')}</div>
        <div id="copy-key-conflict" style="color: #ff6b6b; font-size: 11px; margin-top: 4px; display: none;">${t('ui_conflict_warning')}</div>
      </div>
      <div style="font-size: 11px; opacity: 0.7;">${t('ui_copy_key_desc')}</div>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
      <span id="save-status-message" style="font-size: 11px; color: #8bc34a; opacity: 0; transition: opacity 0.3s ease-in-out;"></span>
      <div style="display: flex; gap: 8px;">
        <button id="reset-key-defaults" class="batch-selector-ui" style="padding: 4px 8px; background: #555; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 11px;">${t('ui_reset_defaults')}</button>
        <button id="batch-selector-key-config-save" class="batch-selector-ui" style="padding: 4px 8px; background: #4285f4; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 11px;">${t('ui_save')}</button>
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
  document.addEventListener('mousedown', function(event) {
    if (isShowingKeyConfig && !event.target.closest('#batch-selector-key-config')) {
      // 如果正在捕获按键，先结束捕获
      if (isCapturingKeys) {
        finishKeyCapture();
      }
      // 然后关闭面板
      hideKeyConfigPanel();
    }
  });

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

    // 添加悬停效果
    resetDefaultsButton.addEventListener('mouseover', function() {
      this.style.transition = 'background-color 0.2s ease-in-out';
      this.style.backgroundColor = '#666';
    });

    resetDefaultsButton.addEventListener('mouseout', function() {
      this.style.transition = 'background-color 0.2s ease-in-out';
      this.style.backgroundColor = '#555';
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

    // 添加悬停效果
    saveButton.addEventListener('mouseover', function() {
      this.style.transition = 'background-color 0.2s ease-in-out';
      this.style.backgroundColor = '#5294f7';
    });

    saveButton.addEventListener('mouseout', function() {
      this.style.transition = 'background-color 0.2s ease-in-out';
      this.style.backgroundColor = '#4285f4';
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

  isShowingKeyConfig = false;
  isKeyConfigExpanded = false;
}

// 在初始化时加载设置（在文件靠近底部添加调用）
// ...其他初始化代码...
loadUserSettings();

// =============================================
// UI交互增强 - 添加额外的交互功能
// =============================================
// 添加展开层级按钮的事件监听器
function addExpandLevelsEvents(notification) {
  const showMoreLevels = document.getElementById('show-more-levels');
  if (showMoreLevels) {
    // --- 使用克隆节点移除旧监听器 ---
    const newShowMoreLevels = showMoreLevels.cloneNode(true);
    showMoreLevels.parentNode.replaceChild(newShowMoreLevels, showMoreLevels);
    // --- 绑定新监听器 ---
    newShowMoreLevels.addEventListener('click', function(event) {
      event.stopPropagation(); event.preventDefault();
      isHierarchyExpanded = true;
      // console.log('层级显示已展开');
      updateNotification(selectedElements.length); // <--- 修改点
    });
    newShowMoreLevels.addEventListener('mouseover', function() { this.style.backgroundColor = 'rgba(255, 255, 255, 0.15)'; this.style.color = '#fff'; });
    newShowMoreLevels.addEventListener('mouseout', function() { this.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; this.style.color = '#bbb'; });
  }
}

// 显示操作指南窗口
function showGuide() {
  // 查找或创建操作指南容器
  let guideContainer = document.getElementById('batch-selector-guide-popup');

  if (guideContainer) {
    // 如果已存在，则切换显示状态
    guideContainer.style.display = guideContainer.style.display === 'none' ? 'block' : 'none';
    return;
  }

  // 创建新的操作指南弹窗
  guideContainer = document.createElement('div');
  guideContainer.id = 'batch-selector-guide-popup';
  guideContainer.className = 'batch-selector-ui';
  guideContainer.style.position = 'fixed';
  guideContainer.style.left = '20px';
  guideContainer.style.bottom = '80px';
  guideContainer.style.background = 'rgba(0, 0, 0, 0.9)';
  guideContainer.style.padding = '12px 15px';
  guideContainer.style.borderRadius = '5px';
  guideContainer.style.color = 'white';
  guideContainer.style.zIndex = '10001';
  guideContainer.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';
  guideContainer.style.maxWidth = '320px';
  guideContainer.style.fontSize = '13px';
  guideContainer.style.lineHeight = '1.5';

  // 获取格式化的快捷键显示
  const selectKeyDisplay = selectKeyConfig.keys.map(formatKeyForDisplay).join('+');
  const typeSelectKeyDisplay = typeSelectKeyConfig.keys.map(formatKeyForDisplay).join('+');
  const copyKeyDisplay = copyKeyConfig.keys.map(formatKeyForDisplay).join('+');

  // 操作指南内容
  guideContainer.innerHTML = `
    <div style="margin-bottom: 8px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
      <span>快捷操作指南</span>
      <span id="close-guide" style="cursor: pointer; font-size: 16px;">×</span>
    </div>
    <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2);">
      <div><b>${selectKeyDisplay}+点击</b>: 选择/取消选择元素</div>
      <div><b>${selectKeyDisplay}+拖拽</b>: 绘制矩形框进行框选</div>
      <div><b>${typeSelectKeyDisplay}</b>: 选择所有相同类型元素</div>
      <div><b>Shift+点击类型标签</b>: 取消选择整个类型的元素</div>
    </div>
    <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2);">
      <div><b>Shift+↑/↓</b>: 在层级间导航</div>
      <div><b>Shift+→/←</b>: 进/出内部元素</div>
      <div><b>Shift+层级</b>: 层级绑定，将后续选择范围精确限定在该父层级下。</div>
    </div>
    <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2);">
      <div><b>Esc</b>: 取消选择</div>
      <div><b>${copyKeyDisplay}</b>: 快速复制所选内容</div>
    </div>
    <div style="margin-bottom: 6px; font-weight: bold;">文本搜索语法:</div>
    <div style="padding-left: 8px; font-size: 12px; line-height: 1.5; color: #ddd;">
      <div><code style="background: rgba(255,255,255,0.1); padding: 0 3px;">*</code> - 匹配任意数量字符 (例: <code style="background: rgba(255,255,255,0.1); padding: 0 3px;">数据*分析</code>)</div>
      <div><code style="background: rgba(255,255,255,0.1); padding: 0 3px;">?</code> - 匹配单个字符 (例: <code style="background: rgba(255,255,255,0.1); padding: 0 3px;">第?章</code>)</div>
      <div><code style="background: rgba(255,255,255,0.1); padding: 0 3px;">[a,b,c]</code> - 匹配括号内任一项 (例: <code style="background: rgba(255,255,255,0.1); padding: 0 3px;">[1,2,3]</code>)</div>
      <div><code style="background: rgba(255,255,255,0.1); padding: 0 3px;">"..."</code> - 引号内按字面匹配 (例: <code style="background: rgba(255,255,255,0.1); padding: 0 3px;">"[1,2]"</code>)</div>
    </div>
  `;

  document.body.appendChild(guideContainer);

  // 添加关闭按钮事件
  document.getElementById('close-guide').addEventListener('click', function() {
    guideContainer.style.display = 'none';
  });

  // 点击其他区域关闭指南
  document.addEventListener('click', function(e) {
    if (guideContainer && guideContainer.style.display !== 'none') {
      if (!guideContainer.contains(e.target) &&
          e.target.id !== 'batch-selector-guide' &&
          !e.target.closest('#batch-selector-guide')) {
        guideContainer.style.display = 'none';
      }
    }
  }, true);
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
  if (levelIndex < 0 || levelIndex >= parentChain.length) {
    return;
  }

  // 检查是否尝试绑定高层级（低索引）到低层级（高索引）
  if (levelIndex < parentChainIndex) {
    // 显示无法绑定的提示，但不中断操作
    showTemporaryMessage('无法绑定高层级到低层级元素');
    return;
  }

  // 获取当前元素类型
  const currentElement = parentChain[parentChainIndex];
  const currentTagName = currentElement.tagName.toLowerCase();
  const currentClassName = currentElement.className || '';

  // 获取目标层级元素
  const targetElement = parentChain[levelIndex];
  const targetTagName = targetElement.tagName.toLowerCase();
  const targetClassName = targetElement.className || '';

  // 保存当前选中的元素，以便后续恢复
  const currentSelectedElements = [...selectedElements];

  // 获取当前选中的该类型元素
  let currentTypeElements = [];
  if (currentElementTypeKey) {
    const [tagName, className] = currentElementTypeKey.split('.');
    currentTypeElements = selectedElements.filter(el =>
      el.tagName.toLowerCase() === tagName &&
      (el.className || '') === className
    );
  }

  // 寻找页面上所有符合当前元素类型的元素
  const potentialElements = document.querySelectorAll(currentTagName);
  const matchedElements = [];

  // 对每个潜在元素检查其层级
  for (const element of potentialElements) {
    // 如果元素类名不匹配，跳过
    if ((element.className || '') !== currentClassName) {
      continue;
    }

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

      if (hierarchyElement.tagName.toLowerCase() === targetTagName &&
          (hierarchyElement.className || '') === targetClassName) {
        // 如果找到匹配的目标层级，检查相对位置关系是否与参考链一致
        if (i < elementChain.length - 1 &&
            elementChain[elementChain.length - 1].tagName.toLowerCase() === currentTagName &&
            (elementChain[elementChain.length - 1].className || '') === currentClassName) {
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
    const [tagName, className] = currentElementTypeKey.split('.');
    selectedElements.forEach(el => {
      if (el.tagName.toLowerCase() === tagName &&
          (el.className || '') === className) {
        el.style.outline = '';
      }
    });

    // 从选中列表中移除当前类型的元素
    selectedElements = selectedElements.filter(el =>
      !(el.tagName.toLowerCase() === tagName &&
        (el.className || '') === className)
    );
  }

  // 如果是当前层级，只添加新的匹配元素
  if (isCurrentLevel) {
    // 检查这些元素是否已经在选中列表中
    const newElements = matchedElements.filter(el => !selectedElements.includes(el));

    // 高亮新的匹配元素并添加到选中列表
    newElements.forEach(el => {
      el.style.outline = '2px solid blue';
      selectedElements.push(el);
    });
  } else {
    // 不是当前层级，添加所有匹配元素
    matchedElements.forEach(el => {
      el.style.outline = '2px solid blue';
      selectedElements.push(el);
    });
  }

  // 更新当前元素类型
  currentElementTypeKey = `${currentTagName}.${currentClassName}`;

  // 更新匹配层级索引，用于高亮
  // 使用元素类型关联的匹配层级索引
  matchedLevelIndices[currentElementTypeKey] = levelIndex;

  // 保持在查看内部模式，刷新界面以显示高亮
  updateNotification(selectedElements.length);

  // 更新剪贴板
  updateClipboard();
}

// 新增函数：在查看内部模式下取消层级匹配 (现在调用统一的updateNotification)
function cancelHierarchyMatchInside() {
  // 如果没有当前元素类型的匹配层级，不执行任何操作
  if (!matchedLevelIndices[currentElementTypeKey]) {
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
    delete matchedLevelIndices[currentElementTypeKey];
    isViewingChildren = false; // 退出查看内部模式
    return;
  }

  // 获取当前匹配的层级
  const matchedLevel = matchedLevelIndices[currentElementTypeKey];

  // 重置当前元素类型的匹配层级索引
  delete matchedLevelIndices[currentElementTypeKey];

  // 如果当前元素类型存在，检查选中元素
  if (currentElementTypeKey) {
    const [tagName, className] = currentElementTypeKey.split('.');

    // 获取当前选中的该类型元素
    const currentTypeElements = selectedElements.filter(el =>
      el.tagName.toLowerCase() === tagName &&
      (el.className || '') === className
    );

    // 无论是否有选中的元素，都重新选择所有匹配当前元素类型的元素（不考虑层级）
    // 清除当前类型元素的高亮
    currentTypeElements.forEach(el => {
      el.style.outline = '';
    });

    // 从选中列表中移除当前类型的元素
    selectedElements = selectedElements.filter(el =>
      !(el.tagName.toLowerCase() === tagName &&
        (el.className || '') === className)
    );

    // 重新选择所有匹配当前元素类型的元素
    const allMatchingElements = document.querySelectorAll(tagName);
    const filteredElements = Array.from(allMatchingElements).filter(el =>
      (el.className || '') === className
    );

    // 高亮所有匹配元素
    filteredElements.forEach(el => {
      el.style.outline = '2px solid blue';
      selectedElements.push(el);
    });

    // 更新UI
    updateNotification(selectedElements.length);

    // 更新剪贴板
    updateClipboard();
  } else {
    // 如果没有当前元素类型，只更新UI
    updateNotification(selectedElements.length);
  }
}

// =============================================
// 文本搜索功能实现
// =============================================

// 查找距离节点最近的有意义的父元素
function findClosestSignificantElement(node) {
  let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (current && current !== document.body) {
    if (isSignificantElement(current)) {
      return current;
    }
    current = current.parentElement;
  }
  // 如果找不到，返回父节点或者body
  return node.parentElement || document.body;
}

// 新增：查找最近的可见祖先元素
function findClosestVisibleAncestor(element) {
  let current = element;
  while (current && current !== document.body) {
    if (!isElementHiddenOrDisabled(current)) {
      // 找到了第一个可见的祖先
      return current;
    }
    current = current.parentElement;
  }
  // 如果一直到 body 都没找到可见的（理论上 body 总是可见），则返回 body
  return document.body;
}

// 将通配符模式转换为正则表达式
function wildcardToRegex(pattern) {
  // 处理引号中的特殊字符
  let processedPattern = '';
  let inQuotes = false;
  let i = 0;

  // 检查模式是否完全被引号包围
  const isCompletelyQuoted = pattern.startsWith('"') && pattern.endsWith('"') && pattern.length >= 2;

  // 如果模式完全被引号包围，则直接按字面值处理内部内容
  if (isCompletelyQuoted && pattern.length > 2) {
    // 去掉首尾引号，并对特殊字符进行转义
    const innerContent = pattern.substring(1, pattern.length - 1);
    return new RegExp(innerContent.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
  }

  while (i < pattern.length) {
    // 处理引号
    if (pattern[i] === '"' && (i === 0 || pattern[i-1] !== '\\')) {
      inQuotes = !inQuotes;
      // 引号本身不输出到结果中
      i++;
      continue;
    }

    if (inQuotes) {
      // 在引号内，将特殊字符转义
      if (pattern[i] === '*' || pattern[i] === '?' || pattern[i] === '[' || pattern[i] === ']') {
        processedPattern += '\\' + pattern[i];
      } else {
        processedPattern += pattern[i];
      }
    } else {
      // 引号外的字符，正常处理
      processedPattern += pattern[i];
    }
    i++;
  }

  // 处理字符集合 [1,2,3,10]
  processedPattern = processedPattern.replace(/\[([^\]]+)\]/g, function(match, contents) {
    // 将逗号分隔的内容转为正则表达式的分组
    const items = contents.split(',').map(item => item.trim());

    // 检查是否有多字符项
    const hasMultiCharItems = items.some(item => item.length > 1);

    if (hasMultiCharItems) {
      // 使用分组语法 (item1|item2|item3)
      return '(' + items.map(item => {
        // 转义正则表达式特殊字符
        return item.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      }).join('|') + ')';
    } else {
      // 使用字符类语法 [item1item2item3]
      return '[' + items.map(item => {
        // 转义正则表达式特殊字符
        return item.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      }).join('') + ']';
    }
  });

  // 1. 转义正则表达式特殊字符，除了 * 和 ?
  const escapedPattern = processedPattern.replace(/(-|\/|\\|\^|\$|\+|\.|\\|\(|\)|\||\{|\})/g, '\\$1');

  // 2. 将非转义的 * 替换为 .*
  const starReplaced = escapedPattern.replace(/(?<!\\)\*/g, '.*');

  // 3. 将非转义的 ? 替换为 .
  const finalPattern = starReplaced.replace(/(?<!\\)\?/g, '.');

  // 4. 创建正则表达式对象，忽略大小写
  try {
    return new RegExp(finalPattern, 'gi'); // g: 全局匹配, i: 忽略大小写
  } catch (e) {
    console.error("创建正则表达式失败:", e, "模式:", finalPattern);
    // 如果模式无效，返回一个匹配原始文本的正则
    try {
      // 尝试创建一个仅匹配原始文本的正则
      return new RegExp(pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
    } catch (e2) {
      console.error("创建回退正则表达式也失败:", e2);
      // 最终回退到匹配任何内容
      return new RegExp('.*', 'gi');
    }
  }
}

// 执行文本搜索（包含属性搜索）
function executeSearch() {
  const inputElement = document.getElementById('batch-selector-search-input');
  searchTerm = inputElement ? inputElement.value.trim() : '';

  // 清除上一次的搜索高亮和结果
  removeSearchHighlight();
  searchResults = [];
  currentSearchResultIndex = -1;

  if (!searchTerm) {
    updateSearchResultUI(); // 更新UI显示无结果
    showTemporaryMessage("请输入搜索文本或模式");
    return;
  }

  // console.log(`开始搜索模式: \"${searchTerm}\"`);
  // 使用通配符转正则表达式
  const searchRegex = wildcardToRegex(searchTerm);

  // 添加检查确保 document.body 可用
  if (!document.body || !(document.body instanceof Node)) {
    console.error("TreeClip Error: document.body is not available or not a Node when trying to search.");
    showTemporaryMessage("搜索失败：页面结构异常");
    updateSearchResultUI(); // 更新UI显示无结果或错误状态
    return;
  }

  // --- 1. 搜索文本节点 ---
  // console.log("--- 开始搜索文本节点 ---");
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // 排除脚本、样式、UI内部的文本节点
        const parent = node.parentElement;
        if (!parent || parent.closest('script, style, .batch-selector-ui')) {
          return NodeFilter.FILTER_REJECT;
        }
        // 使用正则表达式测试文本内容
        // 需要重置正则表达式的lastIndex，因为同一个 regex 对象会被多次使用
        searchRegex.lastIndex = 0;
        if (searchRegex.test(node.nodeValue)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    },
    false
  );

  let textNode;
  while (textNode = walker.nextNode()) {
    const parentElement = textNode.parentElement;
    if (!parentElement) continue; // 以防万一文本节点没有父元素

    const isHidden = isElementHiddenOrDisabled(parentElement);
    let result = null;

    if (isHidden) {
      // --- 处理隐藏文本匹配 ---
      const visibleAncestor = findClosestVisibleAncestor(parentElement);
      result = {
          type: 'hiddenText',
          textNode: textNode,           // 原始文本节点
          parentElement: parentElement, // 直接父元素（隐藏的）
          visibleAncestor: visibleAncestor // 最近的可见祖先
      };
      // console.log(`  [隐藏文本匹配] 找到: "${textNode.nodeValue.trim().substring(0, 50)}..." (父元素隐藏)`, "节点:", textNode, "可见祖先:", visibleAncestor);

    } else {
      // --- 处理可见文本匹配 ---
      result = {
          type: 'text',
          textNode: textNode,
          parentElement: parentElement, // 存储直接父元素用于上下文
          highlightSpans: []
      };
       // console.log(`  [可见文本匹配] 找到: "${textNode.nodeValue.trim().substring(0, 50)}..."`, "节点:", textNode, "父元素:", parentElement);
    }

    // 将结果添加到列表
    searchResults.push(result);
  }
  // console.log("--- 文本节点搜索结束 ---");

  // console.log(`搜索完成，总共找到 ${searchResults.length} 个原始匹配结果.`);

  if (searchResults.length > 0) {
    currentSearchResultIndex = 0; // 定位到第一个结果
    // 将正则表达式传递给高亮函数
    highlightSearchResults(searchRegex);
    jumpToSearchResult(currentSearchResultIndex, true); // 跳转并滚动到第一个
  } else {
    showTemporaryMessage(`未找到匹配 "${searchTerm}" 的文本`);
  }
  updateSearchResultUI();
}

// 高亮所有搜索结果
function highlightSearchResults(searchRegex) {
  if (!searchRegex) return; // 如果没有有效的正则表达式，则退出

  // 重置正则表达式状态，以防万一
  searchRegex.lastIndex = 0;

  // console.log("--- 开始高亮搜索结果 ---");
  searchResults.forEach((result, index) => {
    if (result.type === 'text') {
      // --- 处理可见文本节点高亮 ---
      const { textNode } = result;
      const parent = textNode.parentNode;
      if (!parent || !document.body.contains(textNode)) {
        // console.log(`  跳过高亮: 文本节点或其父元素已不存在`, textNode);
        return;
      }

      const text = textNode.nodeValue;
      const fragments = [];
      result.highlightSpans = []; // 重置/初始化高亮span数组
      let lastIndex = 0;
      let match;

      // 使用 exec 循环查找所有匹配项
      searchRegex.lastIndex = 0; // 确保从头开始搜索
      while ((match = searchRegex.exec(text)) !== null) {
        // 添加匹配前的文本
        if (match.index > lastIndex) {
          fragments.push(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        // 只有当匹配到非空文本时才创建高亮span
        if (match[0].length > 0) {
          // 创建高亮 span
        const highlightSpan = document.createElement('span');
        highlightSpan.className = 'batch-selector-text-highlight';
          highlightSpan.textContent = match[0]; // match[0] 是匹配到的文本
          // 标记当前结果的第一个匹配项
        if (index === currentSearchResultIndex && result.highlightSpans.length === 0) {
          highlightSpan.classList.add('batch-selector-text-highlight-current');
        }
        fragments.push(highlightSpan);
        result.highlightSpans.push(highlightSpan);
        }

        lastIndex = match.index + match[0].length;

        // 如果正则表达式可能匹配空字符串，需要手动推进 lastIndex 防止死循环
        if (match[0].length === 0) {
          searchRegex.lastIndex++;
        }
      }

      // 添加最后一个匹配项之后的文本
      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.substring(lastIndex)));
      }

      // 如果找到了匹配项，替换原始文本节点
      if (fragments.length > 0 && result.highlightSpans.length > 0) {
        // console.log(`  [高亮文本] "${text.trim().substring(0,50)}..."`, textNode);
        const nextSibling = textNode.nextSibling;
        try {
          // 确保 textNode 仍然是 parent 的子节点
          if (parent.contains(textNode)) {
          parent.removeChild(textNode);
          } else {
            // console.warn("  文本节点已不在父节点下，跳过移除");
            return; // 如果节点已被移除，后续插入也无意义
          }
  } catch (e) {
          console.error("  移除原始文本节点失败:", e, textNode);
          return;
        }
        // 插入新的片段
        fragments.forEach(fragment => {
          try {
          parent.insertBefore(fragment, nextSibling);
          } catch (e) {
            console.error("  插入高亮片段失败:", e, fragment);
          }
        });
      }
    } else if (result.type === 'hiddenText') {
        // --- 处理隐藏文本匹配的高亮 ---
      const { visibleAncestor, textNode, parentElement } = result;

        // 1. 高亮可见祖先 (橙色框)
        if (visibleAncestor && document.body.contains(visibleAncestor)) {
            visibleAncestor.classList.add('batch-selector-attribute-highlight');
            if (index === currentSearchResultIndex) {
              visibleAncestor.classList.add('batch-selector-text-highlight-current');
            }
             // console.log(`  [高亮隐藏文本祖先] 为 "${textNode.nodeValue.trim().substring(0,50)}..." 高亮 <${visibleAncestor.tagName}>`, visibleAncestor);
        } else {
            // console.log(`  跳过祖先高亮: 隐藏文本的可见祖先不存在或已移除`, visibleAncestor);
        }

        // 2. 高亮隐藏文本自身 (黄色背景 span)，即使父元素隐藏
      if (parentElement && document.body.contains(textNode) && parentElement.contains(textNode)) { // 检查父元素和文本节点是否存在且有父子关系
            const text = textNode.nodeValue;
            const fragments = [];
            result.highlightSpans = []; // 存储创建的 spans
        let lastIndex = 0;
        let match;

        searchRegex.lastIndex = 0; // 重置正则状态
        while ((match = searchRegex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            fragments.push(document.createTextNode(text.substring(lastIndex, match.index)));
          }

          // 只有当匹配到非空文本时才创建高亮span
          if (match[0].length > 0) {
              const highlightSpan = document.createElement('span');
            highlightSpan.className = 'batch-selector-text-highlight';
            highlightSpan.textContent = match[0];
              // 注意：这里的 current 高亮状态由祖先元素处理，span 本身不需要 current 类
              fragments.push(highlightSpan);
              result.highlightSpans.push(highlightSpan);
          }

          lastIndex = match.index + match[0].length;
          if (match[0].length === 0) {
            searchRegex.lastIndex++;
          }
        }

        if (lastIndex < text.length) {
          fragments.push(document.createTextNode(text.substring(lastIndex)));
        }

        // 如果找到了匹配项，替换原始文本节点
        if (fragments.length > 0 && result.highlightSpans.length > 0) {
              const nextSibling = textNode.nextSibling;
              try {
            // 确保 textNode 仍然是 parent 的子节点
            if (parentElement.contains(textNode)) {
                     parentElement.removeChild(textNode);
                 } else {
              // console.warn("  隐藏文本节点已不在父节点下，跳过移除");
              return; // 如果节点已被移除，后续插入也无意义
                 }
              } catch (e) {
            console.error("  移除原始隐藏文本节点失败:", e, textNode);
            return;
          }
          // 插入新的片段
          fragments.forEach(fragment => {
            try {
              parentElement.insertBefore(fragment, nextSibling);
            } catch (e) {
              console.error("  插入隐藏文本高亮片段失败:", e, fragment);
            }
          });
        }
        }
    }
  });

  // console.log("--- 高亮搜索结果完成 ---");
}

// 移除所有搜索高亮
function removeSearchHighlight() {
  // console.log("--- 开始移除搜索高亮 ---");
  // 1. 移除文本高亮 spans
  const highlightedSpans = document.querySelectorAll('.batch-selector-text-highlight, .batch-selector-text-highlight-current');
  // console.log(`  发现 ${highlightedSpans.length} 个文本高亮span`);
  highlightedSpans.forEach(span => {
    const parent = span.parentNode;
    if (parent) {
      // 检查 span 是否还在父节点下 (防止重复移除或DOM变化)
      if (Array.from(parent.childNodes).includes(span)) {
         try {
           parent.replaceChild(document.createTextNode(span.textContent), span);
           parent.normalize(); // 合并相邻文本节点
         } catch (e) {
           // console.error("  替换span时出错:", e, span);
         }
      }
    }
  });

  // 2. 移除属性高亮 class (对于隐藏文本)
  const highlightedElements = document.querySelectorAll('.batch-selector-attribute-highlight, .batch-selector-text-highlight-current');
  // console.log(`  发现 ${highlightedElements.length} 个带有高亮的元素`);
  highlightedElements.forEach(el => {
    el.classList.remove('batch-selector-attribute-highlight');
    el.classList.remove('batch-selector-text-highlight-current');
  });

  // console.log("已清除文本高亮");
  // 清空之前存储的span引用，以防内存泄漏
  searchResults.forEach(result => {
    if(result.type === 'text') { result.highlightSpans = []; }
  });
  // console.log("--- 结束移除搜索高亮 ---");
}

// 更新搜索结果导航UI
function updateSearchResultUI() {
  const countElement = document.getElementById('batch-selector-search-count');
  const prevButton = document.getElementById('batch-selector-search-prev');
  const nextButton = document.getElementById('batch-selector-search-next');
  const addAllButton = document.getElementById('batch-selector-search-add-all');

  if (!countElement || !prevButton || !nextButton || !addAllButton) return;

  if (searchResults.length === 0) {
    countElement.textContent = t('ui_no_results');
    prevButton.disabled = true;
    nextButton.disabled = true;
    addAllButton.disabled = true;
  } else {
    countElement.textContent = t('ui_search_result_count', [currentSearchResultIndex + 1, searchResults.length]);
    prevButton.disabled = currentSearchResultIndex <= 0;
    nextButton.disabled = currentSearchResultIndex >= searchResults.length - 1;
    addAllButton.disabled = false;
  }
}

// 跳转到下一个搜索结果
function jumpToNextSearchResult() {
  if (searchResults.length === 0 || currentSearchResultIndex >= searchResults.length - 1) return;

  // 移除旧的当前高亮
  if (currentSearchResultIndex >= 0) {
      const prevResult = searchResults[currentSearchResultIndex];
      if (prevResult.type === 'text') {
          // 检查 highlightSpans 是否存在且有内容
          if (prevResult.highlightSpans && prevResult.highlightSpans.length > 0) {
             prevResult.highlightSpans.forEach(span => span.classList.remove('batch-selector-text-highlight-current'));
          }
      } else if (prevResult.type === 'hiddenText') {
          const element = prevResult.visibleAncestor;
          if (element) {
             element.classList.remove('batch-selector-text-highlight-current');
          }
      }
  }

  currentSearchResultIndex++;
  const nextResult = searchResults[currentSearchResultIndex];

  // 添加新的当前高亮并跳转
   if (nextResult.type === 'text') {
      // 检查 highlightSpans 是否存在
      if (nextResult.highlightSpans && nextResult.highlightSpans.length > 0) {
          nextResult.highlightSpans.forEach(span => span.classList.add('batch-selector-text-highlight-current'));
      }
      // 总是尝试跳转
      jumpToSearchResult(currentSearchResultIndex, true);
  } else if (nextResult.type === 'hiddenText') {
      const element = nextResult.visibleAncestor;
       if (element) {
           element.classList.add('batch-selector-text-highlight-current');
           jumpToSearchResult(currentSearchResultIndex, true);
       }
  }

  updateSearchResultUI();
}

// 跳转到上一个搜索结果
function jumpToPreviousSearchResult() {
    if (currentSearchResultIndex <= 0) return;

    // 移除旧的当前高亮
    if (currentSearchResultIndex >= 0 && currentSearchResultIndex < searchResults.length) {
        const currentResult = searchResults[currentSearchResultIndex];
        if (currentResult.type === 'text') {
            // 检查 highlightSpans 是否存在
            if (currentResult.highlightSpans && currentResult.highlightSpans.length > 0) {
               currentResult.highlightSpans.forEach(span => span.classList.remove('batch-selector-text-highlight-current'));
            }
        } else if (currentResult.type === 'hiddenText') {
            const element = currentResult.visibleAncestor;
            if (element) {
               element.classList.remove('batch-selector-text-highlight-current');
            }
        }
    }

    currentSearchResultIndex--;
    const prevResult = searchResults[currentSearchResultIndex];

    // 添加新的当前高亮并跳转
    if (prevResult.type === 'text') {
        // 检查 highlightSpans 是否存在
        if (prevResult.highlightSpans && prevResult.highlightSpans.length > 0) {
            prevResult.highlightSpans.forEach(span => span.classList.add('batch-selector-text-highlight-current'));
        }
        jumpToSearchResult(currentSearchResultIndex, true);
    } else if (prevResult.type === 'hiddenText') {
        const element = prevResult.visibleAncestor;
         if (element) {
             element.classList.add('batch-selector-text-highlight-current');
             jumpToSearchResult(currentSearchResultIndex, true);
         }
    }

    updateSearchResultUI();
}

// 跳转到指定索引的搜索结果
function jumpToSearchResult(index, shouldScroll = false) { // 添加滚动控制参数
  if (index < 0 || index >= searchResults.length) return;

  const result = searchResults[index];
  let targetElementForScroll = null;

  // console.log(`--- 跳转到结果 ${index + 1} (类型: ${result.type}) ---`);

  if (result.type === 'text') {
    // --- 文本结果跳转逻辑 ---
    // 优先滚动到第一个高亮span
    if (result.highlightSpans && result.highlightSpans.length > 0) {
      targetElementForScroll = result.highlightSpans[0];
      // console.log("  目标: 第一个高亮 span", targetElementForScroll);
    } else if (result.containerElement) { // 否则尝试滚动到容器元素
      targetElementForScroll = result.containerElement;
      // console.log("  目标: 容器元素 (无高亮span)", targetElementForScroll);
    } else {
        // console.log("  无法确定文本结果的滚动目标");
    }
  } else if (result.type === 'hiddenText') {
    // --- 隐藏文本结果跳转逻辑 ---
    if (result.visibleAncestor && document.body.contains(result.visibleAncestor)) {
        targetElementForScroll = result.visibleAncestor;
        // console.log(`  目标: 隐藏文本的可见祖先 <${targetElementForScroll.tagName}>`, targetElementForScroll);
    } else {
        // console.log("  隐藏文本的可见祖先不存在或已移除");
    }
  }

  // // 添加日志 (旧日志，已整合到上方)
  // console.log(`jumpToSearchResult: index=${index}, shouldScroll=${shouldScroll}, target=`, targetElementForScroll);

  if (targetElementForScroll && shouldScroll) {
    requestAnimationFrame(() => { // 使用 requestAnimationFrame
        try {
             targetElementForScroll.scrollIntoView({ behavior: 'smooth', block: 'center' });
             // console.log(`滚动到搜索结果 ${index + 1} (元素: ${targetElementForScroll.tagName})`);
         } catch (e) {
             // console.error("scrollIntoView 失败:", e, "目标元素:", targetElementForScroll);
          }
     });
  }
}

// 将所有搜索结果添加到选择
function addAllSearchResultsToSelection() {
  if (searchResults.length === 0) return;

  // console.log("--- 开始将所有搜索结果添加到选择 ---");
  let addedCount = 0;
  // 使用此 Set 进行最终添加到 selectedElements 的去重
  const finalElementsToAdd = new Set();

  searchResults.forEach((result, i) => {
    // console.log(`  处理结果 ${i+1}/${searchResults.length}: 类型=${result.type}`);
    let elementToAdd = null;
    let initialElement = null;

    if (result.type === 'text') {
        // --- 文本结果处理 ---
        initialElement = result.parentElement;
    } else if (result.type === 'hiddenText') {
        // --- 隐藏文本结果处理 ---
        // 改为使用直接父元素作为初始候选，而不是可见祖先
        initialElement = result.parentElement;
    }

    // 优先选择 initialElement，如果它有效
    // 修改：移除对 offsetWidth/offsetHeight 的检查，优先选择直接父元素，即使它隐藏
    if (initialElement && initialElement !== document.body) {
        elementToAdd = initialElement;
        // console.log(`    使用 initialElement: <${elementToAdd.tagName}>`, elementToAdd);
    } else {
        // 如果 initialElement 无效或不合适，则向上查找
        // console.log(`    initialElement无效 (<${initialElement?.tagName}>)，向上查找...`);
        elementToAdd = findClosestSignificantElement(initialElement);
        if (elementToAdd) {
             // console.log(`    [回退查找] 找到最近显著元素: <${elementToAdd.tagName}>`, elementToAdd);
        } else {
             // console.log(`    [回退查找] 未找到显著元素`);
        }
    }

    // 添加到最终 Set 进行去重，并检查是否已在当前选择中
    if (elementToAdd) {
        if (selectedElements.includes(elementToAdd)) {
             // console.log(`    跳过添加: 元素 <${elementToAdd.tagName}> 已在当前选择中`, elementToAdd);
        } else if (finalElementsToAdd.has(elementToAdd)){
             // console.log(`    跳过添加: 元素 <${elementToAdd.tagName}> 已在本轮待添加列表`, elementToAdd);
        } else {
             // console.log(`    添加到待选列表: <${elementToAdd.tagName}>`, elementToAdd);
             finalElementsToAdd.add(elementToAdd);
        }
    }
  });

  // 将 Set 中的元素添加到 selectedElements 并应用高亮
  finalElementsToAdd.forEach(el => {
      selectedElements.push(el);
      el.style.outline = '2px solid blue'; // 应用标准选择高亮
      addedCount++;
  });
  // console.log(`--- 添加完成，新增 ${addedCount} 个元素到选择列表 (总计 ${selectedElements.length}) ---`);

  // 清除搜索状态和高亮
  // searchTerm = ''; // 保留搜索词
  // removeSearchHighlight(); // 保留高亮
  // searchResults = []; // 保留搜索结果
  // currentSearchResultIndex = -1; // 保留当前索引

  // 更新UI
  updateNotification(selectedElements.length); // 更新主UI计数
  updateClipboard();
  updateSearchResultUI(); // 更新搜索导航UI状态（按钮等）

  if (addedCount > 0) {
    showTemporaryMessage(`已将 ${addedCount} 个结果对应的最近元素添加到选择`);
  } else {
      showTemporaryMessage('没有新的元素被添加到选择中');
  }
}