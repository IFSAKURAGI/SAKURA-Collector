// 性能监控和调试工具

// 性能监控类
class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, number[]> = new Map();
  private startTime: number = 0;
  
  private constructor() {}
  
  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }
  
  public startMeasurement(label: string): void {
    this.startTime = performance.now();
    console.log(`🚀 开始测量: ${label}`);
  }
  
  public endMeasurement(label: string): number {
    const endTime = performance.now();
    const duration = endTime - this.startTime;
    
    if (!this.metrics.has(label)) {
      this.metrics.set(label, []);
    }
    
    this.metrics.get(label)!.push(duration);
    console.log(`✅ ${label} 完成，耗时: ${duration.toFixed(2)}ms`);
    
    // 性能警告
    if (duration > 1000) {
      console.warn(`⚠️  ${label} 执行时间过长: ${duration.toFixed(2)}ms`);
    }
    
    return duration;
  }
  
  public getAverageTime(label: string): number {
    const times = this.metrics.get(label);
    if (!times || times.length === 0) return 0;
    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }
  
  public printReport(): void {
    console.log('\n📊 性能报告:');
    console.log('====================');
    this.metrics.forEach((times, label) => {
      const avg = this.getAverageTime(label);
      const min = Math.min(...times);
      const max = Math.max(...times);
      console.log(`${label}: 平均${avg.toFixed(2)}ms (最小${min.toFixed(2)}ms, 最大${max.toFixed(2)}ms)`);
    });
  }
}

// 内存使用监控
class MemoryMonitor {
  private static instance: MemoryMonitor;
  private lastMemoryUsage: number = 0;
  
  private constructor() {}
  
  public static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }
  
  public checkMemoryUsage(warningThreshold: number = 50): boolean {
    // 注意：在Figma插件环境中，performance.memory可能不可用
    // 这里提供一个通用的内存监控框架
    try {
      // @ts-ignore
      if (performance.memory) {
        // @ts-ignore
        const memoryMB = performance.memory.usedJSHeapSize / 1024 / 1024;
        const memoryPercent = (memoryMB / (performance.memory.jsHeapSizeLimit / 1024 / 1024)) * 100;
        
        if (memoryPercent > warningThreshold) {
          console.warn(`MemoryWarning: 内存使用率 ${memoryPercent.toFixed(1)}% (${memoryMB.toFixed(1)}MB)`);
          return true;
        }
        
        if (memoryMB - this.lastMemoryUsage > 10) { // 内存增长超过10MB
          console.log(`📈 内存增长: ${this.lastMemoryUsage.toFixed(1)}MB → ${memoryMB.toFixed(1)}MB`);
        }
        
        this.lastMemoryUsage = memoryMB;
      }
    } catch (error) {
      // 在不支持performance.memory的环境中静默失败
      console.debug('Memory monitoring not available in this environment');
    }
    
    return false;
  }
  
  public forceGarbageCollection(): void {
    // 尝试触发垃圾回收（在支持的环境中）
    if (typeof gc === 'function') {
      gc();
      console.log('🧹 已触发垃圾回收');
    }
  }
}

// 缓存管理器
class CacheManager {
  private static instance: CacheManager;
  private cache: Map<string, any> = new Map();
  private maxSize: number = 1000;
  
  private constructor() {}
  
  public static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }
  
  public set<T>(key: string, value: T, ttl?: number): void {
    // 清理过期缓存
    this.cleanupExpired();
    
    // LRU策略：如果缓存满了，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    const entry = {
      value,
      timestamp: Date.now(),
      expires: ttl ? Date.now() + ttl : null
    };
    
    this.cache.set(key, entry);
  }
  
  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // 检查是否过期
    if (entry.expires && Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.value;
  }
  
  public has(key: string): boolean {
    return this.cache.has(key) && this.get(key) !== null;
  }
  
  public delete(key: string): boolean {
    return this.cache.delete(key);
  }
  
  public clear(): void {
    this.cache.clear();
  }
  
  public size(): number {
    this.cleanupExpired();
    return this.cache.size;
  }
  
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires && now > entry.expires) {
        this.cache.delete(key);
      }
    }
  }
  
  public getStats(): { size: number; maxSize: number; hitRate: number } {
    // 简化的统计信息
    return {
      size: this.size(),
      maxSize: this.maxSize,
      hitRate: 0 // 需要额外的命中计数逻辑
    };
  }
}

// 使用示例和集成
const perfMonitor = PerformanceMonitor.getInstance();
const memoryMonitor = MemoryMonitor.getInstance();
const cacheManager = CacheManager.getInstance();

// 导出工具供其他模块使用
export { PerformanceMonitor, MemoryMonitor, CacheManager, perfMonitor, memoryMonitor, cacheManager };

// 在关键函数中集成性能监控
function withPerformanceMonitoring<T extends (...args: any[]) => Promise<any>>(
  fn: T, 
  label: string
): T {
  return (async (...args: any[]) => {
    perfMonitor.startMeasurement(label);
    memoryMonitor.checkMemoryUsage();
    
    try {
      const result = await fn(...args);
      perfMonitor.endMeasurement(label);
      return result;
    } catch (error) {
      console.error(`❌ ${label} 执行失败:`, error);
      throw error;
    }
  }) as T;
}

// 性能优化配置
interface PerformanceConfig {
  maxConcurrentOperations: number;
  batchSize: number;
  memoryWarningThreshold: number;
  progressUpdateInterval: number;
  enableLogging: boolean;
}

const defaultPerformanceConfig: PerformanceConfig = {
  maxConcurrentOperations: 8,
  batchSize: 50,
  memoryWarningThreshold: 60,
  progressUpdateInterval: 200,
  enableLogging: true
};

// 动态性能调节器
class DynamicPerformanceTuner {
  private config: PerformanceConfig = { ...defaultPerformanceConfig };
  private performanceHistory: number[] = [];
  
  public adjustBasedOnLoad(currentLoad: number): void {
    // 根据当前负载动态调整配置
    if (currentLoad > 0.8) {
      this.config.maxConcurrentOperations = Math.max(2, Math.floor(this.config.maxConcurrentOperations * 0.7));
      this.config.batchSize = Math.max(10, Math.floor(this.config.batchSize * 0.8));
    } else if (currentLoad < 0.3) {
      this.config.maxConcurrentOperations = Math.min(12, Math.ceil(this.config.maxConcurrentOperations * 1.2));
      this.config.batchSize = Math.min(100, Math.ceil(this.config.batchSize * 1.1));
    }
    
    this.performanceHistory.push(currentLoad);
    if (this.performanceHistory.length > 100) {
      this.performanceHistory.shift(); // 保持历史记录在合理范围内
    }
  }
  
  public getConfig(): PerformanceConfig {
    return { ...this.config };
  }
  
  public getAverageLoad(): number {
    if (this.performanceHistory.length === 0) return 0;
    return this.performanceHistory.reduce((sum, load) => sum + load, 0) / this.performanceHistory.length;
  }
}

const performanceTuner = new DynamicPerformanceTuner();

// 导出性能工具
export { 
  withPerformanceMonitoring, 
  defaultPerformanceConfig, 
  performanceTuner,
  type PerformanceConfig 
};