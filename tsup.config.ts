import { defineConfig } from 'tsup'

export default defineConfig({
	// Multiple entry points for different export paths
	entry: {
		index: 'src/index.ts',
		patch: 'src/patch.ts',
		client: 'src/client.ts',
	},
	format: ['cjs', 'esm'],
	// We are using `tsc` to generate declaration files, so this is false.
	dts: false,
	splitting: false,
	sourcemap: true,
	clean: false, // The parent 'clean' script in package.json handles this
})
