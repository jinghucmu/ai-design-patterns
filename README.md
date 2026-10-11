# AI design patterns

A public library of interaction patterns for AI products, by Jing Hu.
Site: https://jinghucmu.github.io/ai-design-patterns/

## How the site is put together

- `content/` holds everything that is written: the list of products, the notes on each product, the patterns, and the screenshots.
- `src/` holds the build script and the styles.
- `docs/` is the built site. GitHub Pages serves this folder. Do not edit it by hand.

## Adding notes on a product

1. Put the screenshots in `content/shots/<product>/`, for example `content/shots/suno/01-first-open.png`.
2. Add `content/teardowns/<product>.md`:

```markdown
---
product: suno
used: 2026-10-12
platform: Web, Chrome on macOS
plan: Pro
summary: One sentence on what stood out.
shots:
  - file: 01-first-open.png
    question: discover        # discover | direct | verify | recover
    alt: What the screenshot shows, for people who cannot see it.
    note: What happened at this step and why it matters.
---

Overall notes, in Markdown.
```

## Adding a pattern

Add `content/patterns/<short-name>.md`:

```markdown
---
title: Show a worked example before asking for a prompt
question: discover            # discover | direct | verify | recover
tracks: [multimodal]          # shopping | multimodal | accessibility
status: observed              # observed | tested | withdrawn
summary: One sentence that says what the pattern is.
published: 2026-10-15
seen_in:
  - product: suno
    shot: 01-first-open.png
    note: How this product does it.
---

## Problem
## Interaction
## Where it fails
## Accessibility requirements
## How to test it
```

## Building

```
npm install
npm run build      # writes docs/
npm run preview    # writes preview/ and includes content/_drafts
```

The build stops with a list of problems if a screenshot has no text description, a pattern is missing one of its five sections, or a product name is not in the list.
