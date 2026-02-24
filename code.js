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
// 缓存管理器 - 用于缓存计算结果
class CacheManager {
    constructor(maxSize = 1000, ttl = 5 * 60 * 1000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttl = ttl;
    }
    set(key, value) {
        // 清理过期缓存
        this.cleanup();
        // 如果缓存已满，删除最老的条目
        if (this.cache.size >= this.maxSize) {
            const firstKey = Array.from(this.cache.keys())[0];
            this.cache.delete(firstKey);
        }
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }
    get(key) {
        const item = this.cache.get(key);
        if (!item)
            return undefined;
        // 检查是否过期
        if (Date.now() - item.timestamp > this.ttl) {
            this.cache.delete(key);
            return undefined;
        }
        return item.value;
    }
    has(key) {
        return this.get(key) !== undefined;
    }
    delete(key) {
        return this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
    }
    size() {
        this.cleanup();
        return this.cache.size;
    }
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now - item.timestamp > this.ttl) {
                this.cache.delete(key);
            }
        }
    }
}
// 性能调优器
class PerformanceTuner {
    constructor() {
        this.config = {
            maxConcurrent: 8,
            batchSize: 50,
            memoryThreshold: 100 * 1024 * 1024 // 100MB
        };
    }
    adjustForSystem(load) {
        if (load > 0.8) {
            this.config.maxConcurrent = Math.max(2, Math.floor(this.config.maxConcurrent * 0.7));
            this.config.batchSize = Math.max(10, Math.floor(this.config.batchSize * 0.8));
        }
        else if (load < 0.3) {
            this.config.maxConcurrent = Math.min(12, Math.ceil(this.config.maxConcurrent * 1.2));
            this.config.batchSize = Math.min(100, Math.ceil(this.config.batchSize * 1.1));
        }
    }
    getConfig() {
        return Object.assign({}, this.config);
    }
}
// 性能监控包装函数
function withPerformanceMonitoring(fn, operationName) {
    return (async (...args) => {
        const name = operationName || fn.name || 'unknown-operation';
        perfMonitor.startMeasurement(name);
        try {
            const result = await fn(...args);
            return result;
        }
        finally {
            perfMonitor.endMeasurement(name);
        }
    });
}
// 全局实例
const perfMonitor = new PerformanceMonitor();
const cacheManager = new CacheManager();
const tuner = new PerformanceTuner();
// 添加防抖定时器变量
let selectionChangeTimeout = null;
let lastSelectionString = '';
let lastPageId = figma.currentPage.id;
figma.showUI(__html__, { width: 340, height: 300 });
// 添加状态变量，跟踪是否已完成首次扫描
let hasScanned = false;
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
        case 'resize-ui':
            // 处理窗口大小调整
            figma.ui.resize(msg.width, msg.height);
            break;
        case 'scan-selection':
            // 扫描当前选择
            const selectionResult = await scanFileForComponents('selection');
            figma.ui.postMessage({ type: 'scan-results', data: selectionResult });
            // 标记已完成首次扫描
            if (!hasScanned) {
                hasScanned = true;
            }
            break;
        case 'scan-page':
            // 扫描当前页面
            const pageResult = await scanFileForComponents('page');
            figma.ui.postMessage({ type: 'scan-results', data: pageResult });
            // 标记已完成首次扫描
            if (!hasScanned) {
                hasScanned = true;
            }
            break;
        case 'scan-file':
            // 扫描整个文件
            const fileResult = await scanFileForComponents('file');
            figma.ui.postMessage({ type: 'scan-results', data: fileResult });
            // 标记已完成首次扫描
            if (!hasScanned) {
                hasScanned = true;
            }
            break;
        case 'collect-components':
            // 收集组件
            try {
                await collectAndOrganizeComponents(msg.targetPageName, msg.scope, msg.externalOnly);
                figma.ui.postMessage({
                    type: 'success',
                    message: `已收集到页面「${msg.targetPageName}」`
                });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                figma.ui.postMessage({ type: 'error', message });
            }
            break;
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
            const baseConcurrencyLimit = 8;
            const adaptiveConcurrencyLimit = Math.min(baseConcurrencyLimit, Math.max(4, Math.floor(totalNodes / 100)));
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
            componentsList.push({
                id: key,
                name: targetNode.name,
                instanceCount: info.instanceCount,
                isExternal: !isInCurrentDocument,
                sourceFileKey: '',
                sourceNodeId: targetNode.id,
                type: info.componentSet ? 'component-set' : 'component'
            });
            if (info.componentSet) {
                componentSetCount++;
            }
        });
        if (i > 0 && i % (batchSize * 2) === 0) {
            // 使用setTimeout让出控制权
            setTimeout(() => { }, 0);
        }
    }
    return {
        totalComponents: componentsMap.size,
        totalInstances: Array.from(componentsMap.values()).reduce((sum, info) => sum + info.instanceCount, 0),
        totalComponentSets: componentSetCount,
        components: componentsList,
        scope: scope
    };
}
// 递归扫描节点以查找主组件、变体组件集和组件实例
async function scanNode(node, componentsMap, scannedNodes = new Set()) {
    if (scannedNodes.has(node.id)) {
        return;
    }
    scannedNodes.add(node.id);
    // 直接识别 ComponentSet（变体组件集）
    if (node.type === 'COMPONENT_SET') {
        const componentSet = node;
        const targetKey = componentSet.id;
        if (!componentsMap.has(targetKey)) {
            // 取默认变体作为代表 component
            const defaultVariant = componentSet.defaultVariant;
            componentsMap.set(targetKey, {
                component: defaultVariant,
                instanceCount: 0,
                instances: [],
                componentSet: componentSet
            });
        }
        // 不 return，继续递归子节点以统计实例
    }
    // 直接识别独立的 Component（不在 ComponentSet 内的主组件）
    if (node.type === 'COMPONENT') {
        const component = node;
        if (!component.parent || component.parent.type !== 'COMPONENT_SET') {
            const targetKey = component.id;
            if (!componentsMap.has(targetKey)) {
                componentsMap.set(targetKey, {
                    component: component,
                    instanceCount: 0,
                    instances: [],
                    componentSet: undefined
                });
            }
        }
        // 不 return，继续递归子节点以统计实例
    }
    // 识别实例，统计引用数量
    if (node.type === 'INSTANCE') {
        const instance = node;
        const mainComponent = instance.mainComponent;
        if (mainComponent) {
            let targetKey;
            let targetComponent;
            let componentSet;
            if (mainComponent.parent && mainComponent.parent.type === 'COMPONENT_SET') {
                componentSet = mainComponent.parent;
                targetKey = componentSet.id;
                targetComponent = mainComponent;
            }
            else {
                targetKey = mainComponent.id;
                targetComponent = mainComponent;
            }
            if (componentsMap.has(targetKey)) {
                const info = componentsMap.get(targetKey);
                info.instanceCount++;
                if (info.instances.length < 100) {
                    info.instances.push(instance);
                }
            }
            else {
                componentsMap.set(targetKey, {
                    component: targetComponent,
                    instanceCount: 1,
                    instances: [instance],
                    componentSet: componentSet
                });
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
                await Promise.all(batch.map(childNode => scanNode(childNode, componentsMap, scannedNodes)));
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
                await Promise.all(batch.map(child => scanNode(child, componentsMap, scannedNodes)));
                if (i > 0 && i % (batchSize * 3) === 0) {
                    // 使用setTimeout让出控制权
                    setTimeout(() => { }, 0);
                }
            }
        }
        else {
            for (let i = 0; i < totalChildren; i++) {
                await scanNode(children[i], componentsMap, scannedNodes);
            }
        }
    }
}
// 性能优化10：优化文档实例映射构建 - 使用性能监控包装
const buildDocumentInstanceMap = withPerformanceMonitoring(async () => {
    const instanceMap = new Map();
    // 性能优化11：预估处理时间和资源
    const pages = figma.root.children;
    const totalPageCount = pages.length;
    let processedPages = 0;
    // 性能优化12：动态调整并发限制
    const adaptiveConcurrencyLimit = Math.min(6, Math.max(3, Math.floor(totalPageCount / 2)));
    const startTime = Date.now();
    for (let i = 0; i < pages.length; i += adaptiveConcurrencyLimit) {
        const batch = pages.slice(i, i + adaptiveConcurrencyLimit);
        const promises = batch.map(page => buildInstanceMapFromNode(page, instanceMap));
        await Promise.all(promises);
        processedPages += batch.length;
        // 性能优化13：智能进度更新
        const shouldUpdateProgress = processedPages % Math.max(2, Math.floor(totalPageCount / 5)) === 0 ||
            processedPages === totalPageCount;
        if (shouldUpdateProgress) {
            try {
                const elapsedTime = Date.now() - startTime;
                const estimatedTotalTime = (elapsedTime / processedPages) * totalPageCount;
                const remainingTime = Math.max(0, Math.round((estimatedTotalTime - elapsedTime) / 1000));
                figma.ui.postMessage({
                    type: 'progress',
                    message: `构建实例映射: ${Math.round((processedPages / totalPageCount) * 100)}%，预计剩余: ${remainingTime}秒`,
                    progress: Math.min(29, 10 + Math.round((processedPages / totalPageCount) * 20))
                });
            }
            catch (error) {
                console.log('Failed to send progress message, plugin might be closing');
                return instanceMap;
            }
        }
        // 性能优化14：阶段性释放控制权
        if (i > 0 && i % (adaptiveConcurrencyLimit * 2) === 0) {
            await new Promise(resolve => setTimeout(resolve, 1)); // 微小延迟让出控制权
        }
        // 性能优化15：内存保护检查
        if (instanceMap.size > 20000) {
            figma.notify('检测到大量实例，已启用内存保护模式', { timeout: 3000 });
            break;
        }
    }
    console.log(`实例映射构建完成，共处理 ${instanceMap.size} 个唯一组件`);
    return instanceMap;
}, 'build-document-instance-map');
// 递归构建实例映射
async function buildInstanceMapFromNode(node, instanceMap, scannedNodes = new Set()) {
    var _a;
    if (scannedNodes.has(node.id)) {
        return;
    }
    scannedNodes.add(node.id);
    if (node.type === 'INSTANCE') {
        const instance = node;
        const mainComponent = instance.mainComponent;
        if (!mainComponent)
            return;
        // 变体组件用 ComponentSet id 作为 key，与 processComponentSet 查找一致
        const key = ((_a = mainComponent.parent) === null || _a === void 0 ? void 0 : _a.type) === 'COMPONENT_SET'
            ? mainComponent.parent.id
            : mainComponent.id;
        const existingInstances = instanceMap.get(key);
        const maxInstancesPerComponent = 200;
        if (existingInstances) {
            if (existingInstances.length < maxInstancesPerComponent) {
                existingInstances.push(instance);
            }
            else if (existingInstances.length === maxInstancesPerComponent) {
                existingInstances.push(instance);
                console.log(`组件 ${key} 的实例数量已达上限 (${maxInstancesPerComponent})`);
            }
        }
        else {
            instanceMap.set(key, [instance]);
        }
    }
    if ('children' in node) {
        const children = node.children;
        const totalChildren = children.length;
        if (totalChildren > 3000) {
            const nodeQueue = [...children];
            let processedCount = 0;
            const adaptiveBatchSize = Math.min(30, Math.max(10, Math.floor(totalChildren / 100)));
            while (nodeQueue.length > 0 && instanceMap.size < 10000) {
                const batch = nodeQueue.splice(0, Math.min(adaptiveBatchSize, nodeQueue.length));
                await Promise.all(batch.map(childNode => buildInstanceMapFromNode(childNode, instanceMap, scannedNodes)));
                processedCount += batch.length;
                if (processedCount % 800 === 0) {
                    try {
                        figma.ui.postMessage({
                            type: 'progress',
                            message: `构建实例映射: ${Math.round((processedCount / totalChildren) * 100)}%`,
                            progress: Math.min(29, 10 + Math.round((processedCount / totalChildren) * 20))
                        });
                    }
                    catch (error) {
                        console.log('Failed to send progress message, plugin might be closing');
                        return;
                    }
                    if (instanceMap.size > 15000) {
                        console.warn('实例映射过大，提前终止以保护内存');
                        break;
                    }
                }
            }
        }
        else if (totalChildren > 200) {
            const batchSize = Math.min(30, Math.ceil(totalChildren / 8));
            for (let i = 0; i < totalChildren; i += batchSize) {
                const batch = children.slice(i, Math.min(i + batchSize, totalChildren));
                await Promise.all(batch.map(child => buildInstanceMapFromNode(child, instanceMap, scannedNodes)));
                if (i > 0 && i % (batchSize * 2) === 0) {
                    // 使用setTimeout让出控制权
                    setTimeout(() => { }, 0);
                }
            }
        }
        else {
            for (let i = 0; i < totalChildren; i++) {
                await buildInstanceMapFromNode(children[i], instanceMap, scannedNodes);
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
// 收集并组织主组件到目标页面
async function collectAndOrganizeComponents(targetPageName, scope, externalOnly = false) {
    const componentsMap = new Map();
    const startTime = Date.now();
    try {
        figma.ui.postMessage({
            type: 'progress',
            message: '正在扫描组件...',
            progress: 0
        });
    }
    catch (error) {
        console.log('Failed to send progress message, plugin might be closing');
        return;
    }
    await performComponentScanning(scope, componentsMap, startTime);
    if (componentsMap.size === 0) {
        throw new Error('未找到任何组件实例');
    }
    if (externalOnly) {
        await filterExternalComponents(componentsMap);
    }
    await sendProgressMessage('正在扫描文档中的所有实例...', 15);
    const instanceMap = await buildDocumentInstanceMap();
    await sendProgressMessage('正在创建组件库页面...', 35);
    const targetPage = await getOrCreateTargetPage(targetPageName);
    figma.currentPage = targetPage;
    await processAndArrangeComponents(componentsMap, instanceMap, targetPage, startTime);
}
async function performComponentScanning(scope, componentsMap, startTime) {
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
            await Promise.all(batch.map(node => scanNode(node, componentsMap)));
            processedNodes += batch.length;
            if (processedNodes % Math.max(25, Math.floor(actualTotalNodes / 10)) === 0) {
                const progress = Math.floor((processedNodes / actualTotalNodes) * 10);
                const elapsedTime = Date.now() - startTime;
                const estimatedTotalTime = (elapsedTime / processedNodes) * actualTotalNodes;
                const remainingTime = Math.max(0, Math.round((estimatedTotalTime - elapsedTime) / 1000));
                await sendProgressMessage(`扫描选择项 ${processedNodes}/${actualTotalNodes}，预计剩余时间: ${remainingTime}秒` +
                    (totalNodes > maxNodesToProcess ? ` (已限制处理数量)` : ''), progress);
            }
            if (i % (adaptiveBatchSize * 3) === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        if (totalNodes > maxNodesToProcess) {
            figma.notify(`注意：选择的节点过多，仅处理了前${maxNodesToProcess}个节点。`, { timeout: 5000 });
        }
    }
    else if (scope === 'page') {
        await scanNode(figma.currentPage, componentsMap);
        await sendProgressMessage('扫描当前页面完成', 90);
    }
    else {
        const totalPageCount = figma.root.children.length;
        let processedPages = 0;
        const adaptiveConcurrencyLimit = Math.min(8, Math.max(4, Math.floor(totalPageCount / 2)));
        const pages = [...figma.root.children];
        for (let i = 0; i < pages.length; i += adaptiveConcurrencyLimit) {
            const batch = pages.slice(i, i + adaptiveConcurrencyLimit);
            await Promise.all(batch.map(page => scanNode(page, componentsMap)));
            processedPages += batch.length;
            await sendProgressMessage(`扫描页面 ${processedPages}/${totalPageCount}: ${batch.map(p => p.name).join(', ')}`, Math.floor((processedPages / totalPageCount) * 100));
            if (i % (adaptiveConcurrencyLimit * 2) === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
    }
}
async function filterExternalComponents(componentsMap) {
    const externalComponents = new Map();
    const componentArray = Array.from(componentsMap.entries());
    const batchSize = 50;
    for (let i = 0; i < componentArray.length; i += batchSize) {
        const batch = componentArray.slice(i, i + batchSize);
        batch.forEach(([key, info]) => {
            const targetNode = info.componentSet || info.component;
            const firstInstance = info.instances[0];
            let isExternal = false;
            if (firstInstance && firstInstance.mainComponent) {
                const mainComp = firstInstance.mainComponent;
                const componentKey = mainComp.key;
                if (componentKey && componentKey.includes(':')) {
                    isExternal = true;
                }
                else {
                    const isInCurrentDocument = figma.root.children.some(page => page.findOne(node => node.id === targetNode.id) !== null);
                    isExternal = !isInCurrentDocument;
                }
            }
            if (isExternal) {
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
async function processAndArrangeComponents(componentsMap, instanceMap, targetPage, startTime) {
    let xOffset = 0;
    let yOffset = 0;
    const spacing = 100;
    const maxWidth = 4000;
    let maxHeightInRow = 0;
    const processedComponents = [];
    let componentSetCount = 0;
    let singleComponentCount = 0;
    let totalInstancesRebound = 0;
    const totalComponents = componentsMap.size;
    let processedCount = 0;
    const componentArray = Array.from(componentsMap.entries());
    const adaptiveBatchSize = Math.min(30, Math.max(10, Math.floor(totalComponents / 10)));
    for (let i = 0; i < componentArray.length; i += adaptiveBatchSize) {
        const batch = componentArray.slice(i, i + adaptiveBatchSize);
        const nodesOnTargetPage = await Promise.all(batch.map(async ([key, info]) => {
            processedCount++;
            const isInternal = isComponentInternal(info);
            if (info.componentSet) {
                componentSetCount++;
                return processComponentSet(info, targetPage, instanceMap, processedComponents, isInternal);
            }
            else {
                singleComponentCount++;
                return processSingleComponent(info, targetPage, instanceMap, processedComponents, isInternal);
            }
        }));
        for (let j = 0; j < batch.length; j++) {
            const [key, info] = batch[j];
            const nodeOnTargetPage = nodesOnTargetPage[j];
            if (!nodeOnTargetPage)
                continue;
            const nodeWidth = nodeOnTargetPage.width + spacing;
            const nodeHeight = nodeOnTargetPage.height + spacing;
            maxHeightInRow = Math.max(maxHeightInRow, nodeHeight);
            if (xOffset + nodeWidth > maxWidth) {
                xOffset = 0;
                yOffset += maxHeightInRow;
                maxHeightInRow = nodeHeight;
            }
            try {
                nodeOnTargetPage.x = xOffset;
                nodeOnTargetPage.y = yOffset;
            }
            catch (e) {
                if (e instanceof Error)
                    console.warn(`无法设置节点位置: ${nodeOnTargetPage.name} - ${e.message}`);
            }
            xOffset += nodeWidth;
            const instances = instanceMap.get(key) || [];
            totalInstancesRebound += instances.length;
        }
        const overallProgress = 35 + Math.floor((processedCount / totalComponents) * 55);
        const elapsedTime = Date.now() - startTime;
        const estimatedTotalTime = (elapsedTime / processedCount) * totalComponents;
        const remainingTime = Math.max(0, Math.round((estimatedTotalTime - elapsedTime) / 1000));
        await sendProgressMessage(`正在处理组件 ${processedCount}/${totalComponents}，预计剩余时间: ${remainingTime}秒`, overallProgress);
        if (i > 0 && i % (adaptiveBatchSize * 2) === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
        }
    }
    if (processedComponents.length > 0) {
        figma.currentPage.selection = processedComponents;
    }
    console.log(`处理完成: ${componentSetCount} 个变体组件集, ${singleComponentCount} 个单组件`);
    console.log(`实例重新绑定数量: ${totalInstancesRebound}`);
}
async function processComponentSet(info, targetPage, instanceMap, processedComponents, isInternal) {
    const componentSet = info.componentSet;
    let existingSet = targetPage.findOne(n => n.id === componentSet.id);
    if (isInternal) {
        // 本文件变体集：移动到目标页，在原位置保留各变体的实例
        const originalParent = componentSet.parent;
        const originalX = componentSet.x;
        const originalY = componentSet.y;
        if (!originalParent)
            return null;
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
            }
            catch (e) {
                // 移动失败（可能是只读节点），回退到克隆
                console.warn(`移动组件集失败，回退到克隆: ${componentSet.name}`);
                const clonedSet = componentSet.clone();
                targetPage.appendChild(clonedSet);
                processedComponents.push(clonedSet);
                existingSet = clonedSet;
                const instances = instanceMap.get(componentSet.id) || [];
                await Promise.all(instances.map(async (instance) => {
                    try {
                        const newVariant = existingSet.findOne(n => { var _a; return n.type === 'COMPONENT' && n.name === ((_a = instance.mainComponent) === null || _a === void 0 ? void 0 : _a.name); });
                        if (newVariant)
                            instance.swapComponent(newVariant);
                    }
                    catch (_) { /* ignore */ }
                }));
                return existingSet;
            }
        }
        // 在原位置创建一个 Frame，放入各变体的实例
        if (originalParent !== targetPage && variantInfos.length > 0) {
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
        return existingSet;
    }
    // 外部组件集：克隆到目标页，所有实例 rebind 到克隆
    if (!existingSet) {
        const clonedSet = componentSet.clone();
        targetPage.appendChild(clonedSet);
        processedComponents.push(clonedSet);
        existingSet = clonedSet;
    }
    const instances = instanceMap.get(componentSet.id) || [];
    await Promise.all(instances.map(async (instance) => {
        try {
            const newVariant = existingSet.findOne(n => { var _a; return n.type === 'COMPONENT' && n.name === ((_a = instance.mainComponent) === null || _a === void 0 ? void 0 : _a.name); });
            if (newVariant)
                instance.swapComponent(newVariant);
        }
        catch (e) {
            if (e instanceof Error)
                console.log(`无法重新绑定实例: ${e.message}`);
        }
    }));
    return existingSet;
}
async function processSingleComponent(info, targetPage, instanceMap, processedComponents, isInternal) {
    const component = info.component;
    let existingComponent = targetPage.findOne(n => n.id === component.id);
    if (isInternal) {
        // 本文件组件：移动到目标页，在原位置保留一个实例
        const originalParent = component.parent;
        const originalX = component.x;
        const originalY = component.y;
        if (!originalParent)
            return null;
        if (!existingComponent) {
            try {
                targetPage.appendChild(component); // 移动
                processedComponents.push(component);
                existingComponent = component;
            }
            catch (e) {
                // 移动失败（可能是只读节点），回退到克隆
                console.warn(`移动组件失败，回退到克隆: ${component.name}`);
                const clonedComponent = component.clone();
                targetPage.appendChild(clonedComponent);
                processedComponents.push(clonedComponent);
                existingComponent = clonedComponent;
                // 回退到克隆时需要 swap 实例
                const instances = instanceMap.get(component.id) || [];
                await Promise.all(instances.map(async (instance) => {
                    try {
                        instance.swapComponent(existingComponent);
                    }
                    catch (_) { /* ignore */ }
                }));
                return existingComponent;
            }
        }
        if (originalParent !== targetPage) {
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
        return existingComponent;
    }
    // 外部组件：克隆到目标页，所有实例 rebind 到克隆
    if (!existingComponent) {
        const clonedComponent = component.clone();
        targetPage.appendChild(clonedComponent);
        processedComponents.push(clonedComponent);
        existingComponent = clonedComponent;
    }
    const instances = instanceMap.get(component.id) || [];
    await Promise.all(instances.map(async (instance) => {
        try {
            instance.swapComponent(existingComponent);
        }
        catch (e) {
            if (e instanceof Error)
                console.log(`无法重新绑定实例: ${e.message}`);
        }
    }));
    return existingComponent;
}
