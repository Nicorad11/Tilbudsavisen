import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Admin-appen er en egen indgang (admin.html). Under udvikling åbnes den på
 * http://admin.localhost:5173 – sider på det værtsnavn får admin.html i stedet
 * for hjemmesiden. I produktion gør serveren det samme for admin.tilbudsradaren.dk.
 */
function adminHost(): Plugin {
  return {
    name: 'tilbudsradar-admin-host',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const isAdmin = (req.headers.host ?? '').startsWith('admin.');
        const wantsPage = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html') && !req.url?.startsWith('/api');
        if (isAdmin && wantsPage) req.url = '/admin.html';
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), adminHost()],
  // Én .env i rodmappen til både backend og frontend (kun VITE_* når frontenden).
  envDir: '..',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
});
