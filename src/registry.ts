import type { ClientRegistry, StructureDefinition } from '@synpatico/core'

export function createRegistry(): ClientRegistry {
	return {
		structures: new Map<string, StructureDefinition>(),
		patterns: new Map(),
		requestToStructureId: new Map<string, string>(),
	}
}
