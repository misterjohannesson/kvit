import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: 'build' }),
    // CSRF is enforced host-relative in src/hooks.server.ts (the app is reached
    // under whatever name the private network uses); Kit's fixed origin list is off.
    csrf: { trustedOrigins: ['*'] },
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:'],
        'frame-src': ['self'],
        'object-src': ['self'],
        'base-uri': ['self'],
        'form-action': ['self']
      }
    }
  }
};

export default config;
