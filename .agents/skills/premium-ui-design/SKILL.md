---
name: premium-ui-design
description: >-
  World-class Lead Product Designer and Creative Director skill for designing,
  architecting, and implementing high-craft, cutting-edge, premium web and app user
  interfaces inspired by Apple Intelligence, Stripe, Linear, and OpenDots. Use when
  building or auditing production UI/UX, glassmorphism systems, motion interactions,
  custom typography, surface depth, and visual presentation.
---

# Premium UI/UX Design System & Craft Standard

This skill establishes the rigorous standard, design tokens, architectural rules, and implementation patterns required to build elite, state-of-the-art digital products. It transforms standard functional web applications into deeply sophisticated, tactile, and unforgettable experiences that immediately communicate world-class engineering quality.

---

## 1. Visual Style & Surface Architecture

### 1.1 Progressive Glassmorphism System
Never use flat, opaque gray boxes or muddy translucent overlays. A true premium glass surface requires multi-layered depth, progressive blur, and refractive light physics:

* **Progressive Backdrop Blur:** Minimum `20px` to `28px` with `saturate(180%)` to enrich background contrast rather than washing it out.
* **Dual-Boundary Hairline Stroke:**
  * **Outer Rim:** `1px solid rgba(255, 255, 255, 0.08)` (or subtle contextual tint on active states).
  * **Inner Specular Light Rim:** `inset 0 1px 0 0 rgba(255, 255, 255, 0.06)` to simulate top-down natural light refraction.
* **Surface Tiers:**
  * `Tier 0 (Canvas Base):` Deep monochromatic obsidian `#08080a` or `#0a0a0e`.
  * `Tier 1 (Panels & Sidebars):` `rgba(14, 14, 18, 0.75)` with `backdrop-filter: blur(24px) saturate(180%)`.
  * `Tier 2 (Cards & Modules):` `rgba(18, 18, 24, 0.65)` with `backdrop-filter: blur(20px) saturate(180%)`.
  * `Tier 3 (Floating Inputs & Popovers):` `rgba(22, 22, 30, 0.85)` with `backdrop-filter: blur(28px) saturate(190%)`.

### 1.2 Apple Intelligence-Style Fluid Edge Glows
Active elements, focus states, and intelligence indicators must emit a living, multi-layered fluid aura:
* Use generative multi-stop conic or linear gradients (`rgba(139, 92, 246, 0.45)`, `rgba(59, 130, 246, 0.35)`, `rgba(16, 185, 129, 0.4)`) combined with masked pseudo-elements (`-webkit-mask-composite: xor`).
* Underlying gradient meshes should animate at slow, organic breathing cadences (`2.5s` to `3.5s`), never jarring flashes.

### 1.3 Cursor-Responsive Ambient Spotlight
Interactive surfaces and cards must capture ambient cursor movement:
* Dynamically compute relative mouse position `(x, y)` and render a radial gradient highlight:
  `radial-gradient(400px circle at ${mouseX}px ${mouseY}px, rgba(255,255,255,0.06), transparent 70%)`.
* On card hover, elevate elevation with a minute lift (`transform: translateY(-1.5px)`) and expand the ambient shadow.

---

## 2. Typography & Layout Geometry

### 2.1 The Typographic Hierarchy
* **Geometric Sans-Serif:** Clean, high-legibility geometric sans (`-apple-system`, `SF Pro Display`, `Inter`, `Geist`).
* **Header Optical Kerning:** Enforce negative tracking (`letter-spacing: -0.025em` to `-0.035em`) on all headers `h1` through `h4` to remove looseness and deliver an authoritative, editorial punch.
* **Prose Line Heights:** Enforce generous body line-heights (`1.6` to `1.75`) with muted contrast for secondary text (`#a1a1aa` / `#71717a`) against high-contrast `#ffffff` titles.
* **Data & Metrics:** Always pair numbers, counters, timestamps, and versions with `tabular-nums` and monospace font families.

