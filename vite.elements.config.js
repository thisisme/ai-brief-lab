import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte({
      dynamicCompileOptions: ({ filename }) =>
        filename.includes('/src/lib/elements/') ? { customElement: true } : undefined
    })
  ],
  publicDir: false,
  build: {
    outDir: 'hosts/php/public/build',
    emptyOutDir: true,
    lib: { entry: 'src/elements.js', formats: ['es'], fileName: () => 'elements.js' }
  }
});
