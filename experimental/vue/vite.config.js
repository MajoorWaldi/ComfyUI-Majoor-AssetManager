import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    // Output to the main extension js folder
    outDir: '../../js/vue',
    emptyOutDir: true,
    lib: {
      // Could also be a format 'es' used by a dynamic import
      entry: resolve(__dirname, 'main.js'),
      name: 'MajoorVue',
      // the proper extensions will be added
      fileName: 'majoor-ui'
    },
    rollupOptions: {
      // make sure to externalize deps that shouldn't be bundled
      // into your library
      external: [],
      output: {
        // Provide global variables to use in the UMD build
        // for externalized deps
        globals: {
          vue: 'Vue'
        },
        // Force a specific name for the style file
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') return 'majoor-ui.css';
          return assetInfo.name;
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})
