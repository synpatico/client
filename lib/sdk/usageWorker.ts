type MsgStrings = {
  kind: 'paths-strings'
  structureId: string
  endpoint: string
  ts: number
  paths: string[]
}
type MsgOrdinals = {
  kind: 'paths-ordinals'
  structureId: string
  endpoint: string
  ts: number
  ordinals: number[]
}
type TelemetryMsg = MsgStrings | MsgOrdinals

const buckets = new Map<string, Map<string, number>>() // key -> path -> count
const MAX_PATHS_PER_BUCKET = 5000

const bucketKey = (sid: string, ep: string) => `${sid}@@${ep}`

const handleMsg = (msg: TelemetryMsg) => {
  const key = bucketKey(msg.structureId, msg.endpoint)
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = new Map()
    buckets.set(key, bucket)
  }
  if (msg.kind === 'paths-strings') {
    for (const p of msg.paths) {
      if (!bucket.has(p) && bucket.size >= MAX_PATHS_PER_BUCKET) continue
      bucket.set(p, (bucket.get(p) || 0) + 1)
    }
  } else {
    for (const ord of msg.ordinals) {
      const p = String(ord)
      if (!bucket.has(p) && bucket.size >= MAX_PATHS_PER_BUCKET) continue
      bucket.set(p, (bucket.get(p) || 0) + 1)
    }
  }
}

self.onmessage = (e: MessageEvent<TelemetryMsg>) => handleMsg(e.data)

const flush = async () => {
  if (buckets.size === 0) return
  const payload: Array<{ structureId: string; endpoint: string; counts: Array<[string, number]>; ts: number }> = []
  for (const [k, m] of buckets) {
    const [sid, ep] = k.split('@@')
    payload.push({ structureId: sid, endpoint: ep, counts: Array.from(m.entries()), ts: Date.now() })
  }
  buckets.clear()
  try {
    await fetch('/synpatico/telemetry/paths', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    })
  } catch {
    // swallow; next tick tries again
  }
}

setInterval(flush, 10_000)
self.addEventListener('pagehide', () => flush())
