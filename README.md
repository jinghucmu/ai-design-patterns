# AI product design reviews

Design reviews of the consumer AI products people pay for, by Jing Hu.
Site: https://jinghucmu.github.io/ai-design-patterns/

## How the site is put together

- `content/` holds everything that is written: the list of products, the review of each product, and the screenshots.
- `src/` holds the build script and the styles.
- `docs/` is the built site. GitHub Pages serves this folder. Do not edit it by hand.

## Adding a review

1. Put the screenshots in `content/shots/<product>/`, for example `content/shots/suno/01-first-open.png`.
2. Add `content/reviews/<product>.md`:

```markdown
---
product: suno
used: 2026-10-12
platform: Web, Chrome on macOS
plan: Pro
summary: One sentence on what stood out.
learn:
  - title: What the product does well, in one line
    text: What it does and why it works. Markdown is fine.
    shots:
      - file: 01-first-open.png
        alt: What the screenshot shows, for people who cannot see it.
        caption: Optional line under the screenshot.
improve:
  - title: Where the design gets in the way, in one line
    text: What happens and what I would change.
    shots: []
---

Other notes, in Markdown. Optional.
```

## Building

```
npm install
npm run build      # writes docs/
npm run preview    # writes preview/ and includes content/_drafts
```

The build stops with a list of problems if a screenshot has no text description, a point has no title, or a product name is not in the list.
