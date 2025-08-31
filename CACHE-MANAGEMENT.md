# Synpatico Core - Cache Management & Production Guidelines

## 🛡️ Production-Safe Caching System

Synpatico Core now includes a robust LRU cache system with configurable limits to prevent memory leaks and cache contamination in production environments.

## 🚀 Quick Setup for Production

### Backend (Node.js/Express) Configuration

```javascript
import { configureProtocolCaching } from '@synpatico/core';

// Configure at application startup
configureProtocolCaching({
  maxShapeCacheSize: 2000,      // Increase for high-traffic APIs
  maxKeyOrderCacheSize: 1000,   // Increase for diverse data schemas
  autoEvictionThreshold: 75,    // Start eviction at 75% capacity
  enableCacheStats: true        // Enable for monitoring
});
```

### Frontend (React/Vue/etc.) Configuration

```javascript
import { configureProtocolCaching } from '@synpatico/core';

// Smaller limits for frontend environments
configureProtocolCaching({
  maxShapeCacheSize: 500,       // Smaller cache for client apps
  maxKeyOrderCacheSize: 200,    // Limited schema diversity expected
  autoEvictionThreshold: 80,    // Conservative threshold
  enableCacheStats: false       // Disabled for performance
});
```

## 📊 Cache Monitoring

### Getting Cache Statistics

```javascript
import { getProtocolCacheStats } from '@synpatico/core';

// Get current cache status
const stats = getProtocolCacheStats();
console.log('Shape Cache:', stats.shapeCache);
console.log('Key Order Cache:', stats.keyOrderCache);
console.log('Configuration:', stats.config);
```

### Example Output

```javascript
{
  shapeCache: {
    size: 150,
    maxSize: 1000,
    accessCounter: 2547,
    utilization: 15
  },
  keyOrderCache: {
    size: 45,
    maxSize: 500,
    utilization: 9
  },
  config: {
    maxShapeCacheSize: 1000,
    maxKeyOrderCacheSize: 500,
    autoEvictionThreshold: 80,
    enableCacheStats: true
  }
}
```

## 🧹 Manual Cache Management

### Proactive Eviction

```javascript
import { evictOldCacheEntries } from '@synpatico/core';

// Call during low-traffic periods or when memory pressure is detected
const result = evictOldCacheEntries();
console.log(`Evicted ${result.evicted} cache entries`);
```

### Complete Cache Reset (Use Sparingly)

```javascript
import { resetProtocolState } from '@synpatico/core';

// Only use this for testing or complete application resets
resetProtocolState();
```

## 🔄 Frontend vs Backend Isolation

### The Problem

Synpatico Core maintains internal caches for performance optimization. In production environments, this can lead to:

1. **Memory leaks** in long-running processes
2. **Cache contamination** between different data types
3. **State pollution** between user sessions

### Frontend Isolation Strategy

**✅ Recommended Approach**: Use separate cache configurations per application context.

```javascript
// Frontend: Single user session, smaller cache
configureProtocolCaching({
  maxShapeCacheSize: 300,
  maxKeyOrderCacheSize: 100,
  autoEvictionThreshold: 90
});
```

**Why This Works:**
- Frontend apps typically handle one user's data at a time
- Limited schema diversity per user session
- Page refreshes naturally reset cache state
- Smaller memory footprint is important for mobile devices

### Backend Isolation Strategy

**✅ Recommended Approach**: Use larger caches with proactive eviction.

```javascript
// Backend: Multi-user, high-traffic server
configureProtocolCaching({
  maxShapeCacheSize: 5000,
  maxKeyOrderCacheSize: 2000,
  autoEvictionThreshold: 70
});

// Set up periodic cache maintenance
setInterval(() => {
  const { evicted } = evictOldCacheEntries();
  if (evicted > 0) {
    console.log(`Evicted ${evicted} stale cache entries`);
  }
}, 5 * 60 * 1000); // Every 5 minutes
```

**Why This Works:**
- Servers handle diverse data from many users
- LRU eviction ensures most relevant data stays cached
- Periodic maintenance prevents unbounded growth
- Statistics help monitor cache effectiveness

### Request-Level Isolation (Advanced)

For applications requiring strict per-request isolation:

