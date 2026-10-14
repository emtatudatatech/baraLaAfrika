import { fileURLToPath } from 'node:url';

import postcssGlobalData from '@csstools/postcss-global-data';
import postcssCustomMedia from 'postcss-custom-media';

// Breakpoints are defined once as @custom-media in media.css and made visible to every
// CSS Module, then compiled to plain media queries.
export default {
  plugins: [
    postcssGlobalData({
      files: [fileURLToPath(new URL('./src/styles/media.css', import.meta.url))],
    }),
    postcssCustomMedia(),
  ],
};
