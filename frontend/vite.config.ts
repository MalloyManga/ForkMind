import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // 修复代码： 强行修正 Vite 6 在 Wails v2 中的热更新 (HMR) 迷路问题
  server: {
    hmr: {
      host: "localhost",
      protocol: "ws",
    }
  }
  // ---------------
})
