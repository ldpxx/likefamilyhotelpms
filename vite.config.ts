import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Like Family PMS — Quản lý Khách sạn',
        short_name: 'Like Family PMS',
        description: 'Hệ thống quản lý khách sạn Like Family Hotel — Lễ tân, Buồng phòng, AI OCR, Tài chính & OTA',
        theme_color: '#1B5E4B',
        background_color: '#F7F6F3',
        display: 'standalone',
        lang: 'vi',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          charts: ['recharts'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
});