```javascript
import { resetProtocolState } from '@synpatico/core';

app.use((req, res, next) => {
  // Store original cache state
  const originalStats = getProtocolCacheStats();
  
  // Optional: Reset for strict isolation (performance impact)
  if (req.headers['x-synpatico-isolate']) {
    resetProtocolState();
  }
  
  next();
});
```

**⚠️ Warning**: Per-request cache resets eliminate performance benefits. Only use for debugging or strict security requirements.

## 🏭 Production Deployment Patterns

### High-Traffic APIs

```javascript
// Large cache, aggressive eviction
configureProtocolCaching({
  maxShapeCacheSize: 10000,
  maxKeyOrderCacheSize: 5000,
  autoEvictionThreshold: 60,
  enableCacheStats: true
});

// Monitor cache effectiveness
app.get('/health/cache', (req, res) => {
  res.json(getProtocolCacheStats());
});
```

### Microservices

```javascript
// Moderate cache, per-service optimization
configureProtocolCaching({
  maxShapeCacheSize: 1000,
  maxKeyOrderCacheSize: 500,
  autoEvictionThreshold: 75
});
```

### Serverless Functions (Lambda, Vercel)

```javascript
// Small cache, optimized for cold starts
configureProtocolCaching({
  maxShapeCacheSize: 200,
  maxKeyOrderCacheSize: 100,
  autoEvictionThreshold: 95
});
```

### Multi-Tenant Applications

```javascript
// Larger cache with frequent eviction to prevent tenant data mixing
configureProtocolCaching({
  maxShapeCacheSize: 3000,
  maxKeyOrderCacheSize: 1500,
  autoEvictionThreshold: 50  // Aggressive eviction
});

// Per-tenant cache isolation (if required)
app.use('/tenant/:tenantId/*', (req, res, next) => {
  // Optional: Tenant-specific cache namespacing
  // Implementation depends on specific requirements
  next();
});
```

## 📈 Performance Monitoring

### Key Metrics to Track

1. **Cache Hit Rate**: `accessCounter` growth vs `size` growth
2. **Memory Usage**: `utilization` percentage
3. **Eviction Frequency**: How often caches reach limits
4. **Response Time Impact**: Monitor API latency changes

### Integration with APM Tools

```javascript
// Example: New Relic custom metrics
const stats = getProtocolCacheStats();
newrelic.recordMetric('Custom/Synpatico/ShapeCache/Utilization', stats.shapeCache.utilization);
newrelic.recordMetric('Custom/Synpatico/ShapeCache/Size', stats.shapeCache.size);

// Example: Prometheus metrics
shapeCacheUtilization.set(stats.shapeCache.utilization);
shapeCacheSize.set(stats.shapeCache.size);
```

## 🚨 Troubleshooting

### Memory Leaks

**Symptoms**: Steadily increasing memory usage over time

**Solution**:
```javascript
// Reduce cache sizes
configureProtocolCaching({
  maxShapeCacheSize: 500,
  autoEvictionThreshold: 50
});

// Add aggressive periodic cleanup
setInterval(evictOldCacheEntries, 60000); // Every minute
```

### Cache Contamination

**Symptoms**: Incorrect data returned intermittently

**Solution**:
```javascript
// Reset caches between major operations
resetProtocolState(); // Nuclear option

// Or configure smaller, more frequently evicted caches
configureProtocolCaching({
  autoEvictionThreshold: 40  // Very aggressive eviction
});
```

### Performance Degradation

**Symptoms**: Slower response times after running for extended periods

**Solution**:
```javascript
// Monitor cache statistics
const stats = getProtocolCacheStats();
if (stats.shapeCache.utilization > 90) {
  evictOldCacheEntries();
}
```

## 🎯 Best Practices Summary

1. **Configure caches at startup** based on your environment
2. **Monitor cache statistics** in production
3. **Use smaller caches on frontend**, larger on backend
4. **Set up periodic eviction** for long-running processes
5. **Test cache behavior** under load before deploying
6. **Never use resetProtocolState()** in production (except for emergencies)
7. **Track cache metrics** alongside other performance indicators

This caching system ensures Synpatico Core remains performant and memory-safe in all production environments! 🎉