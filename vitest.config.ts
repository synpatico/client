import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		// Giving each project a unique name is crucial.
		name: '@synpatico/client',
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./vitest.setup.ts'],
	},
})
