# @synpatico/client

A client library for optimizing network requests using the Synpatico protocol.

## Installation

```bash
npm install @synpatico/client
```

## Usage

The library provides two ways to use Synpatico:

### 1. Automatic Global Patching

Automatically patches `fetch` and `XMLHttpRequest` to optimize all network requests:

```javascript
import { patchGlobals } from '@synpatico/client/patch'

// Patch all requests
const handle = patchGlobals()

// Or patch only specific URLs
const handle = patchGlobals({
  isTargetUrl: (url) => url.includes('api.example.com')
})

// Later, if needed, unpatch
handle.unpatch()
```

### 2. Manual Client Usage

Use the client manually for specific requests:

```javascript
import { createSynpaticoClient } from '@synpatico/client/client'

const client = createSynpaticoClient({
  isTargetUrl: (url) => url.includes('api.example.com')
})

// Use the optimized fetch
const response = await client.fetch('https://api.example.com/data')
const data = await response.json()

// Clear cache if needed
client.clearCache()

// Access the registry
const registry = client.getRegistry()
```

## Options

Both `patchGlobals` and `createSynpaticoClient` accept the following options:

- `isTargetUrl?: (url: string) => boolean` - Filter which URLs to optimize
- `enableLifecycle?: boolean` - Enable lifecycle hooks (default: true)
- `lifecycle?: object` - Lifecycle event handlers
  - `onPacketDecoded?: (info) => void` - Called when a packet is decoded
  - `onLearnedStructure?: (info) => void` - Called when a new structure is learned
  - `onError?: (error, context) => void` - Called on errors
  - `transformDecoded?: (info) => any` - Transform decoded data

## Import Paths

- `@synpatico/client` - All exports (default)
- `@synpatico/client/patch` - Only patching functionality
- `@synpatico/client/client` - Only client functionality

## License

MIT