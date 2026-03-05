// Figma Component Collector Plugin
// 主插件代码

/// <reference types="@figma/plugin-typings" />

// 性能监控类
class PerformanceMonitor {
  private measurements = new Map<string, { start: number; duration?: number }>();
  private history = new Map<string, number[]>();

  startMeasurement(name: string) {
    this.measurements.set(name, { start: Date.now() });
    // 清理过期的测量数据
    if (this.measurements.size > 100) {
      const firstKey = Array.from(this.measurements.keys())[0];
      this.measurements.delete(firstKey);
    }
  }
  
  endMeasurement(name: string): number {
    const measurement = this.measurements.get(name);
    if (!measurement) {
      return 0;
    }
    
    measurement.duration = Date.now() - measurement.start;
    const duration = measurement.duration;
    
    // 存储历史数据用于分析
    if (!this.history.has(name)) {
      this.history.set(name, []);
    }
    const history = this.history.get(name)!;
    history.push(duration);
    if (history.length > 50) {
      history.shift(); // 保持最近50次记录
    }
    
    this.measurements.delete(name);
    return duration;
  }
  
  getAverageDuration(name: string): number {
    const history = this.history.get(name);
    if (!history || history.length === 0) {
      return 0;
    }
    return history.reduce((a, b) => a + b, 0) / history.length;
  }
  
  printReport() {
    console.log('=== Performance Report ===');
    for (const [name, durations] of this.history) {
      const avg = this.getAverageDuration(name);
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      console.log(`${name}: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms, count=${durations.length}`);
    }
    console.log('=========================');
  }
}

// 全局实例
const perfMonitor = new PerformanceMonitor();

// 添加防抖定时器变量
let selectionChangeTimeout: ReturnType<typeof setTimeout> | null = null;
let lastSelectionString = '';
let lastPageId = figma.currentPage.id;

figma.showUI(__html__, { width: 400, height: 600 });

function getComponentKeyFromMainComponent(mainComponent: ComponentNode): string {
  return getCollectionKeyFromMainComponent(mainComponent);
}

function getComponentKeyFromComponentNode(component: ComponentNode): string {
  return getCollectionKeyFromComponent(component);
}

function findNearestComponentCarrier(node: BaseNode): BaseNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'INSTANCE' || current.type === 'COMPONENT' || current.type === 'COMPONENT_SET') {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function findPageForNode(node: BaseNode | null): PageNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'PAGE') {
      return current as PageNode;
    }
    current = current.parent;
  }
  return null;
}

async function resolveSelectionComponentKey(selection: readonly SceneNode[]): Promise<string | null> {
  for (const selectedNode of selection) {
    const carrier = findNearestComponentCarrier(selectedNode);
    if (!carrier) continue;

    if (carrier.type === 'COMPONENT_SET') {
      return getCollectionKeyFromComponentSet(carrier as ComponentSetNode);
    }

    if (carrier.type === 'COMPONENT') {
      return getComponentKeyFromComponentNode(carrier as ComponentNode);
    }

    if (carrier.type === 'INSTANCE') {
      const mainComponent = await (carrier as InstanceNode).getMainComponentAsync();
      if (mainComponent) {
        return getComponentKeyFromMainComponent(mainComponent);
      }
    }
  }
  return null;
}

async function postSelectionChangedState() {
  try {
    figma.ui.postMessage({
      type: 'selection-changed',
      hasSelection: figma.currentPage.selection.length > 0,
      selectedComponentKey: await resolveSelectionComponentKey(figma.currentPage.selection)
    });
  } catch (error) {
    // 忽略发送消息时的错误（可能是插件正在关闭）
    console.log('Failed to send selection-changed message, plugin might be closing');
  }
}

// 监听选择变化
figma.on('selectionchange', () => {
  // 生成当前选择的标识字符串
  const currentSelectionString = figma.currentPage.selection
    .map(node => node.id)
    .sort()
    .join(',');
  
  // 如果选择发生了变化,发送消息给 UI
  if (currentSelectionString !== lastSelectionString) {
    lastSelectionString = currentSelectionString;
    
    // 清除之前的定时器
    if (selectionChangeTimeout !== null) {
      clearTimeout(selectionChangeTimeout);
    }
    
    // 设置新的防抖定时器（延迟300毫秒）
    selectionChangeTimeout = setTimeout(() => {
      void postSelectionChangedState();
    }, 300);
  }
});

// 监听页面切换
figma.on('currentpagechange', () => {
  const currentPageId = figma.currentPage.id;
  
  // 如果页面发生了变化,发送消息给 UI
  if (currentPageId !== lastPageId) {
    lastPageId = currentPageId;
    
    try {
      figma.ui.postMessage({
        type: 'page-changed',
        pageName: figma.currentPage.name
      });
      void postSelectionChangedState();
    } catch (error) {
      // 忽略发送消息时的错误（可能是插件正在关闭）
      console.log('Failed to send page-changed message, plugin might be closing');
    }
  }
});

void postSelectionChangedState();

// 存储找到的主组件信息
interface ComponentInfo {
  component: ComponentNode;
  instanceCount: number;
  instances: InstanceNode[];
  sourceFileKey?: string;
  externalLibraryName?: string;
  componentSet?: ComponentSetNode; // 如果是变体组件,存储其父级 ComponentSet
}

interface CollectSummary {
  totalComponents: number;
  componentSetCount: number;
  singleComponentCount: number;
  instancesAttempted: number;
  instancesRebound: number;
  instancesFailed: number;
  internalMoved: number;
  internalCloned: number;
  fallbackToClone: number;
  externalPagesCreated: number;
  externalResidualCount: number;
  externalResidualDiagnostics: string[];
  failedInstanceDiagnostics: string[];
}

interface ProcessOutcome {
  node: SceneNode | null;
  instancesAttempted: number;
  instancesRebound: number;
  instancesFailed: number;
  movedInternal: boolean;
  cloned: boolean;
  fallbackToClone: boolean;
  failureDetails: string[];
}

interface ExternalResidueReport {
  count: number;
  lines: string[];
}

interface PluginSettings {
  moveInternal: boolean;
  externalSeparatePage: boolean;
  defaultTargetPageName: string;
}

const PLUGIN_SETTINGS_KEY = 'sakuraCollectorPluginSettingsV1';

function getDefaultPluginSettings(): PluginSettings {
  return {
    moveInternal: true,
    externalSeparatePage: false,
    defaultTargetPageName: DEFAULT_TARGET_PAGE_NAME
  };
}

function sanitizePluginSettings(raw: Partial<PluginSettings> | null | undefined): PluginSettings {
  const defaults = getDefaultPluginSettings();
  return {
    moveInternal: typeof raw?.moveInternal === 'boolean' ? raw.moveInternal : defaults.moveInternal,
    externalSeparatePage: typeof raw?.externalSeparatePage === 'boolean' ? raw.externalSeparatePage : defaults.externalSeparatePage,
    defaultTargetPageName: normalizePageName(raw?.defaultTargetPageName) || defaults.defaultTargetPageName
  };
}

async function loadPluginSettings(): Promise<PluginSettings> {
  const raw = await figma.clientStorage.getAsync(PLUGIN_SETTINGS_KEY) as Partial<PluginSettings> | undefined;
  return sanitizePluginSettings(raw);
}

async function savePluginSettings(settings: Partial<PluginSettings>): Promise<PluginSettings> {
  const sanitized = sanitizePluginSettings(settings);
  await figma.clientStorage.setAsync(PLUGIN_SETTINGS_KEY, sanitized);
  return sanitized;
}

