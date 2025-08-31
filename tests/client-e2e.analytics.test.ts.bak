// client/tests/client-e2e.analytics.test.ts
import { beforeAll, afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

// --- Mocks: mock the hook layer (easy to assert, avoids singleton recursion) ---
vi.mock("../src/analytics-hooks", () => {
  return {
    trackRequestEvent: vi.fn(),
    trackAccess: vi.fn(),
  };
});

import { trackRequestEvent, trackAccess } from "../src/analytics-hooks";
import { createSynpaticoClient } from "../src/index";
import { createStructureDefinition, type URLString } from "@synpatico/core";

// --------------------
// Local mock "agent"
// --------------------
const PORT = 39001;
const BASE = `http://localhost:${PORT}`;

type UserPayload = {
  data: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    avatar: string;
  };
  support: { url: string; text: string };
};

const USER_2: UserPayload = {
  data: {
    id: 2,
    email: "janet.weaver@reqres.in",
    first_name: "Janet",
    last_name: "Weaver",
    avatar: "https://reqres.in/img/faces/2-image.jpg",
  },
  support: {
    url: "https://contentcaddy.io?utm_source=reqres&utm_medium=json&utm_campaign=referral",
    text: "To keep ReqRes free, contributions are appreciated!",
  },
};

let server: FastifyInstance;

// mirror the client’s deterministic value extraction for “values-only”
function encodeValues(data: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (x: unknown) => {
    if (x === null || typeof x !== "object") {
      out.push(x);
      return;
    }
    if (Array.isArray(x)) {
      for (const v of x) walk(v);
      return;
    }
    const keys = Object.keys(x as Record<string, unknown>).sort();
    for (const k of keys) walk((x as Record<string, unknown>)[k]);
  };
  walk(data);
  return out;
}

async function registerMockAgent(app: FastifyInstance) {
  let learnedId: string | null = null;

  app.get("/api/users/:id", async (req, reply) => {
    const id = Number((req.params as any).id || 2);
    const payload: UserPayload = { ...USER_2, data: { ...USER_2.data, id } };

    reply.header("X-Synpatico-Agent", "synpatico-agent-unit-test");

    const acceptId = req.headers["x-synpatico-accept-id"];

    if (acceptId && learnedId && acceptId === learnedId) {
      const json = JSON.stringify(payload);
      const originalSize = Buffer.byteLength(json);

      const packet = {
        type: "values-only",
        structureId: learnedId,
        values: encodeValues(payload),
        metadata: { collisionCount: 0, levels: 1, timestamp: Date.now() },
      };

      reply
        .header("Content-Type", "application/synpatico-packet+json")
        .header("X-Synpatico-Original-Size", String(originalSize))
        .send(JSON.stringify(packet));
      return;
    }

    // learning response
    if (!learnedId) {
      learnedId = createStructureDefinition(payload as any).id;
    }
    reply.header("Content-Type", "application/json").send(payload);
  });
}

beforeAll(async () => {
  server = Fastify();
  await registerMockAgent(server);
  await server.listen({ port: PORT });
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------
// Tests
// --------------------

describe("Synpatico client analytics & proxy tracking", () => {
  test("learn → optimize flow tracks per-property touches", async () => {
    const client = createSynpaticoClient({
      enableAnalytics: true,
      analyticsOptions: { enabled: true, useWorker: false },
    });

    // 1) Learning request (vanilla JSON)
    const r1 = await client.fetch(`${BASE}/api/users/2` as URLString);
    const body1 = await r1.json();
    expect(body1?.data?.id).toBe(2);

    // trackRequestEvent called at least once with wasOptimized=false
    expect((trackRequestEvent as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    const firstCall = (trackRequestEvent as any).mock.calls.find((c: any[]) => c[1] === false);
    expect(firstCall?.[0]).toBe(`${BASE}/api/users/2`);

    // 2) Optimized request
    const r2 = await client.fetch(`${BASE}/api/users/2` as URLString);
    const body2 = await r2.json();

    expect(body2?.data?.id).toBe(2);
    expect(body2?.support?.url).toContain("https://contentcaddy.io");

    // trackRequestEvent called with wasOptimized=true
    const optimizedCall = (trackRequestEvent as any).mock.calls.find((c: any[]) => c[1] === true);
    expect(optimizedCall).toBeTruthy();

    // Touch properties to trigger proxy tracking
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _id = body2.data.id;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _email = body2.data.email;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _first = body2.data.first_name;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _supportUrl = body2.support.url;

    // give event loop a tick (not strictly necessary)
    await new Promise((r) => setTimeout(r, 10));

    const accessCalls = (trackAccess as any).mock.calls;
    expect(accessCalls.length).toBeGreaterThan(0);

    const paths = accessCalls.map((c: any[]) => c[0]?.propertyPath);
    expect(paths).toEqual(
      expect.arrayContaining(["data.id", "data.email", "data.first_name", "support.url"]),
    );
  });

  test("non-synpatico origins pass through without analytics", async () => {
    const client = createSynpaticoClient({
      enableAnalytics: true,
      analyticsOptions: { enabled: true, useWorker: false },
      isTargetUrl: (url) => url.startsWith(BASE), // only our mock origin is targeted
    });

    try {
      await client.fetch("https://example.com/nope" as URLString);
    } catch {
      // fine in CI/no network
    }

    expect((trackRequestEvent as any).mock.calls.length).toBe(0);
    expect((trackAccess as any).mock.calls.length).toBe(0);
  });
});
