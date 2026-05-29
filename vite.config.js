import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react' // หรือปลั๊กอินอื่น ๆ ที่คุณใช้

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      'nonexperimental-pseudofeverish-ouida.ngrok-free.dev'
    ]
  }
})