async function resetPluginSettings(): Promise<PluginSettings> {
  const defaults = getDefaultPluginSettings();
  await figma.clientStorage.setAsync(PLUGIN_SETTINGS_KEY, defaults);
  return defaults;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function appendDiagnosticLine(lines: string[], line: string, max = 80) {
  if (lines.length < max) {
    lines.push(line);
  }
}

// 监听来自 UI 的消息
figma.ui.onmessage = async (msg) => {
  perfMonitor.startMeasurement('message-processing');
  
  // 根据消息类型处理不同操作
  switch (msg.type) {
    case 'get-plugin-settings': {
      try {
        const settings = await loadPluginSettings();
        figma.ui.postMessage({ type: 'plugin-settings', settings });
      } catch (err) {
        figma.ui.postMessage({ type: 'error', message: `读取设置失败：${getErrorMessage(err)}` });
      }
      break;
    }

    case 'save-plugin-settings': {
      try {
        const settings = await savePluginSettings({
          moveInternal: msg.moveInternal === true,
          externalSeparatePage: msg.externalSeparatePage === true,
          defaultTargetPageName: typeof msg.defaultTargetPageName === 'string' ? msg.defaultTargetPageName : DEFAULT_TARGET_PAGE_NAME
        });
        figma.ui.postMessage({ type: 'plugin-settings-saved', settings });
      } catch (err) {
        figma.ui.postMessage({ type: 'error', message: `保存设置失败：${getErrorMessage(err)}` });
      }
      break;
    }

    case 'reset-plugin-settings': {
      try {
        const settings = await resetPluginSettings();
        figma.ui.postMessage({ type: 'plugin-settings-reset', settings });
      } catch (err) {
        figma.ui.postMessage({ type: 'error', message: `恢复默认失败：${getErrorMessage(err)}` });
      }
      break;
    }

    case 'resize-ui': {
      // 处理窗口大小调整
      figma.ui.resize(msg.width, msg.height);
      break;
    }

    case 'scan-selection': {
      // 扫描当前选择
      const selectionResult = await scanFileForComponents('selection');
      figma.ui.postMessage({ type: 'scan-results', data: selectionResult });
      break;
    }

    case 'scan-page': {
      // 扫描当前页面
      const pageResult = await scanFileForComponents('page');
      figma.ui.postMessage({ type: 'scan-results', data: pageResult });
      break;
    }

    case 'scan-file': {
      // 扫描整个文件
      const fileResult = await scanFileForComponents('file');
      figma.ui.postMessage({ type: 'scan-results', data: fileResult });
      break;
    }

    case 'focus-component': {
      const { sourceNodeId, firstInstanceId, isExternal } = msg;
      try {
        const masterNode = sourceNodeId ? figma.getNodeById(sourceNodeId) : null;
        const firstInstanceNode = firstInstanceId ? figma.getNodeById(firstInstanceId) : null;
        const nodeToSelect = isExternal === true
          ? (firstInstanceNode ?? masterNode)
          : (masterNode ?? firstInstanceNode);
        if (nodeToSelect) {
          const targetPage = findPageForNode(nodeToSelect as BaseNode);
          if (targetPage && figma.currentPage.id !== targetPage.id) {
            await figma.setCurrentPageAsync(targetPage);
          }
          figma.currentPage.selection = [nodeToSelect as SceneNode];
          figma.viewport.scrollAndZoomIntoView([nodeToSelect as SceneNode]);
        }
      } catch (e) {
        console.warn('focus-component failed:', e);
      }
      break;
    }

    case 'collect-components': {
      // 收集组件
      try {
        const summary = await collectAndOrganizeComponents(
          msg.targetPageName,
          msg.scope,
          msg.externalOnly,
          msg.moveInternal === true,
          msg.externalSeparatePage === true,
          Array.isArray(msg.selectedComponentIds) ? msg.selectedComponentIds : []
        );
        const detailLines = [
          `组件 ${summary.totalComponents}（变体集 ${summary.componentSetCount} / 单组件 ${summary.singleComponentCount}）`,
          `实例重绑 成功 ${summary.instancesRebound} / 失败 ${summary.instancesFailed}`,
          `内部组件 移动 ${summary.internalMoved} / 克隆 ${summary.internalCloned}`,
          `外部分组页面新增 ${summary.externalPagesCreated}`,
          `残留外部实例 ${summary.externalResidualCount}`
        ];
        const hasPartialIssues = summary.instancesFailed > 0 || summary.externalResidualCount > 0;
        if (hasPartialIssues) {
          if (summary.failedInstanceDiagnostics.length > 0) {
            detailLines.push('--- 失败实例诊断 ---');
            detailLines.push(...summary.failedInstanceDiagnostics);
          }
          if (summary.externalResidualDiagnostics.length > 0) {
            detailLines.push('--- 残留诊断 ---');
            detailLines.push(...summary.externalResidualDiagnostics);
          }
        }

        if (hasPartialIssues) {
          figma.ui.postMessage({
            type: 'warning',
            message: `部分成功：失败 ${summary.instancesFailed}，残留 ${summary.externalResidualCount}`,
            details: detailLines.join('\n')
          });
        } else {
          figma.ui.postMessage({
            type: 'success',
            message: `已收集到页面「${msg.targetPageName}」`
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'error', message });
      }
      break;
    }
  }
  
  perfMonitor.endMeasurement('message-processing');
  
  // 定期输出性能报告（每10%的概率）
  if (Math.random() < 0.1) {
    perfMonitor.printReport();
  }
};


// 扫描文件或选中画板中的所有组件
async function scanFileForComponents(scope: 'file' | 'page' | 'selection') {
  console.log('scanFileForComponents called with scope:', scope);
  
  const componentsMap = new Map<string, ComponentInfo>();
  const startTime = Date.now();
  const skipPageNames = getPresetTargetPageNames();
  
  if (scope === 'selection') {
    console.log('Processing selection mode');
    if (shouldSkipPageForScanning(figma.currentPage, skipPageNames)) {
      return buildScanResults(
        componentsMap,
        scope,
        await resolveSelectionComponentKey(figma.currentPage.selection)
      );
    }
    const selection = figma.currentPage.selection;
    console.log('Current selection length:', selection.length);
    
    if (selection.length === 0) {
      console.log('No selection found, switching to page mode');
      scope = 'page';
    } else {
      console.log('Processing selected nodes');
      const totalNodes = selection.length;
      let processedNodes = 0;
      
      const maxNodesToProcess = 3000;
      const nodesToProcess = totalNodes > maxNodesToProcess ? selection.slice(0, maxNodesToProcess) : selection;
      const actualTotalNodes = nodesToProcess.length;
      
      const optimalBatchSize = Math.min(50, Math.max(10, Math.floor(actualTotalNodes / 20)));
      
      for (let i = 0; i < nodesToProcess.length; i += optimalBatchSize) {
        const batch = nodesToProcess.slice(i, i + optimalBatchSize);
        const promises = batch.map(node => scanNode(node, componentsMap));
        
        await Promise.all(promises);
        processedNodes += batch.length;
        
        const shouldUpdateProgress = processedNodes % Math.max(25, Math.floor(actualTotalNodes / 20)) === 0 || 
                                   processedNodes === actualTotalNodes;
        
        if (shouldUpdateProgress) {
          const progress = Math.floor((processedNodes / actualTotalNodes) * 10);
          const elapsedTime = Date.now() - startTime;
          const estimatedTotalTime = (elapsedTime / processedNodes) * actualTotalNodes;
          const remainingTime = Math.max(0, Math.round((estimatedTotalTime - elapsedTime) / 1000));
          
          try {
            figma.ui.postMessage({ 
              type: 'progress', 
              message: `扫描选择项 ${processedNodes}/${actualTotalNodes}，预计剩余时间: ${remainingTime}秒` + 
                       (totalNodes > maxNodesToProcess ? ` (已限制处理数量)` : ''),
              progress: progress
            });
          } catch (error) {
            console.log('Failed to send progress message, plugin might be closing');
            return {
              totalComponents: 0,
              totalInstances: 0,
              totalComponentSets: 0,
              components: [],
              scope: 'selection',
              error: '插件正在关闭'
            };
          }
        }
        
        if (i % (optimalBatchSize * 3) === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      if (totalNodes > maxNodesToProcess) {
        figma.notify(`注意：选择的节点过多，仅处理了前${maxNodesToProcess}个节点。`, { timeout: 5000 });
      }
    }
    
    return buildScanResults(
      componentsMap,
      scope,
      await resolveSelectionComponentKey(figma.currentPage.selection)
    );
  }
  
  if (scope === 'page') {
    console.log('Processing page mode');
    const currentPage = figma.currentPage;
    if (shouldSkipPageForScanning(currentPage, skipPageNames)) {
      return buildScanResults(
        componentsMap,
        scope,
        await resolveSelectionComponentKey(figma.currentPage.selection)
      );
    }
    
    try {
      figma.ui.postMessage({ 
        type: 'progress', 
        message: `开始扫描页面: ${currentPage.name}`,
        progress: 10
      });
    } catch (error) {
      console.log('Failed to send progress message, plugin might be closing');
      return {
        totalComponents: 0,
        totalInstances: 0,
        totalComponentSets: 0,
        components: [],
        scope: 'page',
        error: '插件正在关闭'
      };
    }
    
    const totalNodes = currentPage.children.length;
    let processedNodes = 0;
    
    const maxNodesToProcess = 3000;
    const nodesToProcess = totalNodes > maxNodesToProcess ? currentPage.children.slice(0, maxNodesToProcess) : [...currentPage.children];
    const actualTotalNodes = nodesToProcess.length;
    
    const optimalBatchSize = Math.min(50, Math.max(10, Math.floor(actualTotalNodes / 20)));
    
    for (let i = 0; i < nodesToProcess.length; i += optimalBatchSize) {
      const batch = nodesToProcess.slice(i, i + optimalBatchSize);
      const promises = batch.map(node => scanNode(node, componentsMap));
      
      await Promise.all(promises);
      processedNodes += batch.length;
      
      const shouldUpdateProgress = processedNodes % Math.max(25, Math.floor(actualTotalNodes / 20)) === 0 || 
                                 processedNodes === actualTotalNodes;
      
      if (shouldUpdateProgress) {
        const progress = Math.floor((processedNodes / actualTotalNodes) * 80) + 10;
        const elapsedTime = Date.now() - startTime;
        const estimatedTotalTime = (elapsedTime / processedNodes) * actualTotalNodes;
        const remainingTime = Math.max(0, Math.round((estimatedTotalTime - elapsedTime) / 1000));
        
        try {
          figma.ui.postMessage({ 
            type: 'progress', 
            message: `扫描页面 ${processedNodes}/${actualTotalNodes}，预计剩余时间: ${remainingTime}秒` + 
                     (totalNodes > maxNodesToProcess ? ` (已限制处理数量)` : ''),
            progress: progress
          });
        } catch (error) {
          console.log('Failed to send progress message, plugin might be closing');
          return {
            totalComponents: 0,
            totalInstances: 0,
            totalComponentSets: 0,
            components: [],
            scope: 'page',
            error: '插件正在关闭'
          };
        }
      }
      
      if (i % (optimalBatchSize * 3) === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    if (totalNodes > maxNodesToProcess) {
      figma.notify(`注意：页面节点过多，仅处理了前${maxNodesToProcess}个节点。`, { timeout: 5000 });
    }
    
    try {
      figma.ui.postMessage({ 
        type: 'progress', 
        message: '扫描当前页面完成',
        progress: 90
      });
    } catch (error) {
      console.log('Failed to send progress message, plugin might be closing');
      return {
        totalComponents: 0,
        totalInstances: 0,
        totalComponentSets: 0,
        components: [],
        scope: 'page',
        error: '插件正在关闭'
      };
    }
  } else {
    console.log('Processing file mode');
    const pages = [...figma.root.children].filter(page => !shouldSkipPageForScanning(page, skipPageNames));
    const totalPageCount = pages.length;
    let processedPages = 0;
    
    const concurrencyLimit = 8;
    if (totalPageCount === 0) {
      return buildScanResults(
        componentsMap,
        scope,
        await resolveSelectionComponentKey(figma.currentPage.selection)
      );
    }
    
    for (let i = 0; i < pages.length; i += concurrencyLimit) {
      const batch = pages.slice(i, i + concurrencyLimit);
      const promises = batch.map(page => scanNode(page, componentsMap));
      
      await Promise.all(promises);
      processedPages += batch.length;
      
      try {
        figma.ui.postMessage({ 
          type: 'progress', 
          message: `扫描页面 ${processedPages}/${totalPageCount}: ${batch.map(p => p.name).join(', ')}`,
          progress: Math.floor((processedPages / totalPageCount) * 100)
        });
      } catch (error) {
        console.log('Failed to send progress message, plugin might be closing');
        return {
          totalComponents: 0,
          totalInstances: 0,
          totalComponentSets: 0,
          components: [],
          scope: 'file',
          error: '插件正在关闭'
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  return buildScanResults(
    componentsMap,
    scope,
    await resolveSelectionComponentKey(figma.currentPage.selection)
  );
}

// 构建扫描结果
function buildScanResults(
  componentsMap: Map<string, ComponentInfo>,
  scope: string,
  selectedComponentKey: string | null
) {
  let componentSetCount = 0;
  const componentsList: Array<{
    id: string;
    name: string;
    instanceCount: number;
    isExternal: boolean;
    locationType: 'external' | 'library' | 'local';
    sourceFileKey: string;
    sourceNodeId: string;
    firstInstanceId: string | null;
    pageName: string;
    type: string;
  }> = [];
  
  const maxComponentsToShow = 300;
  const componentEntries = Array.from(componentsMap.entries());
  const componentsToShow = componentEntries.length > maxComponentsToShow 
    ? componentEntries.slice(0, maxComponentsToShow) 
    : componentEntries;
  
  if (componentEntries.length > maxComponentsToShow) {
    figma.notify(`检测到大量组件(${componentEntries.length}个)，仅显示前${maxComponentsToShow}个。`, { timeout: 5000 });
  }
  
  const batchSize = 50;
  for (let i = 0; i < componentsToShow.length; i += batchSize) {
    const batch = componentsToShow.slice(i, i + batchSize);
    
    batch.forEach(([key, info]) => {
      const targetNode = info.componentSet || info.component;

      // 通过 parent 链判断是否在当前文件内（与 isComponentInternal 一致）
      let isInCurrentDocument = false;
      let current: BaseNode | null = targetNode;
      while (current) {
        if (current === figma.root) { isInCurrentDocument = true; break; }
        current = current.parent;
      }

      const pageName = findPageName(targetNode);
      const locationType: 'external' | 'library' | 'local' = !isInCurrentDocument
        ? 'external'
        : (normalizePageName(pageName) === normalizePageName(DEFAULT_TARGET_PAGE_NAME) ? 'library' : 'local');
      const firstInstanceId = info.instances.length > 0 ? info.instances[0].id : null;
      componentsList.push({
        id: key,
        name: targetNode.name,
        instanceCount: info.instanceCount,
        isExternal: !isInCurrentDocument,
        locationType,
        sourceFileKey: info.sourceFileKey || '',
        sourceNodeId: targetNode.id,
        firstInstanceId,
        pageName,
        type: info.componentSet ? 'component-set' : 'component'
      });
      
      if (info.componentSet) {
        componentSetCount++;
      }
    });
    
  }
  
  return {
    totalComponents: componentsMap.size,
    totalInstances: Array.from(componentsMap.values()).reduce((sum, info) => sum + info.instanceCount, 0),
    totalComponentSets: componentSetCount,
    components: componentsList,
    scope: scope,
    selectedComponentKey
  };
}

interface ScanNodeOptions {
  scannedNodes?: Set<string>;
  instanceMap?: Map<string, InstanceNode[]>;
  collectComponents?: boolean;
}

function trackInstanceForMap(
  instanceMap: Map<string, InstanceNode[]>,
  key: string,
  instance: InstanceNode
) {
  const existingInstances = instanceMap.get(key);
  if (existingInstances) {
    existingInstances.push(instance);
  } else {
    instanceMap.set(key, [instance]);
  }
}

const COLLECTOR_SOURCE_KEY = 'sakuraCollectorSourceKey';
const COLLECTOR_SOURCE_TYPE = 'sakuraCollectorSourceType';
const DEFAULT_TARGET_PAGE_NAME = '_Comp';
const EXTERNAL_COMPONENTS_PAGE_NAME = '📦 外部组件';

function getSourceStableKey(info: ComponentInfo): string {
  const sourceNode = info.componentSet || info.component;
  const sourceKey =
    info.componentSet
      ? info.componentSet.key || info.component.key
      : info.component.key;
  return sourceKey || `${info.componentSet ? 'component-set' : 'component'}:${sourceNode.id}`;
}

function normalizePageName(name: string | null | undefined): string {
  return (name || '').trim();
}

function getPresetTargetPageNames(): Set<string> {
  return new Set();
}

function shouldSkipPageForScanning(page: PageNode, extraSkipPageNames: Set<string> = new Set()): boolean {
  const _ = { page, extraSkipPageNames };
  return false;
}

function getChildIndexInParent(parent: BaseNode, childId: string): number {
  if (!('children' in parent)) return -1;
  return parent.children.findIndex(child => child.id === childId);
}

function insertChildAtOriginalIndex(
  parent: BaseNode,
  node: SceneNode,
  preferredIndex: number
) {
  const parentWithChildren = parent as unknown as ChildrenMixin;
  const canInsert =
    'insertChild' in parentWithChildren &&
    typeof parentWithChildren.insertChild === 'function' &&
    'children' in parentWithChildren &&
    Array.isArray(parentWithChildren.children);
  const canAppend = 'appendChild' in parentWithChildren && typeof parentWithChildren.appendChild === 'function';

  if (!canInsert) {
    if (canAppend) {
      parentWithChildren.appendChild(node);
    }
    return;
  }
  const safeIndex = Math.max(0, Math.min(preferredIndex, parentWithChildren.children.length));
  parentWithChildren.insertChild(safeIndex, node);
}

function getCollectionKeyFromComponentSet(componentSet: ComponentSetNode): string {
  return getStableKeyFromComponentNode(componentSet);
}

function getCollectionKeyFromComponent(component: ComponentNode): string {
  if (component.parent?.type === 'COMPONENT_SET') {
    return getCollectionKeyFromComponentSet(component.parent as ComponentSetNode);
  }
  return getStableKeyFromComponentNode(component);
}

function getCollectionKeyFromMainComponent(mainComponent: ComponentNode): string {
  return getCollectionKeyFromComponent(mainComponent);
}

function getCollectionKeyFromInfo(info: ComponentInfo): string {
  if (info.componentSet) {
    return getCollectionKeyFromComponentSet(info.componentSet);
  }
  return getCollectionKeyFromComponent(info.component);
}

function markCollectedSource(node: SceneNode, info: ComponentInfo) {
  const sourceType = info.componentSet ? 'component-set' : 'component';
  node.setPluginData(COLLECTOR_SOURCE_KEY, getSourceStableKey(info));
  node.setPluginData(COLLECTOR_SOURCE_TYPE, sourceType);
}

function findCollectedNodeOnPage<T extends SceneNode>(
  page: PageNode,
  info: ComponentInfo,
  expectedType: 'COMPONENT' | 'COMPONENT_SET'
): T | null {
  const sourceKey = getSourceStableKey(info);
  const sourceType = info.componentSet ? 'component-set' : 'component';
  const matchedByMarker = page.findOne((n) => {
    if (n.type !== expectedType) return false;
    return (
      n.getPluginData(COLLECTOR_SOURCE_KEY) === sourceKey &&
      n.getPluginData(COLLECTOR_SOURCE_TYPE) === sourceType
    );
  }) as T | null;
  if (matchedByMarker) {
    return matchedByMarker;
  }
  // 兼容旧版本：内部移动组件仍可通过原 id 命中
  const sourceNode = info.componentSet || info.component;
  return page.findOne(n => n.id === sourceNode.id && n.type === expectedType) as T | null;
}

function getStableKeyFromComponentNode(node: ComponentNode | ComponentSetNode): string {
  return node.key || `${node.type === 'COMPONENT_SET' ? 'component-set' : 'component'}:${node.id}`;
}

function getInstanceMainStableKey(mainComponent: ComponentNode): string {
  if (mainComponent.parent?.type === 'COMPONENT_SET') {
    return getStableKeyFromComponentNode(mainComponent.parent as ComponentSetNode);
  }
  return getStableKeyFromComponentNode(mainComponent);
}

function findMatchingVariantInSet(
  componentSet: ComponentSetNode,
  mainComponent: ComponentNode
): ComponentNode | null {
  const byName = componentSet.findOne(n =>
    n.type === 'COMPONENT' && n.name === mainComponent.name
  ) as ComponentNode | null;
  if (byName) return byName;
  return componentSet.defaultVariant || null;
}

function normalizeVariantProperties(
  props: { [property: string]: string } | null | undefined
): { [property: string]: string } {
  if (!props) return {};
  const normalized: { [property: string]: string } = {};
  Object.keys(props).forEach((key) => {
    normalized[key.trim()] = String(props[key]).trim();
  });
  return normalized;
}

function isSameVariantProperties(
  left: { [property: string]: string } | null | undefined,
  right: { [property: string]: string } | null | undefined
): boolean {
  const a = normalizeVariantProperties(left);
  const b = normalizeVariantProperties(right);
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (a[aKeys[i]] !== b[bKeys[i]]) return false;
  }
  return true;
}

function getVariantPropsForInstance(instance: InstanceNode): { [property: string]: string } {
  if (instance.variantProperties && Object.keys(instance.variantProperties).length > 0) {
    return normalizeVariantProperties(instance.variantProperties);
  }
  const result: { [property: string]: string } = {};
  const componentProps = instance.componentProperties || {};
  for (const [propName, propDef] of Object.entries(componentProps)) {
    if ((propDef as { type?: string }).type === 'VARIANT') {
      const name = propName.includes('#') ? propName.split('#')[0] : propName;
      result[name.trim()] = String((propDef as { value?: string }).value ?? '').trim();
    }
  }
  return result;
}

function findMatchingVariantForInstance(
  componentSet: ComponentSetNode,
  instance: InstanceNode,
  mainComponent: ComponentNode | null
): ComponentNode | null {
  if (mainComponent) {
    const byName = componentSet.findOne(n =>
      n.type === 'COMPONENT' && n.name === mainComponent.name
    ) as ComponentNode | null;
    if (byName) return byName;

    if (mainComponent.variantProperties && Object.keys(mainComponent.variantProperties).length > 0) {
      const byMainProps = componentSet.findOne((n) => {
        if (n.type !== 'COMPONENT') return false;
        return isSameVariantProperties((n as ComponentNode).variantProperties, mainComponent.variantProperties);
      }) as ComponentNode | null;
      if (byMainProps) return byMainProps;
    }
  }

  const instanceProps = getVariantPropsForInstance(instance);
  if (Object.keys(instanceProps).length > 0) {
    const byInstanceProps = componentSet.findOne((n) => {
      if (n.type !== 'COMPONENT') return false;
      return isSameVariantProperties((n as ComponentNode).variantProperties, instanceProps);
    }) as ComponentNode | null;
    if (byInstanceProps) return byInstanceProps;
  }

  return componentSet.defaultVariant || null;
}

function isMainBoundToTarget(mainComponent: ComponentNode, target: SceneNode): boolean {
  if (target.type === 'COMPONENT') {
    return mainComponent.id === target.id;
  }
  if (target.type === 'COMPONENT_SET') {
    return mainComponent.parent?.type === 'COMPONENT_SET' && mainComponent.parent.id === target.id;
  }
  return false;
}

function findAncestorCollectedMarker(node: BaseNode): string | null {
  let current: BaseNode | null = node.parent;
  while (current) {
    if ('getPluginData' in current) {
      const sourceKey = current.getPluginData(COLLECTOR_SOURCE_KEY);
      const sourceType = current.getPluginData(COLLECTOR_SOURCE_TYPE);
      if (sourceKey && sourceType) {
        return `${sourceType}:${sourceKey}`;
      }
    }
    current = current.parent;
  }
  return null;
}

function inferResidueReason(
  hasCollectedMarker: boolean,
  ancestorMarker: string | null
): string {
  if (!hasCollectedMarker) {
    return '未找到对应已收集母组件标记（可能未被收集/被过滤/来源键不一致）';
  }
  if (ancestorMarker) {
    return '实例位于已收集母组件内部，可能是深层嵌套 swap 链路未完全收敛或变体匹配失败';
  }
  return '实例在普通画布节点中，可能是该实例 swapComponent 失败（权限/只读/目标变体不可匹配）';
}

function getInstanceMarkerCandidates(mainComponent: ComponentNode): string[] {
  const sourceType = mainComponent.parent?.type === 'COMPONENT_SET' ? 'component-set' : 'component';
  const candidates = new Set<string>();
  candidates.add(`${sourceType}:${getCollectionKeyFromMainComponent(mainComponent)}`);
  if (mainComponent.key) {
    candidates.add(`${sourceType}:${mainComponent.key}`);
  }
  if (mainComponent.parent?.type === 'COMPONENT_SET' && (mainComponent.parent as ComponentSetNode).key) {
    candidates.add(`${sourceType}:${(mainComponent.parent as ComponentSetNode).key}`);
  }
  return Array.from(candidates);
}

async function diagnoseExternalResidues(
  expectedMarkers?: Set<string>,
  maxEntries = 12
): Promise<ExternalResidueReport> {
  const collectedMarkers = new Set<string>();
  for (const page of figma.root.children) {
    const collectedNodes = page.findAll((n) => {
      if (n.type !== 'COMPONENT' && n.type !== 'COMPONENT_SET') return false;
      return Boolean(n.getPluginData(COLLECTOR_SOURCE_KEY) && n.getPluginData(COLLECTOR_SOURCE_TYPE));
    }) as SceneNode[];
    for (const node of collectedNodes) {
      const sourceKey = node.getPluginData(COLLECTOR_SOURCE_KEY);
      const sourceType = node.getPluginData(COLLECTOR_SOURCE_TYPE);
      if (sourceKey && sourceType) {
        collectedMarkers.add(`${sourceType}:${sourceKey}`);
      }
    }
  }

  const lines: string[] = [];
  let residueCount = 0;
  for (const page of figma.root.children) {
    const instances = page.findAll((n) => n.type === 'INSTANCE') as InstanceNode[];
    for (const instance of instances) {
      const mainComponent = await instance.getMainComponentAsync();
      if (!mainComponent) continue;
      const targetNodeForSource =
        mainComponent.parent?.type === 'COMPONENT_SET'
          ? (mainComponent.parent as ComponentSetNode)
          : mainComponent;
      if (isNodeInCurrentDocument(targetNodeForSource)) continue;

      const markerCandidates = getInstanceMarkerCandidates(mainComponent);
      if (expectedMarkers && !markerCandidates.some(marker => expectedMarkers.has(marker))) {
        // 不在本次收集目标范围内的外部实例，不计入本次残留
        continue;
      }

      residueCount++;
      if (lines.length >= maxEntries) continue;

      const sourceType = mainComponent.parent?.type === 'COMPONENT_SET' ? 'component-set' : 'component';
      const marker = markerCandidates[0] || `${sourceType}:${getCollectionKeyFromMainComponent(mainComponent)}`;
      const hasCollectedMarker = markerCandidates.some(candidate => collectedMarkers.has(candidate));
      const ancestorMarker = findAncestorCollectedMarker(instance);
      const reason = inferResidueReason(hasCollectedMarker, ancestorMarker);
      lines.push(
        `[${lines.length + 1}] 实例 ${instance.id} (${instance.name}) @页面「${page.name}」 | main=${mainComponent.name} key=${mainComponent.key || 'n/a'} | marker=${marker} | hasMarker=${hasCollectedMarker ? 'Y' : 'N'} | ancestorMarker=${ancestorMarker || 'none'} | 原因推断=${reason}`
      );
    }
  }

  return { count: residueCount, lines };
}

async function rebindNestedInstancesInCollectedNodes(
  roots: SceneNode[]
): Promise<{ rebound: number; failed: number; attempted: number; rounds: number; diagnostics: string[] }> {
  const sourceMap = new Map<string, SceneNode>();
  const uniqueRoots = roots.filter((root, index) => roots.findIndex(r => r.id === root.id) === index);

  for (const root of uniqueRoots) {
    if (root.type !== 'COMPONENT' && root.type !== 'COMPONENT_SET') continue;
    const sourceKey = root.getPluginData(COLLECTOR_SOURCE_KEY);
    const sourceType = root.getPluginData(COLLECTOR_SOURCE_TYPE);
    if (!sourceKey || !sourceType) continue;
    sourceMap.set(`${sourceType}:${sourceKey}`, root);
  }

  let rebound = 0;
  let failed = 0;
  let attempted = 0;
  let rounds = 0;
  const diagnostics: string[] = [];
  const maxRounds = 6;

  for (let round = 1; round <= maxRounds; round++) {
    rounds = round;
    const instanceNodes: InstanceNode[] = [];
    const seenInstanceIds = new Set<string>();
    for (const root of uniqueRoots) {
      if (!('findAll' in root)) continue;
      const nested = root.findAll(n => n.type === 'INSTANCE') as InstanceNode[];
      for (const inst of nested) {
        if (seenInstanceIds.has(inst.id)) continue;
        seenInstanceIds.add(inst.id);
        instanceNodes.push(inst);
      }
    }

    let reboundThisRound = 0;
    await Promise.all(instanceNodes.map(async (instance) => {
      try {
        const mainComponent = await instance.getMainComponentAsync();
        if (!mainComponent) return;
        const stableKey = getInstanceMainStableKey(mainComponent);
        const expectedType = mainComponent.parent?.type === 'COMPONENT_SET' ? 'component-set' : 'component';
        const target = sourceMap.get(`${expectedType}:${stableKey}`);
        if (!target) return;
        if (isMainBoundToTarget(mainComponent, target)) return;
        attempted++;
        if (target.type === 'COMPONENT_SET') {
          const newVariant = findMatchingVariantInSet(target as ComponentSetNode, mainComponent);
          if (!newVariant) {
            failed++;
            appendDiagnosticLine(
              diagnostics,
              `[nested] 实例 ${instance.id} 失败：目标变体未匹配 | main=${mainComponent.name} key=${mainComponent.key || 'n/a'} | targetSet=${target.name}`
            );
            return;
          }
          instance.swapComponent(newVariant);
          rebound++;
          reboundThisRound++;
          return;
        }
        if (target.type === 'COMPONENT') {
          instance.swapComponent(target as ComponentNode);
          rebound++;
          reboundThisRound++;
        }
      } catch (e) {
        failed++;
        appendDiagnosticLine(
          diagnostics,
          `[nested] 实例 ${instance.id} 失败：${getErrorMessage(e)}`
        );
      }
    }));

    // 已收敛：本轮没有任何新增重绑，无需继续
    if (reboundThisRound === 0) {
      break;
    }
  }

  return { rebound, failed, attempted, rounds, diagnostics };
}

// 递归扫描节点以查找主组件、变体组件集和组件实例
async function scanNode(
  node: BaseNode,
  componentsMap: Map<string, ComponentInfo>,
  options: ScanNodeOptions = {}
) {
  const scannedNodes = options.scannedNodes ?? new Set<string>();
  const shouldCollectComponents = options.collectComponents !== false;

  if (scannedNodes.has(node.id)) {
    return;
  }

  scannedNodes.add(node.id);

  if (shouldCollectComponents && node.type === 'COMPONENT_SET') {
    const componentSet = node as ComponentSetNode;
    const targetKey = getCollectionKeyFromComponentSet(componentSet);
    if (!componentsMap.has(targetKey)) {
      componentsMap.set(targetKey, {
        component: componentSet.defaultVariant,
        instanceCount: 0,
        instances: [],
        componentSet
      });
    }
  }

  if (shouldCollectComponents && node.type === 'COMPONENT') {
    const component = node as ComponentNode;
    if (!component.parent || component.parent.type !== 'COMPONENT_SET') {
      const targetKey = getCollectionKeyFromComponent(component);
      if (!componentsMap.has(targetKey)) {
        componentsMap.set(targetKey, {
          component,
          instanceCount: 0,
          instances: [],
          componentSet: undefined
        });
      }
    }
  }

  if (node.type === 'INSTANCE') {
    const instance = node as InstanceNode;
    const mainComponent = await instance.getMainComponentAsync();

    if (mainComponent) {
      const sourceFileKey = parseSourceFileKey(mainComponent.key);
      const targetNodeForSource =
        mainComponent.parent?.type === 'COMPONENT_SET'
          ? (mainComponent.parent as ComponentSetNode)
          : mainComponent;
      const isInternalSource = isNodeInCurrentDocument(targetNodeForSource);
      const externalLibraryName = !isInternalSource
        ? inferExternalLibraryName(targetNodeForSource)
        : undefined;
      const componentSet =
        mainComponent.parent?.type === 'COMPONENT_SET'
          ? (mainComponent.parent as ComponentSetNode)
          : undefined;
      const key = getCollectionKeyFromMainComponent(mainComponent);

      if (options.instanceMap) {
        trackInstanceForMap(options.instanceMap, key, instance);
      }

      if (shouldCollectComponents) {
        const existingInfo = componentsMap.get(key);
        if (existingInfo) {
          existingInfo.instanceCount++;
          if (!existingInfo.sourceFileKey && sourceFileKey) {
            existingInfo.sourceFileKey = sourceFileKey;
          }
          if (!existingInfo.externalLibraryName && externalLibraryName) {
            existingInfo.externalLibraryName = externalLibraryName;
          }
          if (existingInfo.instances.length < 100) {
            existingInfo.instances.push(instance);
          }
        } else {
          componentsMap.set(key, {
            component: mainComponent,
            instanceCount: 1,
            instances: [instance],
            sourceFileKey,
            externalLibraryName,
            componentSet
          });
        }
      }
    }
  }

  if ('children' in node) {
    const children = node.children;
    const totalChildren = children.length;

    if (totalChildren > 2000) {
      const nodeQueue: BaseNode[] = [...children];
      let processedCount = 0;
      const batchSize = 50;

      while (nodeQueue.length > 0) {
        const batch = nodeQueue.splice(0, Math.min(batchSize, nodeQueue.length));
        await Promise.all(
          batch.map(childNode => scanNode(childNode, componentsMap, { ...options, scannedNodes }))
        );
        processedCount += batch.length;

        if (processedCount % 1000 === 0 && totalChildren > 5000) {
          try {
            figma.ui.postMessage({
              type: 'progress',
              message: `扫描 '${node.type}' 节点: ${Math.round((processedCount / totalChildren) * 100)}%`,
              progress: Math.min(99, Math.round((processedCount / totalChildren) * 100))
            });
          } catch (error) {
            console.log('Failed to send progress message, plugin might be closing');
            return;
          }
        }
      }
    } else if (totalChildren > 100) {
      const batchSize = Math.min(50, Math.ceil(totalChildren / 10));
      for (let i = 0; i < totalChildren; i += batchSize) {
        const batch = children.slice(i, Math.min(i + batchSize, totalChildren));
        await Promise.all(
          batch.map(child => scanNode(child, componentsMap, { ...options, scannedNodes }))
        );

        if (i > 0 && i % (batchSize * 3) === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    } else {
      for (let i = 0; i < totalChildren; i++) {
        await scanNode(children[i], componentsMap, { ...options, scannedNodes });
      }
    }
  }
}

// 判断组件是否属于当前文件（非外部引用）
// 通过沿 parent 链向上查找 figma.root 来判断，比 key.includes(':') 更可靠
function isComponentInternal(info: ComponentInfo): boolean {
  const targetNode = info.componentSet || info.component;
  let current: BaseNode | null = targetNode;
  while (current) {
    if (current === figma.root) return true;
    current = current.parent;
  }
  return false;
}

function findPageName(node: BaseNode): string {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'PAGE') {
      return current.name;
    }
    current = current.parent;
  }
  return '未知页面';
}

function shouldKeepPlaceholderInParent(parent: BaseNode): parent is FrameNode | GroupNode {
  return parent.type === 'FRAME' || parent.type === 'GROUP';
}

function isNodeInCurrentDocument(node: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current) {
    if (current === figma.root) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function parseSourceFileKey(componentKey: string): string | undefined {
  if (!componentKey) {
    return undefined;
  }
  const [fileKey] = componentKey.split(':');
  return fileKey || undefined;
}

function inferExternalLibraryName(node: BaseNode): string | undefined {
  // 1) 尝试从父链拿到远程页面名（若 API 可访问）
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'PAGE') {
      return current.name;
    }
    current = current.parent;
  }

  // 2) 回退：组件命名常见的“库名/分类/组件名”约定
  if ('name' in node && typeof node.name === 'string') {
    const segments = node.name.split('/').map(s => s.trim()).filter(Boolean);
    if (segments.length > 1) {
      return segments[0];
    }
  }

  return undefined;
}

function getExternalLibraryPageName(info: ComponentInfo): string {
  return info.externalLibraryName || '外部组件库';
}

// 收集并组织主组件到目标页面
async function collectAndOrganizeComponents(
  targetPageName: string,
  scope: 'file' | 'page' | 'selection',
  externalOnly: boolean = false,
  moveInternal: boolean = false,
  externalSeparatePage: boolean = false,
  selectedComponentIds: string[] = []
): Promise<CollectSummary> {
  const componentsMap = new Map<string, ComponentInfo>();
  const startTime = Date.now();
  const skipPageNames = getPresetTargetPageNames();
  
  try {
    figma.ui.postMessage({ 
      type: 'progress', 
      message: '[1/4] 扫描组件...',
      progress: 0
    });
  } catch (error) {
    console.log('Failed to send progress message, plugin might be closing');
    throw new Error('插件正在关闭');
  }
  
  const instanceMap = await performComponentScanning(scope, componentsMap, startTime, skipPageNames);
  
  if (componentsMap.size === 0) {
    throw new Error('未找到任何组件实例');
  }
  
  if (externalOnly) {
    await filterExternalComponents(componentsMap);
  }
  if (selectedComponentIds.length > 0) {
    await filterComponentsBySelectedIds(componentsMap, selectedComponentIds);
  }

  await sendProgressMessage('[2/4] 扩展嵌套依赖组件...', 28);
  await expandComponentsWithNestedDependencies(componentsMap);

  await sendProgressMessage('[3/4] 创建组件库页面...', 35);
  
  const targetPage = await getOrCreateTargetPage(targetPageName);
  await figma.setCurrentPageAsync(targetPage);
  
  const summary = await processAndArrangeComponents(
    componentsMap,
    instanceMap,
    targetPage,
    startTime,
    moveInternal,
    externalSeparatePage
  );
  await sendProgressMessage('[4/4] 完成', 100);
  return summary;
}

async function performComponentScanning(
  scope: string,
  componentsMap: Map<string, ComponentInfo>,
  startTime: number,
  skipPageNames: Set<string> = new Set()
): Promise<Map<string, InstanceNode[]>> {
  const instanceMap = new Map<string, InstanceNode[]>();
  const scannedNodes = new Set<string>();

  if (scope === 'selection') {
    if (shouldSkipPageForScanning(figma.currentPage, skipPageNames)) {
      throw new Error(`当前页面「${figma.currentPage.name}」是预设目标页，请切换到业务页面后再收集`);
    }
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      throw new Error('请先选择一个画板或节点');
    }
    
    const totalNodes = selection.length;
    const maxNodesToProcess = 3000;
    const nodesToProcess = totalNodes > maxNodesToProcess ? selection.slice(0, maxNodesToProcess) : selection;
    const actualTotalNodes = nodesToProcess.length;
    
    const adaptiveBatchSize = Math.min(50, Math.max(10, Math.floor(actualTotalNodes / 20)));
    let processedNodes = 0;
    
    for (let i = 0; i < nodesToProcess.length; i += adaptiveBatchSize) {
      const batch = nodesToProcess.slice(i, i + adaptiveBatchSize);
      await Promise.all(batch.map(node => scanNode(node, componentsMap, {
        scannedNodes,
        instanceMap,
        collectComponents: true
      })));
      processedNodes += batch.length;
      
      if (processedNodes % Math.max(25, Math.floor(actualTotalNodes / 10)) === 0) {
        const progress = Math.floor((processedNodes / actualTotalNodes) * 20);
        const elapsedTime = Date.now() - startTime;
        const estimatedTotalTime = (elapsedTime / processedNodes) * actualTotalNodes;
        const remainingTime = Math.max(0, Math.round((estimatedTotalTime - elapsedTime) / 1000));
        
        await sendProgressMessage(
          `[1/4] 扫描选择项 ${processedNodes}/${actualTotalNodes}，预计剩余时间: ${remainingTime}秒` + 
          (totalNodes > maxNodesToProcess ? ` (已限制处理数量)` : ''),
          progress
        );
      }
      
      if (i % (adaptiveBatchSize * 3) === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    if (totalNodes > maxNodesToProcess) {
      figma.notify(`注意：选择的节点过多，仅处理了前${maxNodesToProcess}个节点。`, { timeout: 5000 });
    }

    // 对未扫描区域补全实例映射，避免漏掉其他页面上的实例重绑
    await sendProgressMessage('[2/4] 补充扫描文档实例映射...', 15);
    const pages = [...figma.root.children].filter(page => !shouldSkipPageForScanning(page, skipPageNames));
    for (const page of pages) {
      await scanNode(page, componentsMap, { scannedNodes, instanceMap, collectComponents: false });
    }
  } else if (scope === 'page') {
    if (shouldSkipPageForScanning(figma.currentPage, skipPageNames)) {
      throw new Error(`当前页面「${figma.currentPage.name}」是预设目标页，请切换到业务页面后再收集`);
    }
    await scanNode(figma.currentPage, componentsMap, {
      scannedNodes,
      instanceMap,
      collectComponents: true
    });

    await sendProgressMessage('[2/4] 补充扫描文档实例映射...', 15);
    const pages = [...figma.root.children].filter(page => !shouldSkipPageForScanning(page, skipPageNames));
    for (const page of pages) {
      await scanNode(page, componentsMap, { scannedNodes, instanceMap, collectComponents: false });
    }

    await sendProgressMessage('[1/4] 扫描当前页面完成', 30);
  } else {
    const pages = [...figma.root.children].filter(page => !shouldSkipPageForScanning(page, skipPageNames));
    const totalPageCount = pages.length;
    let processedPages = 0;
    const adaptiveConcurrencyLimit = Math.min(8, Math.max(4, Math.floor(totalPageCount / 2)));
    if (totalPageCount === 0) {
      return instanceMap;
    }
    
    for (let i = 0; i < pages.length; i += adaptiveConcurrencyLimit) {
      const batch = pages.slice(i, i + adaptiveConcurrencyLimit);
      await Promise.all(batch.map(page => scanNode(page, componentsMap, {
        scannedNodes,
        instanceMap,
        collectComponents: true
      })));
      processedPages += batch.length;
      
      await sendProgressMessage(
        `[1/4] 扫描页面 ${processedPages}/${totalPageCount}: ${batch.map(p => p.name).join(', ')}`,
        Math.floor((processedPages / totalPageCount) * 30)
      );
      
      if (i % (adaptiveConcurrencyLimit * 2) === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  return instanceMap;
}

async function filterExternalComponents(componentsMap: Map<string, ComponentInfo>) {
  const externalComponents = new Map<string, ComponentInfo>();
  const componentArray = Array.from(componentsMap.entries());
  const batchSize = 50;
  
  for (let i = 0; i < componentArray.length; i += batchSize) {
    const batch = componentArray.slice(i, i + batchSize);
    
    batch.forEach(([key, info]) => {
      if (!isComponentInternal(info)) {
        externalComponents.set(key, info);
      }
    });
    
    if (i > 0 && i % (batchSize * 2) === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  if (externalComponents.size === 0) {
    throw new Error('未找到任何外部组件');
  }
  
  componentsMap.clear();
  for (const [key, value] of externalComponents) {
    componentsMap.set(key, value);
  }
}

async function collectNestedDependencyKeys(
  rootNode: BaseNode,
  componentsMap: Map<string, ComponentInfo>,
  selectedKeys: Set<string>,
  visitedNodes: Set<string>
): Promise<string[]> {
  const dependencies: string[] = [];
  const queue: BaseNode[] = [rootNode];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || visitedNodes.has(node.id)) continue;
    visitedNodes.add(node.id);

    if (node.type === 'INSTANCE') {
      const mainComponent = await (node as InstanceNode).getMainComponentAsync();
      if (mainComponent) {
        const depKey = getComponentKeyFromMainComponent(mainComponent);
        if (!selectedKeys.has(depKey) && componentsMap.has(depKey)) {
          dependencies.push(depKey);
        }
      }
    }

    if ('children' in node) {
      queue.push(...node.children);
    }
  }

  return dependencies;
}

async function filterComponentsBySelectedIds(
  componentsMap: Map<string, ComponentInfo>,
  selectedComponentIds: string[]
) {
  const selectedKeys = new Set(
    selectedComponentIds.filter(id => typeof id === 'string' && componentsMap.has(id))
  );

  if (selectedKeys.size === 0) {
    throw new Error('未选中可收集的组件');
  }

  const visitedNodes = new Set<string>();
  const pendingKeys = [...selectedKeys];
  while (pendingKeys.length > 0) {
    const key = pendingKeys.shift();
    if (!key) continue;
    const info = componentsMap.get(key);
    if (!info) continue;
    const rootNode = info.componentSet || info.component;
    const dependencyKeys = await collectNestedDependencyKeys(rootNode, componentsMap, selectedKeys, visitedNodes);
    for (const depKey of dependencyKeys) {
      if (!selectedKeys.has(depKey)) {
        selectedKeys.add(depKey);
        pendingKeys.push(depKey);
      }
    }
  }

  const selectedComponents = new Map<string, ComponentInfo>();
  for (const key of selectedKeys) {
    const info = componentsMap.get(key);
    if (info) {
      selectedComponents.set(key, info);
    }
  }

  if (selectedComponents.size === 0) {
    throw new Error('未找到可收集的组件');
  }

  componentsMap.clear();
  for (const [key, value] of selectedComponents) {
    componentsMap.set(key, value);
  }
}

async function expandComponentsWithNestedDependencies(
  componentsMap: Map<string, ComponentInfo>
) {
  const pendingKeys = [...componentsMap.keys()];
  const scannedKeys = new Set<string>();

  while (pendingKeys.length > 0) {
    const key = pendingKeys.shift();
    if (!key || scannedKeys.has(key)) continue;
    scannedKeys.add(key);

    const info = componentsMap.get(key);
    if (!info) continue;
    const rootNode = info.componentSet || info.component;
    const queue: BaseNode[] = [rootNode];
    const visitedNodeIds = new Set<string>();

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || visitedNodeIds.has(node.id)) continue;
      visitedNodeIds.add(node.id);

      if (node.type === 'INSTANCE') {
        const mainComponent = await (node as InstanceNode).getMainComponentAsync();
        if (mainComponent) {
          const componentSet =
            mainComponent.parent?.type === 'COMPONENT_SET'
              ? (mainComponent.parent as ComponentSetNode)
              : undefined;
          const depKey = getCollectionKeyFromMainComponent(mainComponent);
          if (!componentsMap.has(depKey)) {
            const targetNodeForSource = componentSet || mainComponent;
            const isInternalSource = isNodeInCurrentDocument(targetNodeForSource);
            const externalLibraryName = !isInternalSource
              ? inferExternalLibraryName(targetNodeForSource)
              : undefined;
            componentsMap.set(depKey, {
              component: mainComponent,
              componentSet,
              instanceCount: 0,
              instances: [],
              sourceFileKey: parseSourceFileKey(mainComponent.key),
              externalLibraryName
            });
            pendingKeys.push(depKey);
          }
        }
      }

      if ('children' in node) {
        queue.push(...node.children);
      }
    }
  }
}

async function getOrCreateTargetPage(targetPageName: string): Promise<PageNode> {
  let targetPage = figma.root.children.find(
    page => page.name === targetPageName
  ) as PageNode;
  
  if (!targetPage) {
    targetPage = figma.createPage();
    targetPage.name = targetPageName;
  }
  
  return targetPage;
}

async function sendProgressMessage(message: string, progress: number) {
  try {
    figma.ui.postMessage({ type: 'progress', message, progress });
  } catch (error) {
    console.log('Failed to send progress message, plugin might be closing');
  }
}

async function processAndArrangeComponents(
  componentsMap: Map<string, ComponentInfo>, 
  instanceMap: Map<string, InstanceNode[]>, 
  targetPage: PageNode, 
  startTime: number,
  moveInternal: boolean,
  externalSeparatePage: boolean
): Promise<CollectSummary> {
  const spacing = 200;
  const externalPageCache = new Map<string, PageNode>();
  const layoutGroupsByPage = new Map<string, { page: PageNode; columns: Map<number, SceneNode[]> }>();
  
  const processedComponents: SceneNode[] = [];
  let componentSetCount = 0;
  let singleComponentCount = 0;
  let instancesAttempted = 0;
  let instancesRebound = 0;
  let instancesFailed = 0;
  let internalMoved = 0;
  let internalCloned = 0;
  let fallbackToClone = 0;
  const processedRootNodes: SceneNode[] = [];
  const failedInstanceDiagnostics: string[] = [];
  const expectedResidueMarkers = new Set<string>();
  for (const [, info] of componentsMap) {
    const sourceType = info.componentSet ? 'component-set' : 'component';
    expectedResidueMarkers.add(`${sourceType}:${getCollectionKeyFromInfo(info)}`);
    expectedResidueMarkers.add(`${sourceType}:${getSourceStableKey(info)}`);
  }
  
  const totalComponents = componentsMap.size;
  let processedCount = 0;
  const componentArray = Array.from(componentsMap.entries());
  const adaptiveBatchSize = Math.min(30, Math.max(10, Math.floor(totalComponents / 10)));
  
  for (let i = 0; i < componentArray.length; i += adaptiveBatchSize) {
    const batch = componentArray.slice(i, i + adaptiveBatchSize);

    const nodesOnTargetPage = await Promise.all(batch.map(async ([, info]) => {
      processedCount++;
      const isInternal = isComponentInternal(info);
      let pageForComponent = targetPage;

      if (externalSeparatePage && !isInternal) {
        const externalPageName = EXTERNAL_COMPONENTS_PAGE_NAME;
        const cachedPage = externalPageCache.get(externalPageName);
        if (cachedPage) {
          pageForComponent = cachedPage;
        } else {
          const externalPage = await getOrCreateTargetPage(externalPageName);
          externalPageCache.set(externalPageName, externalPage);
          pageForComponent = externalPage;
        }
      }

      if (info.componentSet) {
        componentSetCount++;
        return processComponentSet(info, pageForComponent, instanceMap, processedComponents, isInternal, moveInternal);
      } else {
        singleComponentCount++;
        return processSingleComponent(info, pageForComponent, instanceMap, processedComponents, isInternal, moveInternal);
      }
    }));

    for (let j = 0; j < batch.length; j++) {
      const outcome = nodesOnTargetPage[j];
      if (!outcome || !outcome.node) continue;

      const nodeOnTargetPage = outcome.node;
      processedRootNodes.push(nodeOnTargetPage);
      instancesAttempted += outcome.instancesAttempted;
      instancesRebound += outcome.instancesRebound;
      instancesFailed += outcome.instancesFailed;
      outcome.failureDetails.forEach(line => appendDiagnosticLine(failedInstanceDiagnostics, line));
      if (outcome.movedInternal) internalMoved++;
      if (outcome.cloned) internalCloned++;
      if (outcome.fallbackToClone) fallbackToClone++;

      const page = nodeOnTargetPage.parent;
      if (!page || page.type !== 'PAGE') {
        continue;
      }

      let pageLayout = layoutGroupsByPage.get(page.id);
      if (!pageLayout) {
        pageLayout = { page, columns: new Map<number, SceneNode[]>() };
        layoutGroupsByPage.set(page.id, pageLayout);
      }

      const widthGroupKey = Math.round(nodeOnTargetPage.width);
      const columnNodes = pageLayout.columns.get(widthGroupKey) || [];
      columnNodes.push(nodeOnTargetPage);
      pageLayout.columns.set(widthGroupKey, columnNodes);
    }
    
    const overallProgress = 35 + Math.floor((processedCount / totalComponents) * 55);
    const elapsedTime = Date.now() - startTime;
    const estimatedTotalTime = (elapsedTime / processedCount) * totalComponents;
    const remainingTime = Math.max(0, Math.round((estimatedTotalTime - elapsedTime) / 1000));
    
    await sendProgressMessage(
      `[4/4] 正在处理组件 ${processedCount}/${totalComponents}，预计剩余时间: ${remainingTime}秒`,
      overallProgress
    );
    
    if (i > 0 && i % (adaptiveBatchSize * 2) === 0) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  // 收集完成后统一按宽度分列排版：
  // - 同宽度组件归入同一列
  // - 列内纵向排列，间距 200
  // - 列间横向间距 200，列宽按该列最大组件宽度计算
  for (const [, pageLayout] of layoutGroupsByPage) {
    let xOffset = 0;
    const sortedColumns = Array.from(pageLayout.columns.entries()).sort((a, b) => b[0] - a[0]);

    for (const [, columnNodes] of sortedColumns) {
      let yOffset = 0;
      let maxColumnWidth = 0;

      for (const node of columnNodes) {
        maxColumnWidth = Math.max(maxColumnWidth, node.width);
        try {
          node.x = xOffset;
          node.y = yOffset;
          yOffset += node.height + spacing;
        } catch (e) {
          if (e instanceof Error) console.warn(`无法设置节点位置: ${node.name} - ${e.message}`);
        }
      }

      xOffset += maxColumnWidth + spacing;
    }
  }

  // 补偿重绑：第一次收集时，新克隆母组件内部产生的实例不在初次 instanceMap 中
  // 在此阶段直接遍历已收集母组件内部实例，立即重绑到本次收集的本地母组件，避免必须二次收集。
  const nestedRebind = await rebindNestedInstancesInCollectedNodes(processedRootNodes);
  instancesAttempted += nestedRebind.attempted;
  instancesRebound += nestedRebind.rebound;
  instancesFailed += nestedRebind.failed;
  nestedRebind.diagnostics.forEach(line => appendDiagnosticLine(failedInstanceDiagnostics, line));

  const residueReport = await diagnoseExternalResidues(expectedResidueMarkers);
  if (residueReport.count > 0) {
    console.warn(`收集后仍存在外部组件实例: ${residueReport.count}`);
    residueReport.lines.forEach(line => console.warn(line));
  }
  
  if (processedComponents.length > 0) {
    figma.currentPage.selection = processedComponents.filter(node => node.parent?.id === targetPage.id);
  }
  
  console.log(`处理完成: ${componentSetCount} 个变体组件集, ${singleComponentCount} 个单组件`);
  console.log(`实例重绑: 成功 ${instancesRebound}, 失败 ${instancesFailed}`);

  return {
    totalComponents,
    componentSetCount,
    singleComponentCount,
    instancesAttempted,
    instancesRebound,
    instancesFailed,
    internalMoved,
    internalCloned,
    fallbackToClone,
    externalPagesCreated: externalPageCache.size,
    externalResidualCount: residueReport.count,
    externalResidualDiagnostics: residueReport.lines,
    failedInstanceDiagnostics
  };
}

async function processComponentSet(
  info: ComponentInfo,
  targetPage: PageNode,
  instanceMap: Map<string, InstanceNode[]>,
  processedComponents: SceneNode[],
  isInternal: boolean,
  moveInternal: boolean
): Promise<ProcessOutcome> {
  let instancesAttempted = 0;
  let instancesRebound = 0;
  let instancesFailed = 0;
  let movedInternal = false;
  let cloned = false;
  let fallbackToClone = false;
  const failureDetails: string[] = [];
  const componentSet = info.componentSet!;
  let existingSet = findCollectedNodeOnPage<ComponentSetNode>(targetPage, info, 'COMPONENT_SET');
  if (existingSet) {
    markCollectedSource(existingSet, info);
  }

  if (isInternal && moveInternal) {
    // 本文件变体集：移动到目标页，在原位置保留各变体的实例
    const originalParent = componentSet.parent;
    const originalX = componentSet.x;
    const originalY = componentSet.y;
    const originalIndex = originalParent ? getChildIndexInParent(originalParent, componentSet.id) : -1;
    if (!originalParent) {
      appendDiagnosticLine(failureDetails, `[set] ${componentSet.name} 失败：原始父级不存在`);
      return { node: null, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone, failureDetails };
    }

    // 移动前，记录所有变体及其在 ComponentSet 内的相对位置
    const variantInfos: Array<{ variant: ComponentNode; relX: number; relY: number }> = [];
    for (const child of componentSet.children) {
      if (child.type === 'COMPONENT') {
        variantInfos.push({
          variant: child as ComponentNode,
          relX: child.x,
          relY: child.y
        });
      }
    }

    try {
      if (componentSet.parent?.id !== targetPage.id) {
        targetPage.appendChild(componentSet); // 移动
        movedInternal = true;
      }
      processedComponents.push(componentSet);
      existingSet = componentSet;
      markCollectedSource(existingSet, info);
    } catch (e) {
      // 移动失败（可能是只读节点），回退到克隆
      console.warn(`移动组件集失败，回退到克隆: ${componentSet.name}`);
      const clonedSet = componentSet.clone();
      targetPage.appendChild(clonedSet);
      processedComponents.push(clonedSet);
      existingSet = clonedSet;
      markCollectedSource(existingSet, info);
      cloned = true;
      fallbackToClone = true;

      const instances = instanceMap.get(getCollectionKeyFromInfo(info)) || [];
      instancesAttempted += instances.length;
      await Promise.all(instances.map(async instance => {
        try {
          const mainComponent = await instance.getMainComponentAsync();
          const newVariant = findMatchingVariantForInstance(existingSet!, instance, mainComponent);
          if (newVariant) {
            instance.swapComponent(newVariant);
            instancesRebound++;
          } else {
            instancesFailed++;
            appendDiagnosticLine(
              failureDetails,
              `[set-fallback] 实例 ${instance.id} 失败：未在克隆组件集中找到同名变体 | main=${mainComponent?.name || 'n/a'}`
            );
          }
        } catch (e) {
          instancesFailed++;
          appendDiagnosticLine(
            failureDetails,
            `[set-fallback] 实例 ${instance.id} 失败：${getErrorMessage(e)} | variantProps=${JSON.stringify(getVariantPropsForInstance(instance))}`
          );
        }
      }));
      return { node: existingSet, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone, failureDetails };
    }

    // 在原位置创建一个 Frame，放入各变体的实例
    if (
      originalParent !== targetPage &&
      variantInfos.length > 0 &&
      shouldKeepPlaceholderInParent(originalParent)
    ) {
      try {
        const holder = figma.createFrame();
        holder.name = componentSet.name + ' (instances)';
        holder.resize(componentSet.width, componentSet.height);
        holder.fills = []; // 透明背景
        if (originalIndex >= 0) {
          insertChildAtOriginalIndex(originalParent, holder, originalIndex);
        } else {
          originalParent.appendChild(holder);
        }
        holder.x = originalX;
        holder.y = originalY;

        for (const vi of variantInfos) {
          try {
            const inst = vi.variant.createInstance();
            holder.appendChild(inst);
            inst.x = vi.relX;
            inst.y = vi.relY;
          } catch (e) {
            if (e instanceof Error) console.warn(`创建变体实例失败: ${vi.variant.name} - ${e.message}`);
          }
        }
      } catch (e) {
        if (e instanceof Error) console.warn(`在原位创建变体实例集失败: ${componentSet.name} - ${e.message}`);
      }
    }
    return { node: existingSet, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone, failureDetails };
  }

  // 内部组件未开启移动：不克隆，保留原母组件
  if (isInternal && !moveInternal) {
    return { node: existingSet, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone, failureDetails };
  }

  // 外部组件集：克隆到目标页，所有实例 rebind 到克隆
  if (!existingSet) {
    const clonedSet = componentSet.clone();
    targetPage.appendChild(clonedSet);
    processedComponents.push(clonedSet);
    existingSet = clonedSet;
    markCollectedSource(existingSet, info);
    cloned = true;
  }

  const instances = instanceMap.get(getCollectionKeyFromInfo(info)) || [];
  instancesAttempted += instances.length;
  await Promise.all(instances.map(async instance => {
    try {
      const mainComponent = await instance.getMainComponentAsync();
      const newVariant = findMatchingVariantForInstance(existingSet!, instance, mainComponent);
      if (newVariant) {
        instance.swapComponent(newVariant);
        instancesRebound++;
      } else {
        instancesFailed++;
        appendDiagnosticLine(
          failureDetails,
          `[set] 实例 ${instance.id} 失败：未找到匹配变体 | main=${mainComponent?.name || 'n/a'} | target=${existingSet!.name} | variantProps=${JSON.stringify(getVariantPropsForInstance(instance))}`
        );
      }
    } catch (e) {
      instancesFailed++;
      appendDiagnosticLine(
        failureDetails,
        `[set] 实例 ${instance.id} 失败：${getErrorMessage(e)} | variantProps=${JSON.stringify(getVariantPropsForInstance(instance))}`
      );
      if (e instanceof Error) console.log(`无法重新绑定实例: ${e.message}`);
    }
  }));
  return { node: existingSet, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone, failureDetails };
}

async function processSingleComponent(
  info: ComponentInfo,
  targetPage: PageNode,
  instanceMap: Map<string, InstanceNode[]>,
  processedComponents: SceneNode[],
  isInternal: boolean,
  moveInternal: boolean
): Promise<ProcessOutcome> {
  let instancesAttempted = 0;
  let instancesRebound = 0;
  let instancesFailed = 0;
  let movedInternal = false;
  let cloned = false;
  let fallbackToClone = false;
  const failureDetails: string[] = [];
  const component = info.component;
  let existingComponent = findCollectedNodeOnPage<ComponentNode>(targetPage, info, 'COMPONENT');
  if (existingComponent) {
    markCollectedSource(existingComponent, info);
  }

  if (isInternal && moveInternal) {
    // 本文件组件：移动到目标页，在原位置保留一个实例
    const originalParent = component.parent;
    const originalX = component.x;
    const originalY = component.y;
    const originalIndex = originalParent ? getChildIndexInParent(originalParent, component.id) : -1;
    if (!originalParent) {
      appendDiagnosticLine(failureDetails, `[single] ${component.name} 失败：原始父级不存在`);
      return { node: null, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone, failureDetails };
    }

    try {
      if (component.parent?.id !== targetPage.id) {
        targetPage.appendChild(component); // 移动
        movedInternal = true;
      }
      processedComponents.push(component);
      existingComponent = component;
      markCollectedSource(existingComponent, info);
    } catch (e) {
      // 移动失败（可能是只读节点），回退到克隆
      console.warn(`移动组件失败，回退到克隆: ${component.name}`);
      const clonedComponent = component.clone();
      targetPage.appendChild(clonedComponent);
      processedComponents.push(clonedComponent);
      existingComponent = clonedComponent;
      markCollectedSource(existingComponent, info);
      cloned = true;
      fallbackToClone = true;

      // 回退到克隆时需要 swap 实例
      const instances = instanceMap.get(getCollectionKeyFromInfo(info)) || [];
      instancesAttempted += instances.length;
      await Promise.all(instances.map(async instance => {
        try {
          instance.swapComponent(existingComponent!);
          instancesRebound++;
        } catch (e) {
          instancesFailed++;
          appendDiagnosticLine(failureDetails, `[single-fallback] 实例 ${instance.id} 失败：${getErrorMessage(e)}`);
        }
      }));
      return { node: existingComponent, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone, failureDetails };
    }

    if (originalParent !== targetPage && shouldKeepPlaceholderInParent(originalParent)) {
      try {
        const placeholderInstance = component.createInstance();
        if (originalIndex >= 0) {
          insertChildAtOriginalIndex(originalParent, placeholderInstance, originalIndex);
        } else {
          originalParent.appendChild(placeholderInstance);
        }
        placeholderInstance.x = originalX;
        placeholderInstance.y = originalY;
      } catch (e) {
        if (e instanceof Error) console.warn(`在原位创建实例失败: ${component.name} - ${e.message}`);
      }
    }
    return { node: existingComponent, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone, failureDetails };
  }

  // 内部组件未开启移动：不克隆，保留原母组件
  if (isInternal && !moveInternal) {
    return { node: existingComponent, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone, failureDetails };
  }

  // 默认模式或外部组件：克隆到目标页
  if (!existingComponent) {
    const clonedComponent = component.clone();
    targetPage.appendChild(clonedComponent);
    processedComponents.push(clonedComponent);
    existingComponent = clonedComponent;
    markCollectedSource(existingComponent, info);
    cloned = true;
  }

  const instances = instanceMap.get(getCollectionKeyFromInfo(info)) || [];
  instancesAttempted += instances.length;
  await Promise.all(instances.map(async instance => {
    try {
      instance.swapComponent(existingComponent!);
      instancesRebound++;
    } catch (e) {
      instancesFailed++;
      appendDiagnosticLine(failureDetails, `[single] 实例 ${instance.id} 失败：${getErrorMessage(e)}`);
      if (e instanceof Error) console.log(`无法重新绑定实例: ${e.message}`);
    }
  }));
  return { node: existingComponent, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone, failureDetails };
}
