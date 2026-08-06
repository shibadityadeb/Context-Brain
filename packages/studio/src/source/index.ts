/**
 * Source-code export — the generated website as a real, runnable Next.js project.
 *
 * The important decision here is that the zip contains the SAME components the
 * hosted story renders, not a re-implementation. A second, simplified renderer
 * written just for export would drift from the real one within a release, and
 * the download would quietly stop being "your site". The caller supplies the
 * actual component sources (read from disk); this module owns the scaffold — the
 * project files, configuration, entry point and asset wiring around them.
 *
 * Keeping the file I/O in the caller also preserves the repo convention that
 * packages stay pure and dependency-light.
 */

import JSZip from 'jszip';
import type { StoryExperience } from '../story/types.js';

export interface ProjectAsset {
  /** Path relative to `public/`, e.g. `assets/logo.png`. */
  path: string;
  bytes: Uint8Array;
}

export interface ProjectInput {
  story: StoryExperience;
  /** Component + library sources, keyed by their path inside the project. */
  files: Record<string, string>;
  assets?: ProjectAsset[];
  /** Asset id → public path, so scenes resolve images from `public/`. */
  assetPaths?: Record<string, string>;
  logoPath?: string | null;
  projectName?: string;
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'story-site';

const PACKAGE_JSON = (name: string) =>
  JSON.stringify(
    {
      name,
      version: '1.0.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
      },
      dependencies: {
        next: '^15.3.0',
        react: '^19.1.0',
        'react-dom': '^19.1.0',
        'framer-motion': '^12.42.2',
        lenis: '^1.3.25',
        'lucide-react': '^0.488.0',
      },
      devDependencies: {
        '@types/node': '^22.14.1',
        '@types/react': '^19.1.0',
        '@types/react-dom': '^19.1.0',
        autoprefixer: '^10.4.21',
        postcss: '^8.5.3',
        tailwindcss: '^3.4.17',
        typescript: '^5.8.3',
      },
    },
    null,
    2,
  );

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  },
  null,
  2,
);

const TAILWIND_CONFIG = `import type { Config } from 'tailwindcss';

/** The story renders from CSS custom properties set by its art direction, so
 *  Tailwind here is layout only — no theme to keep in sync. */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
`;

const POSTCSS_CONFIG = `export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
`;

const NEXT_CONFIG = `/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
};
`;

const GLOBALS_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

/* The art direction sets --story-* custom properties on the root element; every
   scene styles itself from those, so restyling the whole site is one object. */
html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  font-family: var(--story-body, ui-sans-serif, system-ui, sans-serif);
}

/* Lenis smooth scrolling */
html.lenis,
html.lenis body {
  height: auto;
}
.lenis.lenis-smooth {
  scroll-behavior: auto !important;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
`;

const NEXT_ENV = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`;

const GITIGNORE = `node_modules
.next
out
.DS_Store
*.tsbuildinfo
`;

const LAYOUT = (title: string, description: string) => `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: ${JSON.stringify(title)},
  description: ${JSON.stringify(description)},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

/**
 * The entry point. Deliberately thin: it wires the story data to the same scene
 * registry and chrome the hosted version uses, so reading this file tells you
 * exactly how the site is assembled.
 */
const PAGE = (assetPaths: Record<string, string>, logoPath: string | null) => `'use client';

import Lenis from 'lenis';
import { useEffect } from 'react';
import { artDirectionCssVars, type StoryExperience } from '@/lib/story';
import { LogoIntro, SceneRail, ScrollProgress, useActiveScene } from '@/components/story/chrome';
import { SCENE_COMPONENTS } from '@/components/story/scenes';
import storyData from '@/story.json';

const story = storyData as unknown as StoryExperience;

/** Asset ids resolved to files in public/. */
const ASSET_URLS: Record<string, string> = ${JSON.stringify(assetPaths, null, 2)};
const LOGO_URL: string | null = ${JSON.stringify(logoPath)};

export default function Page() {
  const active = useActiveScene(story.scenes);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({
      duration: 1.05,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      touchMultiplier: 1.6,
    });
    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return (
    <main style={{ ...artDirectionCssVars(story.art), background: story.art.base }}>
      <LogoIntro logoUrl={LOGO_URL} art={story.art} />
      <ScrollProgress art={story.art} />
      <SceneRail scenes={story.scenes} active={active} />
      {story.scenes.map((scene) => {
        const Scene = SCENE_COMPONENTS[scene.kind];
        return (
          <Scene
            key={scene.id}
            scene={scene}
            art={story.art}
            assetUrls={ASSET_URLS}
            logoUrl={LOGO_URL}
            total={story.scenes.length}
          />
        );
      })}
    </main>
  );
}
`;

const README = (story: StoryExperience, name: string) => `# ${story.title}

${story.tagline ?? ''}

An interactive story generated by the Company Brain Storytelling Engine. This is
the real site — the same scene components that render the hosted version, not an
export approximation.

## Run it

\`\`\`bash
npm install
npm run dev
\`\`\`

Then open http://localhost:3000

## How it works

The story is data. \`story.json\` holds the art direction and an ordered list of
**scenes** — narrative moments, each with its own composition, motion intent and
payload (metrics, a diagram, a timeline, a single sentence).

- \`story.json\` — the composed story: \`art\` + \`scenes\`
- \`components/story/scenes/\` — one component per scene kind
- \`components/story/scene-shell.tsx\` — tone surfaces and ambient treatments
- \`components/story/lib/motion.ts\` — the shared motion runtime
- \`lib/story/\` — the scene model, colour system and art-direction palettes

### Changing the look

Every surface reads from CSS custom properties produced by \`artDirectionCssVars\`.
Swap \`art.paletteId\` in \`story.json\` for another palette in
\`lib/story/palettes.ts\` and the entire site re-themes.

### Changing the story

Edit \`story.json\`. Scene \`kind\` selects the component; \`tone\` selects the
surface; \`motion\` controls the entrance. Adding a new kind means adding a
component and one entry in \`components/story/scenes/index.ts\`.

## Accessibility

All motion is dropped under \`prefers-reduced-motion\`, and no content is hidden
behind an animation — a scene that never animates is still fully readable.

---

Project name: \`${name}\`
Scenes: ${story.scenes.length}
`;

/**
 * Build the downloadable project. Returns zip bytes ready to stream.
 */
export async function buildStoryProject(input: ProjectInput): Promise<Uint8Array> {
  const name = slug(input.projectName ?? input.story.title);
  const zip = new JSZip();

  zip.file('package.json', PACKAGE_JSON(name));
  zip.file('tsconfig.json', TSCONFIG);
  zip.file('tailwind.config.ts', TAILWIND_CONFIG);
  zip.file('postcss.config.mjs', POSTCSS_CONFIG);
  zip.file('next.config.mjs', NEXT_CONFIG);
  zip.file('next-env.d.ts', NEXT_ENV);
  zip.file('.gitignore', GITIGNORE);
  zip.file('README.md', README(input.story, name));

  zip.file('app/globals.css', GLOBALS_CSS);
  zip.file(
    'app/layout.tsx',
    LAYOUT(input.story.title, input.story.tagline ?? 'An interactive story.'),
  );
  zip.file('app/page.tsx', PAGE(input.assetPaths ?? {}, input.logoPath ?? null));

  // The story itself — the data the whole project renders.
  zip.file('story.json', JSON.stringify(input.story, null, 2));

  for (const [path, contents] of Object.entries(input.files)) {
    zip.file(path, contents);
  }
  for (const asset of input.assets ?? []) {
    zip.file(`public/${asset.path}`, asset.bytes);
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
