#!/usr/bin/env node

/**
 * SAKURA收集组件 - 性能测试脚本
 * 用于测试和验证插件的各项性能指标
 */

const fs = require('fs');
const path = require('path');

// 模拟Figma环境（简化版）
const mockFigma = {
  currentPage: {
    selection: [],
    children: []
  },
  root: {
    children: []
  },
  createPage: () => ({ name: '', children: [], appendChild: () => {} }),
  notify: (msg) => console.log(`🔔 ${msg}`)
};

// 性能测试配置
const testConfig = {
  iterations: 10,
  largeFileNodes: 10000,
  mediumFileNodes: 5000,
  smallFileNodes: 1000,
  batchSize: 50
};

class PerformanceTester {
  constructor() {
    this.results = {};
    this.startTime = 0;
  }

  startTest(testName) {
    this.startTime = process.hrtime.bigint();
    console.log(`🚀 开始测试: ${testName}`);
  }

  endTest(testName) {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - this.startTime) / 1000000; // 转换为毫秒
    
    if (!this.results[testName]) {
      this.results[testName] = [];
    }
    
    this.results[testName].push(duration);
    console.log(`✅ ${testName} 完成: ${duration.toFixed(2)}ms`);
    
    return duration;
  }

  generateMockData(nodeCount) {
    const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        id: `node_${i}`,
        type: Math.random() > 0.7 ? 'INSTANCE' : 'FRAME',
        children: [],
        mainComponent: Math.random() > 0.8 ? { 
          id: `component_${Math.floor(Math.random() * 100)}`,
          key: Math.random() > 0.5 ? `file:${Math.random()}` : `${Math.random()}`
        } : null
      });
    }
    return nodes;
  }

  async testScanningPerformance() {
    console.log('\n🔬 扫描性能测试');
    console.log('==================');

    const testCases = [
      { name: '小文件扫描', nodes: testConfig.smallFileNodes },
      { name: '中文件扫描', nodes: testConfig.mediumFileNodes },
      { name: '大文件扫描', nodes: testConfig.largeFileNodes }
    ];

    for (const testCase of testCases) {
      const testData = this.generateMockData(testCase.nodes);
      global.figma = { ...mockFigma, currentPage: { ...mockFigma.currentPage, children: testData }};
      
      const durations = [];
      for (let i = 0; i < testConfig.iterations; i++) {
        this.startTest(`${testCase.name} 第${i + 1}次`);
        
        // 模拟扫描逻辑
        const componentsMap = new Map();
        const processedNodes = [];
        
        // 批处理模拟
        for (let j = 0; j < testData.length; j += testConfig.batchSize) {
          const batch = testData.slice(j, j + testConfig.batchSize);
          batch.forEach(node => {
            if (node.type === 'INSTANCE' && node.mainComponent) {
              const key = node.mainComponent.id;
              if (!componentsMap.has(key)) {
                componentsMap.set(key, { count: 0, instances: [] });
              }
              componentsMap.get(key).count++;
              componentsMap.get(key).instances.push(node);
            }
            processedNodes.push(node);
          });
          
          // 模拟异步处理
          if (j % (testConfig.batchSize * 3) === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }
        
        const duration = this.endTest(`${testCase.name} 第${i + 1}次`);
        durations.push(duration);
      }

      const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const minDuration = Math.min(...durations);
      const maxDuration = Math.max(...durations);
      
      console.log(`${testCase.name} 结果:`);
      console.log(`  平均时间: ${avgDuration.toFixed(2)}ms`);
      console.log(`  最快时间: ${minDuration.toFixed(2)}ms`);
      console.log(`  最慢时间: ${maxDuration.toFixed(2)}ms`);
      console.log(`  处理速度: ${(testCase.nodes / (avgDuration / 1000)).toFixed(0)} 节点/秒\n`);
    }
  }

  async testMemoryUsage() {
    console.log('\n🧠 内存使用测试');
    console.log('=================');

    const memoryTests = [
      { name: '组件映射内存', size: 1000 },
      { name: '实例映射内存', size: 5000 },
      { name: '大数据结构', size: 10000 }
    ];

    for (const test of memoryTests) {
      this.startTest(test.name);
      
      const dataStructure = new Map();
      for (let i = 0; i < test.size; i++) {
        dataStructure.set(`key_${i}`, {
          id: `component_${i}`,
          instances: Array(Math.floor(Math.random() * 50)).fill(null).map((_, idx) => ({
            id: `instance_${idx}`,
            mainComponent: { id: `component_${i}` }
          }))
        });
      }
      
      const duration = this.endTest(test.name);
      
      // 估算内存使用（简化）
      const estimatedMemoryKB = (test.size * 2) + (dataStructure.size * 0.5);
      console.log(`  估算内存使用: ${estimatedMemoryKB.toFixed(1)} KB`);
      console.log(`  处理速度: ${(test.size / (duration / 1000)).toFixed(0)} 项/秒\n`);
      
      dataStructure.clear(); // 清理内存
    }
  }

  async testConcurrentOperations() {
    console.log('\n⚡ 并发操作测试');
    console.log('=================');

    const concurrencyLevels = [1, 2, 4, 8, 12];
    
    for (const level of concurrencyLevels) {
      this.startTest(`并发级别 ${level}`);
      
      const promises = [];
      const chunkSize = Math.ceil(testConfig.largeFileNodes / level);
      
      for (let i = 0; i < level; i++) {
        promises.push(this.simulateProcessingChunk(chunkSize, i));
      }
      
      await Promise.all(promises);
      const duration = this.endTest(`并发级别 ${level}`);
      
      console.log(`  并发处理 ${testConfig.largeFileNodes} 个节点`);
      console.log(`  处理时间: ${duration.toFixed(2)}ms`);
      console.log(`  效率提升: ${((testConfig.largeFileNodes / (duration / 1000)) / level).toFixed(0)} 节点/秒/线程\n`);
    }
  }

  async simulateProcessingChunk(size, threadId) {
    const nodes = this.generateMockData(size);
    const componentsMap = new Map();
    
    for (let i = 0; i < nodes.length; i += testConfig.batchSize) {
      const batch = nodes.slice(i, i + testConfig.batchSize);
      batch.forEach(node => {
        if (node.type === 'INSTANCE' && node.mainComponent) {
          const key = `${threadId}_${node.mainComponent.id}`;
          if (!componentsMap.has(key)) {
            componentsMap.set(key, { count: 0 });
          }
          componentsMap.get(key).count++;
        }
      });
      
      if (i % (testConfig.batchSize * 2) === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    
    return componentsMap.size;
  }

  generateReport() {
    console.log('\n📋 性能测试综合报告');
    console.log('=====================');
    
    Object.entries(this.results).forEach(([testName, durations]) => {
      const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      const stdDev = Math.sqrt(durations.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0) / durations.length);
      
      console.log(`${testName}:`);
      console.log(`  平均: ${avg.toFixed(2)}ms`);
      console.log(`  范围: ${min.toFixed(2)}ms - ${max.toFixed(2)}ms`);
      console.log(`  标准差: ${stdDev.toFixed(2)}ms`);
      console.log(`  稳定性: ${stdDev < avg * 0.1 ? '优秀' : stdDev < avg * 0.2 ? '良好' : '一般'}\n`);
    });
  }
}

// 执行性能测试
async function runPerformanceTests() {
  console.log('🚀 SAKURA收集组件性能测试开始\n');
  
  const tester = new PerformanceTester();
  
  try {
    await tester.testScanningPerformance();
    await tester.testMemoryUsage();
    await tester.testConcurrentOperations();
    tester.generateReport();
    
    console.log('✅ 所有性能测试完成！');
  } catch (error) {
    console.error('❌ 性能测试过程中发生错误:', error);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  runPerformanceTests();
}

module.exports = { PerformanceTester, runPerformanceTests };