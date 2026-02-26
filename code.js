"use strict";
// Figma Component Collector Plugin
// 主插件代码
/// <reference types="@figma/plugin-typings" />
// 性能监控类
class PerformanceMonitor {
    constructor() {
        this.measurements = new Map();
        this.history = new Map();
    }
    startMeasurement(name) {
        this.measurements.set(name, { start: Date.now() });
        // 清理过期的测量数据
        if (this.measurements.size > 100) {
            const firstKey = Array.from(this.measurements.keys())[0];
            this.measurements.delete(firstKey);
        }
    }
    endMeasurement(name) {
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
        const history = this.history.get(name);
        history.push(duration);
        if (history.length > 50) {
            history.shift(); // 保持最近50次记录
        }
        this.measurements.delete(name);
        return duration;
    }
    getAverageDuration(name) {
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
let selectionChangeTimeout = null;
let lastSelectionString = '';
let lastPageId = figma.currentPage.id;
figma.showUI(__html__, { width: 340, height: 600 });
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
            try {
                figma.ui.postMessage({
                    type: 'selection-changed',
                    hasSelection: figma.currentPage.selection.length > 0
                });
            }
            catch (error) {
                // 忽略发送消息时的错误（可能是插件正在关闭）
                console.log('Failed to send selection-changed message, plugin might be closing');
            }
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
        }
        catch (error) {
            // 忽略发送消息时的错误（可能是插件正在关闭）
            console.log('Failed to send page-changed message, plugin might be closing');
        }
    }
});
// 监听来自 UI 的消息
figma.ui.onmessage = async (msg) => {
    perfMonitor.startMeasurement('message-processing');
    // 根据消息类型处理不同操作
    switch (msg.type) {
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
            const { sourceNodeId, firstInstanceId } = msg;
            try {
                const masterNode = figma.getNodeById(sourceNodeId);
                const nodeToSelect = masterNode !== null && masterNode !== void 0 ? masterNode : (firstInstanceId ? figma.getNodeById(firstInstanceId) : null);
                if (nodeToSelect) {
                    figma.currentPage.selection = [nodeToSelect];
                    figma.viewport.scrollAndZoomIntoView([nodeToSelect]);
                }
            }
            catch (e) {
                console.warn('focus-component failed:', e);
            }
            break;
        }
        case 'collect-components': {
            // 收集组件
            try {
                const summary = await collectAndOrganizeComponents(msg.targetPageName, msg.scope, msg.externalOnly, msg.moveInternal === true, msg.externalSeparatePage === true);
                const detailLines = [
                    `组件 ${summary.totalComponents}（变体集 ${summary.componentSetCount} / 单组件 ${summary.singleComponentCount}）`,
                    `实例重绑 成功 ${summary.instancesRebound} / 失败 ${summary.instancesFailed}`,
                    `内部组件 移动 ${summary.internalMoved} / 克隆 ${summary.internalCloned}`,
                    `外部分组页面新增 ${summary.externalPagesCreated}`
                ];
                figma.ui.postMessage({
                    type: 'success',
                    message: `已收集到页面「${msg.targetPageName}」`,
                    details: detailLines.join('\n')
                });
            }
            catch (err) {
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
async function scanFileForComponents(scope) {
    console.log('scanFileForComponents called with scope:', scope);
    const componentsMap = new Map();
    const startTime = Date.now();
    if (scope === 'selection') {
        console.log('Processing selection mode');
        const selection = figma.currentPage.selection;
        console.log('Current selection length:', selection.length);
        if (selection.length === 0) {
            console.log('No selection found, switching to page mode');
            scope = 'page';
        }
        else {
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
                    }
                    catch (error) {
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
        return buildScanResults(componentsMap, scope);
    }
    if (scope === 'page') {
        console.log('Processing page mode');
        const currentPage = figma.currentPage;
        try {
            figma.ui.postMessage({
                type: 'progress',
                message: `开始扫描页面: ${currentPage.name}`,
                progress: 10
            });
        }
        catch (error) {
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
                }
                catch (error) {
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
        }
        catch (error) {
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
    else {
        console.log('Processing file mode');
        const totalPageCount = figma.root.children.length;
        let processedPages = 0;
        const concurrencyLimit = 8;
        const pages = [...figma.root.children];
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
            }
            catch (error) {
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
    return buildScanResults(componentsMap, scope);
}
// 构建扫描结果
function buildScanResults(componentsMap, scope) {
    let componentSetCount = 0;
    const componentsList = [];
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
            let current = targetNode;
            while (current) {
                if (current === figma.root) {
                    isInCurrentDocument = true;
                    break;
                }
                current = current.parent;
            }
            const firstInstanceId = info.instances.length > 0 ? info.instances[0].id : null;
            componentsList.push({
                id: key,
                name: targetNode.name,
                instanceCount: info.instanceCount,
                isExternal: !isInCurrentDocument,
                sourceFileKey: info.sourceFileKey || '',
                sourceNodeId: targetNode.id,
                firstInstanceId,
                pageName: findPageName(targetNode),
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
        scope: scope
    };
}
function trackInstanceForMap(instanceMap, key, instance, maxInstancesPerComponent = 200) {
    const existingInstances = instanceMap.get(key);
    if (existingInstances) {
        if (existingInstances.length <= maxInstancesPerComponent) {
            existingInstances.push(instance);
            if (existingInstances.length === maxInstancesPerComponent + 1) {
                console.log(`组件 ${key} 的实例数量已达上限 (${maxInstancesPerComponent})`);
            }
        }
    }
    else {
        instanceMap.set(key, [instance]);
    }
}
// 递归扫描节点以查找主组件、变体组件集和组件实例
async function scanNode(node, componentsMap, options = {}) {
    var _a, _b, _c;
    const scannedNodes = (_a = options.scannedNodes) !== null && _a !== void 0 ? _a : new Set();
    const shouldCollectComponents = options.collectComponents !== false;
    if (scannedNodes.has(node.id)) {
        return;
    }
    scannedNodes.add(node.id);
    if (shouldCollectComponents && node.type === 'COMPONENT_SET') {
        const componentSet = node;
        const targetKey = componentSet.id;
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
        const component = node;
        if (!component.parent || component.parent.type !== 'COMPONENT_SET') {
            const targetKey = component.id;
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
        const instance = node;
        const mainComponent = await instance.getMainComponentAsync();
        if (mainComponent) {
            const sourceFileKey = parseSourceFileKey(mainComponent.key);
            const targetNodeForSource = ((_b = mainComponent.parent) === null || _b === void 0 ? void 0 : _b.type) === 'COMPONENT_SET'
                ? mainComponent.parent
                : mainComponent;
            const isInternalSource = isNodeInCurrentDocument(targetNodeForSource);
            const externalLibraryName = !isInternalSource
                ? inferExternalLibraryName(targetNodeForSource)
                : undefined;
            const componentSet = ((_c = mainComponent.parent) === null || _c === void 0 ? void 0 : _c.type) === 'COMPONENT_SET'
                ? mainComponent.parent
                : undefined;
            const key = componentSet ? componentSet.id : mainComponent.id;
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
                }
                else {
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
            const nodeQueue = [...children];
            let processedCount = 0;
            const batchSize = 50;
            while (nodeQueue.length > 0) {
                const batch = nodeQueue.splice(0, Math.min(batchSize, nodeQueue.length));
                await Promise.all(batch.map(childNode => scanNode(childNode, componentsMap, Object.assign(Object.assign({}, options), { scannedNodes }))));
                processedCount += batch.length;
                if (processedCount % 1000 === 0 && totalChildren > 5000) {
                    try {
                        figma.ui.postMessage({
                            type: 'progress',
                            message: `扫描 '${node.type}' 节点: ${Math.round((processedCount / totalChildren) * 100)}%`,
                            progress: Math.min(99, Math.round((processedCount / totalChildren) * 100))
                        });
                    }
                    catch (error) {
                        console.log('Failed to send progress message, plugin might be closing');
                        return;
                    }
                }
            }
        }
        else if (totalChildren > 100) {
            const batchSize = Math.min(50, Math.ceil(totalChildren / 10));
            for (let i = 0; i < totalChildren; i += batchSize) {
                const batch = children.slice(i, Math.min(i + batchSize, totalChildren));
                await Promise.all(batch.map(child => scanNode(child, componentsMap, Object.assign(Object.assign({}, options), { scannedNodes }))));
                if (i > 0 && i % (batchSize * 3) === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
        }
        else {
            for (let i = 0; i < totalChildren; i++) {
                await scanNode(children[i], componentsMap, Object.assign(Object.assign({}, options), { scannedNodes }));
            }
        }
    }
}
// 判断组件是否属于当前文件（非外部引用）
// 通过沿 parent 链向上查找 figma.root 来判断，比 key.includes(':') 更可靠
function isComponentInternal(info) {
    const targetNode = info.componentSet || info.component;
    let current = targetNode;
    while (current) {
        if (current === figma.root)
            return true;
        current = current.parent;
    }
    return false;
}
function findPageName(node) {
    let current = node;
    while (current) {
        if (current.type === 'PAGE') {
            return current.name;
        }
        current = current.parent;
    }
    return '未知页面';
}
function shouldKeepPlaceholderInParent(parent) {
    return parent.type === 'FRAME' || parent.type === 'GROUP';
}
function isNodeInCurrentDocument(node) {
    let current = node;
    while (current) {
        if (current === figma.root) {
            return true;
        }
        current = current.parent;
    }
    return false;
}
function parseSourceFileKey(componentKey) {
    if (!componentKey) {
        return undefined;
    }
    const [fileKey] = componentKey.split(':');
    return fileKey || undefined;
}
function inferExternalLibraryName(node) {
    // 1) 尝试从父链拿到远程页面名（若 API 可访问）
    let current = node;
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
function getExternalLibraryPageName(info) {
    return info.externalLibraryName || '外部组件库';
}
// 收集并组织主组件到目标页面
async function collectAndOrganizeComponents(targetPageName, scope, externalOnly = false, moveInternal = false, externalSeparatePage = false) {
    const componentsMap = new Map();
    const startTime = Date.now();
    try {
        figma.ui.postMessage({
            type: 'progress',
            message: '[1/4] 扫描组件...',
            progress: 0
        });
    }
    catch (error) {
        console.log('Failed to send progress message, plugin might be closing');
        throw new Error('插件正在关闭');
    }
    const instanceMap = await performComponentScanning(scope, componentsMap, startTime);
    if (componentsMap.size === 0) {
        throw new Error('未找到任何组件实例');
    }
    if (externalOnly) {
        await filterExternalComponents(componentsMap);
    }
    await sendProgressMessage('[3/4] 创建组件库页面...', 35);
    const targetPage = await getOrCreateTargetPage(targetPageName);
    await figma.setCurrentPageAsync(targetPage);
    const summary = await processAndArrangeComponents(componentsMap, instanceMap, targetPage, startTime, moveInternal, externalSeparatePage);
    await sendProgressMessage('[4/4] 完成', 100);
    return summary;
}
async function performComponentScanning(scope, componentsMap, startTime) {
    const instanceMap = new Map();
    const scannedNodes = new Set();
    if (scope === 'selection') {
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
                await sendProgressMessage(`[1/4] 扫描选择项 ${processedNodes}/${actualTotalNodes}，预计剩余时间: ${remainingTime}秒` +
                    (totalNodes > maxNodesToProcess ? ` (已限制处理数量)` : ''), progress);
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
        const pages = [...figma.root.children];
        for (const page of pages) {
            await scanNode(page, componentsMap, { scannedNodes, instanceMap, collectComponents: false });
        }
    }
    else if (scope === 'page') {
        await scanNode(figma.currentPage, componentsMap, {
            scannedNodes,
            instanceMap,
            collectComponents: true
        });
        await sendProgressMessage('[2/4] 补充扫描文档实例映射...', 15);
        const pages = [...figma.root.children];
        for (const page of pages) {
            await scanNode(page, componentsMap, { scannedNodes, instanceMap, collectComponents: false });
        }
        await sendProgressMessage('[1/4] 扫描当前页面完成', 30);
    }
    else {
        const totalPageCount = figma.root.children.length;
        let processedPages = 0;
        const adaptiveConcurrencyLimit = Math.min(8, Math.max(4, Math.floor(totalPageCount / 2)));
        const pages = [...figma.root.children];
        for (let i = 0; i < pages.length; i += adaptiveConcurrencyLimit) {
            const batch = pages.slice(i, i + adaptiveConcurrencyLimit);
            await Promise.all(batch.map(page => scanNode(page, componentsMap, {
                scannedNodes,
                instanceMap,
                collectComponents: true
            })));
            processedPages += batch.length;
            await sendProgressMessage(`[1/4] 扫描页面 ${processedPages}/${totalPageCount}: ${batch.map(p => p.name).join(', ')}`, Math.floor((processedPages / totalPageCount) * 30));
            if (i % (adaptiveConcurrencyLimit * 2) === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
    }
    return instanceMap;
}
async function filterExternalComponents(componentsMap) {
    const externalComponents = new Map();
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
async function getOrCreateTargetPage(targetPageName) {
    let targetPage = figma.root.children.find(page => page.name === targetPageName);
    if (!targetPage) {
        targetPage = figma.createPage();
        targetPage.name = targetPageName;
    }
    return targetPage;
}
async function sendProgressMessage(message, progress) {
    try {
        figma.ui.postMessage({ type: 'progress', message, progress });
    }
    catch (error) {
        console.log('Failed to send progress message, plugin might be closing');
    }
}
async function processAndArrangeComponents(componentsMap, instanceMap, targetPage, startTime, moveInternal, externalSeparatePage) {
    const spacing = 100;
    const maxWidth = 4000;
    const layoutState = new Map();
    const externalPageCache = new Map();
    const processedComponents = [];
    let componentSetCount = 0;
    let singleComponentCount = 0;
    let instancesAttempted = 0;
    let instancesRebound = 0;
    let instancesFailed = 0;
    let internalMoved = 0;
    let internalCloned = 0;
    let fallbackToClone = 0;
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
                const externalPageName = getExternalLibraryPageName(info);
                const cachedPage = externalPageCache.get(externalPageName);
                if (cachedPage) {
                    pageForComponent = cachedPage;
                }
                else {
                    const externalPage = await getOrCreateTargetPage(externalPageName);
                    externalPageCache.set(externalPageName, externalPage);
                    pageForComponent = externalPage;
                }
            }
            if (info.componentSet) {
                componentSetCount++;
                return processComponentSet(info, pageForComponent, instanceMap, processedComponents, isInternal, moveInternal);
            }
            else {
                singleComponentCount++;
                return processSingleComponent(info, pageForComponent, instanceMap, processedComponents, isInternal, moveInternal);
            }
        }));
        for (let j = 0; j < batch.length; j++) {
            const outcome = nodesOnTargetPage[j];
            if (!outcome || !outcome.node)
                continue;
            const nodeOnTargetPage = outcome.node;
            instancesAttempted += outcome.instancesAttempted;
            instancesRebound += outcome.instancesRebound;
            instancesFailed += outcome.instancesFailed;
            if (outcome.movedInternal)
                internalMoved++;
            if (outcome.cloned)
                internalCloned++;
            if (outcome.fallbackToClone)
                fallbackToClone++;
            const page = nodeOnTargetPage.parent;
            if (!page || page.type !== 'PAGE') {
                continue;
            }
            const state = layoutState.get(page.id) || { xOffset: 0, yOffset: 0, maxHeightInRow: 0 };
            const nodeWidth = nodeOnTargetPage.width + spacing;
            const nodeHeight = nodeOnTargetPage.height + spacing;
            state.maxHeightInRow = Math.max(state.maxHeightInRow, nodeHeight);
            if (state.xOffset + nodeWidth > maxWidth) {
                state.xOffset = 0;
                state.yOffset += state.maxHeightInRow;
                state.maxHeightInRow = nodeHeight;
            }
            try {
                nodeOnTargetPage.x = state.xOffset;
                nodeOnTargetPage.y = state.yOffset;
            }
            catch (e) {
                if (e instanceof Error)
                    console.warn(`无法设置节点位置: ${nodeOnTargetPage.name} - ${e.message}`);
            }
            state.xOffset += nodeWidth;
            layoutState.set(page.id, state);
        }
        const overallProgress = 35 + Math.floor((processedCount / totalComponents) * 55);
        const elapsedTime = Date.now() - startTime;
        const estimatedTotalTime = (elapsedTime / processedCount) * totalComponents;
        const remainingTime = Math.max(0, Math.round((estimatedTotalTime - elapsedTime) / 1000));
        await sendProgressMessage(`[4/4] 正在处理组件 ${processedCount}/${totalComponents}，预计剩余时间: ${remainingTime}秒`, overallProgress);
        if (i > 0 && i % (adaptiveBatchSize * 2) === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
        }
    }
    if (processedComponents.length > 0) {
        figma.currentPage.selection = processedComponents.filter(node => { var _a; return ((_a = node.parent) === null || _a === void 0 ? void 0 : _a.id) === targetPage.id; });
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
        externalPagesCreated: externalPageCache.size
    };
}
async function processComponentSet(info, targetPage, instanceMap, processedComponents, isInternal, moveInternal) {
    let instancesAttempted = 0;
    let instancesRebound = 0;
    let instancesFailed = 0;
    let movedInternal = false;
    let cloned = false;
    let fallbackToClone = false;
    const componentSet = info.componentSet;
    let existingSet = targetPage.findOne(n => n.id === componentSet.id);
    if (isInternal && moveInternal) {
        // 本文件变体集：移动到目标页，在原位置保留各变体的实例
        const originalParent = componentSet.parent;
        const originalX = componentSet.x;
        const originalY = componentSet.y;
        if (!originalParent) {
            return { node: null, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone };
        }
        // 移动前，记录所有变体及其在 ComponentSet 内的相对位置
        const variantInfos = [];
        for (const child of componentSet.children) {
            if (child.type === 'COMPONENT') {
                variantInfos.push({
                    variant: child,
                    relX: child.x,
                    relY: child.y
                });
            }
        }
        if (!existingSet) {
            try {
                targetPage.appendChild(componentSet); // 移动
                processedComponents.push(componentSet);
                existingSet = componentSet;
                movedInternal = true;
            }
            catch (e) {
                // 移动失败（可能是只读节点），回退到克隆
                console.warn(`移动组件集失败，回退到克隆: ${componentSet.name}`);
                const clonedSet = componentSet.clone();
                targetPage.appendChild(clonedSet);
                processedComponents.push(clonedSet);
                existingSet = clonedSet;
                cloned = true;
                fallbackToClone = true;
                const instances = instanceMap.get(componentSet.id) || [];
                instancesAttempted += instances.length;
                await Promise.all(instances.map(async (instance) => {
                    try {
                        const mainComponent = await instance.getMainComponentAsync();
                        const newVariant = existingSet.findOne(n => n.type === 'COMPONENT' && n.name === (mainComponent === null || mainComponent === void 0 ? void 0 : mainComponent.name));
                        if (newVariant) {
                            instance.swapComponent(newVariant);
                            instancesRebound++;
                        }
                        else {
                            instancesFailed++;
                        }
                    }
                    catch (_) {
                        instancesFailed++;
                    }
                }));
                return { node: existingSet, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone };
            }
        }
        // 在原位置创建一个 Frame，放入各变体的实例
        if (originalParent !== targetPage &&
            variantInfos.length > 0 &&
            shouldKeepPlaceholderInParent(originalParent)) {
            try {
                const holder = figma.createFrame();
                holder.name = componentSet.name + ' (instances)';
                holder.resize(componentSet.width, componentSet.height);
                holder.fills = []; // 透明背景
                originalParent.appendChild(holder);
                holder.x = originalX;
                holder.y = originalY;
                for (const vi of variantInfos) {
                    try {
                        const inst = vi.variant.createInstance();
                        holder.appendChild(inst);
                        inst.x = vi.relX;
                        inst.y = vi.relY;
                    }
                    catch (e) {
                        if (e instanceof Error)
                            console.warn(`创建变体实例失败: ${vi.variant.name} - ${e.message}`);
                    }
                }
            }
            catch (e) {
                if (e instanceof Error)
                    console.warn(`在原位创建变体实例集失败: ${componentSet.name} - ${e.message}`);
            }
        }
        return { node: existingSet, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone };
    }
    // 外部组件集：克隆到目标页，所有实例 rebind 到克隆
    if (!existingSet) {
        const clonedSet = componentSet.clone();
        targetPage.appendChild(clonedSet);
        processedComponents.push(clonedSet);
        existingSet = clonedSet;
        cloned = true;
    }
    // 内部组件在默认克隆模式下不重绑，避免破坏原引用
    if (isInternal && !moveInternal) {
        return { node: existingSet, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone };
    }
    const instances = instanceMap.get(componentSet.id) || [];
    instancesAttempted += instances.length;
    await Promise.all(instances.map(async (instance) => {
        try {
            const mainComponent = await instance.getMainComponentAsync();
            const newVariant = existingSet.findOne(n => n.type === 'COMPONENT' && n.name === (mainComponent === null || mainComponent === void 0 ? void 0 : mainComponent.name));
            if (newVariant) {
                instance.swapComponent(newVariant);
                instancesRebound++;
            }
            else {
                instancesFailed++;
            }
        }
        catch (e) {
            instancesFailed++;
            if (e instanceof Error)
                console.log(`无法重新绑定实例: ${e.message}`);
        }
    }));
    return { node: existingSet, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone };
}
async function processSingleComponent(info, targetPage, instanceMap, processedComponents, isInternal, moveInternal) {
    let instancesAttempted = 0;
    let instancesRebound = 0;
    let instancesFailed = 0;
    let movedInternal = false;
    let cloned = false;
    let fallbackToClone = false;
    const component = info.component;
    let existingComponent = targetPage.findOne(n => n.id === component.id);
    if (isInternal && moveInternal) {
        // 本文件组件：移动到目标页，在原位置保留一个实例
        const originalParent = component.parent;
        const originalX = component.x;
        const originalY = component.y;
        if (!originalParent) {
            return { node: null, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone };
        }
        if (!existingComponent) {
            try {
                targetPage.appendChild(component); // 移动
                processedComponents.push(component);
                existingComponent = component;
                movedInternal = true;
            }
            catch (e) {
                // 移动失败（可能是只读节点），回退到克隆
                console.warn(`移动组件失败，回退到克隆: ${component.name}`);
                const clonedComponent = component.clone();
                targetPage.appendChild(clonedComponent);
                processedComponents.push(clonedComponent);
                existingComponent = clonedComponent;
                cloned = true;
                fallbackToClone = true;
                // 回退到克隆时需要 swap 实例
                const instances = instanceMap.get(component.id) || [];
                instancesAttempted += instances.length;
                await Promise.all(instances.map(async (instance) => {
                    try {
                        instance.swapComponent(existingComponent);
                        instancesRebound++;
                    }
                    catch (_) {
                        instancesFailed++;
                    }
                }));
                return { node: existingComponent, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone };
            }
        }
        if (originalParent !== targetPage && shouldKeepPlaceholderInParent(originalParent)) {
            try {
                const placeholderInstance = component.createInstance();
                originalParent.appendChild(placeholderInstance);
                placeholderInstance.x = originalX;
                placeholderInstance.y = originalY;
            }
            catch (e) {
                if (e instanceof Error)
                    console.warn(`在原位创建实例失败: ${component.name} - ${e.message}`);
            }
        }
        return { node: existingComponent, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone };
    }
    // 默认模式或外部组件：克隆到目标页
    if (!existingComponent) {
        const clonedComponent = component.clone();
        targetPage.appendChild(clonedComponent);
        processedComponents.push(clonedComponent);
        existingComponent = clonedComponent;
        cloned = true;
    }
    // 内部组件在默认克隆模式下不重绑，避免破坏原引用
    if (isInternal && !moveInternal) {
        return { node: existingComponent, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone };
    }
    const instances = instanceMap.get(component.id) || [];
    instancesAttempted += instances.length;
    await Promise.all(instances.map(async (instance) => {
        try {
            instance.swapComponent(existingComponent);
            instancesRebound++;
        }
        catch (e) {
            instancesFailed++;
            if (e instanceof Error)
                console.log(`无法重新绑定实例: ${e.message}`);
        }
    }));
    return { node: existingComponent, instancesAttempted, instancesRebound, instancesFailed, movedInternal, cloned, fallbackToClone };
}
