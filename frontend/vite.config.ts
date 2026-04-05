import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from "path"
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // 修复代码： 强行修正 Vite 6 在 Wails v2 中的热更新 (HMR) 迷路问题
  server: {
    hmr: {
      host: "localhost",
      protocol: "ws",
    }
  }
  // ---------------
})