### 2.2 Structural Restraint & Negative Space
* **Breathing Room:** Restrain element density. Every control must have deliberate padding and negative space.
* **Zero Clutter:** Never cram multiple primary actions together. Maintain a strict visual hierarchy with at most one high-contrast primary action per viewport chunk.
* **Unified Corner Radii:** Enforce coherent radii tiers: `rounded-2xl` (16px) for major cards, `rounded-xl` (12px) for buttons/inputs, `rounded-lg` (8px) for inner badges.

---

## 3. Motion & Micro-Interactions (Stripe-Grade Physics)

### 3.1 Custom Cubic-Bezier Physics
Never use browser-default `ease` or linear transitions. Use physical, snappy deceleration curves:
```css
/* Standard fast snap (buttons, toggles, badges) */
transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

/* Entrance & layout expansion (modals, drawers, cards) */
transition: all 0.32s cubic-bezier(0.16, 1, 0.3, 1);
```

### 3.2 Coordinated Stagger & Scale Expansions
* When viewports or lists render, animate items with a coordinated stagger fade and subtle scale expansion:
  `opacity: 0, transform: translateY(8px) scale(0.98)` $\rightarrow$ `opacity: 1, transform: translateY(0) scale(1)`.
* Modals enter with an instant soft backdrop blur (`0.2s`) paired with a spring scale-in from `0.96` to `1`.

### 3.3 Layered Hover States
Buttons and cards must feature multi-layered tactile feedback:
1. **Internal Specular Shift:** Inner border opacity increases from `0.08` to `0.18`.
2. **Elevation Lift:** Minute physical lift `translateY(-1.5px)`.
3. **Ambient Shadow Softening:** Box-shadow transitions to a wide, low-opacity ambient diffusion (`0 12px 30px -4px rgba(0,0,0,0.6)`).
4. **Active Depress:** On click / `:active`, snap to `scale(0.985) translateY(0)`.

---

## 4. Zero-Tolerance Anti-Patterns (Quality Gate)

Any production interface failing the following checks is considered **unacceptable and incomplete**:

1. **NO RAW UNPARSED MARKDOWN TOKENS:**
   * Never render raw asterisks `**text**`, hashes `# Heading`, inline backticks `` `code` ``, or ASCII pipes `|---|` in chat bubbles, preview cards, or document viewers. Always pass markdown strings through an AST parser (`RichMarkdown`) that outputs semantic HTML nodes.
2. **NO RAW OS EMOJIS:**
   * Standard yellow operating system emojis (`🚀`, `🔬`, `⚡`, `🧭`, `✍️`, `👑`, `📄`, `✕`) destroy visual craft and look like amateur prototypes.
   * Always replace emojis with refined vector archetype icons (Lucide/SVG) accompanied by luminous ambient color halos.
3. **NO GENERIC RAINBOW GRADIENTS:**
   * Do not use random multi-colored neon backgrounds. Stick to deep monochromatic near-blacks paired with a singular intentional accent tone.
4. **NO RAW BROWSER FORM CONTROLS:**
   * Default blue browser focus rings and standard gray input boxes are strictly forbidden. All inputs must use `.glass-input` styling with subtle keyboard focus halos.

---

## 5. Implementation Workflow for UI Overhauls

When tasked with auditing or elevating an interface:
1. **Audit All Surfaces:** Check headers, sidebars, cards, modals, tables, and toolbars against the 4 Anti-Patterns.
2. **Ensure Markdown AST Coverage:** Verify that every text node potentially receiving AI model output renders through `RichMarkdown`.
3. **Verify Iconography Consistency:** Confirm that all entities have custom vector archetype badges with appropriate luminous auras.
4. **Inject Ambient Motion & Spotlight:** Add `.glass-card`, `.glass-panel`, `.apple-fluid-glow`, and cubic-bezier transition curves.
5. **Validate with Browser Visual Subagent:** Capture actual screenshots across viewports to verify that typography, contrast, spacing, and micro-interactions feel world-class.
