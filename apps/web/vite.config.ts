// apps/web/vite.config.ts
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
	plugins: [sveltekit()],

	resolve: {
		// make the "svelte" condition available
		conditions: ['svelte'],
		// hard-map packages to their concrete files to bypass export maps
		alias: {
			'mode-watcher': resolve(__dirname, 'node_modules/mode-watcher/dist/index.js'),
			'bits-ui': resolve(__dirname, 'node_modules/bits-ui/dist/index.js')
		}
	},

	// don't prebundle these (prevents dev-side quirks)
	optimizeDeps: {
		exclude: ['mode-watcher', 'bits-ui']
	},

	// force bundling during SSR so Rollup doesn’t try to externalize them
	ssr: {
		noExternal: ['mode-watcher', 'bits-ui']
	}
});
