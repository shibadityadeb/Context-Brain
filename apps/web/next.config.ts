import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// A stray package-lock.json in the home dir makes Next infer the wrong workspace
// root, which degrades dev Fast Refresh (edits stop hot-applying). Pin the root
// to the monorepo so file-watching tracks this repo, not the home directory.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  transpilePackages: ['@company-brain/ui', '@company-brain/types', '@company-brain/studio'],
  eslint: {
    // Linting runs via `pnpm lint` (shared flat config), not next build.
    ignoreDuringBuilds: true,
  },
  // `@company-brain/studio` is authored as NodeNext ESM source (relative imports
  // carry `.js` extensions). webpack doesn't rewrite `.js`→`.ts` the way tsc
  // does, so teach it to resolve source extensions for those specifiers.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
