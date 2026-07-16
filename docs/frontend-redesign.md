# Frontend Redesign — AI-native Company Brain

A ground-up visual and IA redesign of the web app: from "internal admin
dashboard" to a premium, AI-first product in the spirit of Linear, Notion,
Vercel and the Anthropic Console. **Frontend only** — no backend API, database
or workflow changes.

## 1. Folder structure (new)

```
apps/web/src/
  app/
    layout.tsx                 # Geist fonts + theme provider (dark-first)
    globals.css                # design tokens, glass, elevation, cmdk, a11y
    page.tsx                   # → /home
    (auth)/
      layout.tsx               # full-bleed
      login/page.tsx           # split-screen animated auth
    (app)/
      layout.tsx               # shell composition (sidebar/topbar/⌘K/AI dock)
      home/page.tsx            # the new main experience
      ask/page.tsx             # grounded conversational search
      people|meetings|tasks|projects/page.tsx   # friendly typed views
  components/
    ui/primitives.tsx          # Skeleton, Badge, EmptyState, Thinking, Kbd, Dot, PageHeader
    cards/entity-card.tsx      # reusable knowledge card
    collections/knowledge-collection.tsx  # People/Tasks/Meetings/Projects engine
    shell/
      shell-context.tsx        # ⌘K + mobile-nav + AI dock state
      sidebar.tsx              # IA nav + Developer Tools group + mobile drawer + BrandMark
      topbar.tsx               # ⌘K search trigger + Ask Brain
      command-menu.tsx         # universal search (cmdk)
      ai-dock.tsx              # floating assistant
      page-transition.tsx      # route enter animation
    auth/neural-canvas.tsx     # animated knowledge-graph visualization
  lib/
    nav.ts                     # product-language navigation model
    entities.ts               # entity-type → friendly label/color/icon
    motion.ts                  # motion tokens & variants
```

## 2. Layout architecture

`AuthProvider → ShellProvider → { Sidebar · [Topbar · PageTransition(children)] · CommandMenu · AiDock }`.
The shell is a single composition so **every page** inherits the new nav,
search, transitions and assistant. Content is centered at `max-w-6xl` with an
8pt rhythm and generous whitespace.

## 3. Design system

- **Color** — neutral grays + **one** indigo→violet AI accent (`--ai`,
  `--ai-2`); primary action _is_ the accent. Status colors (success/warning/
  destructive) only where they carry meaning. No large color blocks.
- **Typography** — Geist Sans + Geist Mono (self-hosted, offline-safe),
  tightened tracking, comfortable line-height, tabular/stylistic features on.
- **Radius** — `0.75rem` base with an `sm…2xl` scale.
- **Elevation** — `shadow-elevation-{low,mid,high}` + `shadow-glow` (accent).
- **Glass** — `.glass` (blur + saturate) for the command menu and AI dock only.
- **Tokens** live as HSL CSS variables (`globals.css`) mapped in
  `tailwind.config.ts`, so light/dark and opacity composition are free.

## 4. Component inventory

Skeleton / SkeletonCard, Badge (5 tones), EmptyState, Thinking (AI dots), Kbd,
Dot, PageHeader, EntityCard, KnowledgeCollection, Sidebar/NavLink, Topbar,
CommandMenu, AiDock, NeuralCanvas, PageTransition, BrandMark.

## 5. Motion guidelines (`lib/motion.ts`)

One easing language (`cubic-bezier(0.22,1,0.36,1)`), three durations
(fast/base/slow). Patterns: `fadeUp`, `scaleIn`, `staggerContainer`,
`pageTransition`, `cardHover`. Signature moments: animated auth graph, ⌘K
spring, staggered card entrances, AI "thinking" dots, pulse-ring on the dock,
layout-animated active nav indicator. All gated by `prefers-reduced-motion`.

## 6. Theme system

`next-themes`, class strategy, **dark by default** (primary experience), light
fully polished. Toggle in the sidebar and on the auth screen.

## 7. Responsive strategy

Mobile-first. Sidebar collapses to an animated drawer (`< md`); topbar exposes
a menu button and keeps ⌘K. Grids reflow `1 → 2 → 3` columns; the Ask context
panel and hero adapt. Verified desktop → phone widths.

## 8. Accessibility

Semantic landmarks, `aria-label`s on icon buttons, visible focus rings,
keyboard-first command palette (⌘K/Ctrl-K, arrow/enter), reduced-motion
support, AA-contrast tokens in both themes, `kbd` affordances.

## 9. Information architecture (engineering → product language)

| User sees                            | Backed by (unchanged API)                                     |
| ------------------------------------ | ------------------------------------------------------------- |
| Home                                 | memory stats · knowledge · changes · docs                     |
| Ask Brain                            | knowledge + memory search (grounded)                          |
| Knowledge                            | `/brain` knowledge explorer                                   |
| People / Meetings / Tasks / Projects | knowledge objects by type                                     |
| Company Memory                       | `/memory`                                                     |
| Documents                            | `/knowledge`                                                  |
| Integrations                         | `/connectors`                                                 |
| **Developer tools**                  | graph · timelines · conflicts · changes · library (collapsed) |

## 10. Status & honest notes

**Delivered & production-building:** design system, shell, ⌘K search, floating
AI dock, split-screen animated auth, Home, Ask Brain, People/Meetings/Tasks/
Projects. Every existing page inherits the new tokens, fonts and chrome.

**Grounded, not fabricated:** there is no chat/LLM endpoint (Phase 3 excluded
chat), so "Ask Brain" performs real search across knowledge + memory and cites
real sources rather than inventing prose. Wiring an LLM later turns the same UI
into streaming answers.

**Next iteration:** rebuild the knowledge graph on React Flow (mini-map, node
expand/collapse, animated edges); restyle the internal Memory/Timeline pages
from their current token-inherited look into bespoke rich layouts; promote
People/Meetings/Tasks to first-class once dedicated APIs exist.
