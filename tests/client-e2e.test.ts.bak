/**
 * Synpatico End-to-End Integration Test (No Analytics)
 * ----------------------------------------------------
 * Validates the full learning → optimized flow between the Synpatico
 * client SDK and the agent plugin, ensuring responses are always
 * standards-compliant `Response` objects and JSON bodies decode correctly.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// Agent (server) and Client (SDK)
import { agent } from '../../agent/src'
import { createSynpaticoClient } from '../../client/src/index'
import type { URLString } from '@synpatico/core'

// --- Test Configuration ---
const TEST_PORT = 3002
const TEST_AGENT_URL = `http://localhost:${TEST_PORT}`

describe('Synpatico E2E Agent/Client Interaction (No Analytics)', () => {
  let server: FastifyInstance

  // Start agent server
  beforeAll(async () => {
    server = Fastify()
    server.register(agent)
    await server.listen({ port: TEST_PORT })
  })

  // Stop agent server
  afterAll(async () => {
    await server.close()
  })

  test('handles GET request learning → optimized flow', async () => {
    const client = createSynpaticoClient()

    // 1) First request (learning phase): should return standard JSON
    const firstResponse = await client.fetch(`${TEST_AGENT_URL}/api/users/2` as URLString)
    expect(firstResponse.ok).toBe(true)
    expect(firstResponse.headers.get('content-type') || '').toMatch(/application\/json/i)

    const firstBody = await firstResponse.json()
    expect(firstBody).toBeTypeOf('object')
    expect(firstBody.data?.id).toBe(2)
    expect(firstBody.data?.email).toBe('janet.weaver@reqres.in')

    // 2) Second request (optimized phase): client should decode packet and still return a Response
    const secondResponse = await client.fetch(`${TEST_AGENT_URL}/api/users/2` as URLString)
    expect(secondResponse.ok).toBe(true)
    expect(secondResponse.headers.get('content-type') || '').toMatch(/application\/json/i)

    const secondBody = await secondResponse.json()
    expect(secondBody).toBeTypeOf('object')
    expect(secondBody.data?.id).toBe(2)
    expect(secondBody.data?.email).toBe('janet.weaver@reqres.in')
  })

  test('does not interfere with normal JS operations on the decoded body', async () => {
    const client = createSynpaticoClient()

    // Make sure we’ve learned the structure
    await client.fetch(`${TEST_AGENT_URL}/api/users/2` as URLString)
    const response = await client.fetch(`${TEST_AGENT_URL}/api/users/2` as URLString)
    const data = await response.json()

    // Basic JS checks
    expect(typeof data).toBe('object')
    expect(data !== null).toBe(true)
    expect(Array.isArray(data)).toBe(false)

    // Property existence
    expect(Object.prototype.hasOwnProperty.call(data, 'data')).toBe(true)
    expect('data' in data).toBe(true)

    // Object methods
    const keys = Object.keys(data)
    const values = Object.values(data)
    const entries = Object.entries(data)

    expect(keys.length).toBeGreaterThan(0)
    expect(values.length).toBeGreaterThan(0)
    expect(entries.length).toBeGreaterThan(0)

    // JSON round-trip integrity
    const jsonString = JSON.stringify(data)
    const reparsed = JSON.parse(jsonString)

    expect(reparsed.data.id).toBe(data.data.id)
    expect(reparsed.data.email).toBe(data.data.email)

    // Equality comparisons
    expect(data.data.id === 2).toBe(true)
    expect(data.data.first_name === 'Janet').toBe(true)
  })
})
