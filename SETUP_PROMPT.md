# One-shot setup prompt

## Read this first: run it in Codex

**Use OpenAI Codex for this setup, not a plain coding agent.** Codex has native image generation, which means it can take a selfie of your face and turn it into the pixel-art avatar and sprite the OS uses, in the same session that it edits your code. Any other agent will fill in your text and then quietly leave the placeholder avatar sitting there.

If you only have Claude Code, Cursor, or something else: everything below still works, you will just get the two placeholder SVGs instead of your own face. In that case generate the avatar separately (paste the image prompts in Section 2 into ChatGPT or any image model), drop the files into `assets/`, and tell the agent to wire them in.

**Before you start, put a clear photo of your face in the repo root** (front-facing, good light, shoulders up, `me.jpg` is fine). The image prompts below use it as the reference.

---

## Section 1: the setup prompt

Copy everything in the fenced block and paste it as your first message, with this repo open as the working directory.

```
You are setting up "Open Portfolio OS" for me — a gamified retro-desktop-OS portfolio template (static HTML/CSS/JS, no build step). The whole site is already built; every place I need to personalize is marked with a {{TOKEN_LIKE_THIS}}.

Step 1 — Ask me these questions in ONE message, batched, before touching any code:
1. Your full name, and how you want it split (first / last)?
2. One-line positioning (e.g. "AI Voice Engineer in Austin" or "Full-Stack Freelancer in Berlin")?
3. A short bio, 2 sentences, in your own voice?
4. Your location, current title/role, and one standout stat (age, years of experience, a number)?
5. 3 real projects: name, one-line description, category tag, and live URL (or leave blank if private)?
6. 3 case studies you can show numbers for: client/project name, sector, the headline metric, and an honest one-line outcome (mark it "claimed, not audited" if it's self-reported)?
7. Your booking link (Calendly or similar), contact email, and social URLs (YouTube, Instagram, X, GitHub — skip any you don't use)?
8. Your site's domain (or leave as a placeholder if not deployed yet)?
9. 6 short achievement/milestone badges (a stat + a title + one line each)?
10. A personal timeline: your own version of the Journey tab — 5-8 {year, title, one-line} milestones plus what you're chasing next?
11. Do you want the "Play Games" arcade section, the hidden Konami-code mini-game, and the DO_NOT_OPEN rickroll folder kept, or stripped out?
12. Optional: any real YouTube testimonial video IDs to drop into the empty proofVideos array?

ASSETS — ask these in the same message, do not split them out:
13. Is there a photo of your face in this repo (filename?), so I can generate your pixel avatar and sprite from it?
14. Do you already have assets on your computer you want used instead of generating anything — a logo, product screenshots, project thumbnails, a custom cursor, sprites, wallpapers? Give me the folder path and I will copy them in rather than making new ones.
15. Keep the three included looping video wallpapers (cotton candy dawn, anime sky, deep space), or swap them for your own?

Infer sensible defaults for anything minor and say so ("assuming X unless you tell me otherwise") rather than asking a 16th question.

Step 2 — Replace every {{TOKEN}} across index.html and app.js with the real answers. Grep for "{{" first to find them all; don't leave any unresolved token in the shipped site.

Step 3 — Generate my pixel-art character. Read the IMAGE PROMPTS in Section 2 of this repo's SETUP_PROMPT.md, use my face photo as the reference image, generate both the avatar and the sprite, save them over assets/placeholder-avatar.svg and assets/placeholder-sprite.svg (PNG with real transparency is fine, update the references), and wire them in. If you have no image generation capability, say so plainly right now instead of skipping it silently, and tell me to run the prompts myself.

Step 4 — Verify before telling me it's done: open the site in a browser, click through every desktop app (Projects, About, Journey, Achievements, Testimonials, Proof, Contact, Browser, Play Games), confirm zero broken images and zero console errors, confirm the video wallpaper is actually playing and looping, and confirm no {{TOKEN}} text is visible anywhere on the rendered page.

Step 5 — Tell me exactly how to run it locally (a one-line server command) and how to deploy it (Netlify drop, Vercel, or GitHub Pages — whichever you set up).
```

---

## Section 2: image prompts (your face to pixel art)

Two images. Both use your real photo as the reference. Run them in Codex, or paste them into any image model and drop the results into `assets/`.

### Prompt A — the avatar (replaces `assets/placeholder-avatar.svg`)

```
Using the attached photograph as the identity reference, create a 512x512 pixel-art character portrait of this exact person, rendered on a 32x32 logical pixel grid upscaled with hard nearest-neighbour edges so every pixel is a crisp square with no anti-aliasing, no blur and no soft gradient anywhere in the image. Preserve the person's real identifying features and translate them into pixel form: the same hair colour, hairline and hair length, the same skin tone, the same facial hair if any, and the same eyewear if they wear glasses, drawn as a simple two-pixel-thick frame. Frame it head and shoulders, centred, facing the viewer, with a calm confident closed-mouth half-smile, not a grin and not a neutral stare. Limit the whole image to a palette of roughly sixteen colours with visible flat colour blocks and a single darker outline colour tracing the silhouette and the major internal shapes. Light the character from the upper left so there is one clear highlight block on the cheek and hair and one shadow block under the jaw. Render the background fully transparent, no checkerboard, no colour fill, no drop shadow, no vignette. Style reference: late-90s SNES and early point-and-click adventure portrait art, deliberate and readable at small size, not a photograph with a pixelate filter applied on top.
```

Negative: no photorealism, no anti-aliased edges, no gradient shading, no drop shadow, no background fill, no text, no watermark, no smoothing filter over a photograph.

### Prompt B — the walking sprite (replaces `assets/placeholder-sprite.svg`)

```
Using the attached photograph as the identity reference, create a full-body pixel-art game sprite of this exact person on a transparent background, rendered on a 48x64 logical pixel grid upscaled with hard nearest-neighbour edges so every pixel is a crisp square, with no anti-aliasing and no blur anywhere. This is a side-scroller character standing in a neutral idle pose, feet flat, arms relaxed at the sides, facing three-quarters toward the viewer, head slightly larger than realistic proportion in classic sprite fashion so the face stays readable at small size. Carry over the person's real features from the photo: hair colour and shape, skin tone, facial hair, and glasses if they wear them. Dress the character in simple modern clothing that reads instantly as flat colour blocks, a plain dark tee or hoodie and dark trousers, with one small accent colour on the shoes or a cuff so the silhouette has a focal point. Limit the palette to about twelve colours, flat fills only, with a single dark outline colour tracing the full silhouette so the sprite separates cleanly from any wallpaper behind it. Light from the upper left with exactly one highlight block and one shadow block per major form. Background fully transparent, nothing else in frame, no ground shadow, no platform, no props.
```

Negative: no photorealism, no anti-aliased edges, no gradient shading, no background, no ground shadow, no text, no watermark, no extra limbs, no smoothing filter over a photograph.

Save both as PNG with a real alpha channel. If your model cannot output transparency, generate on flat magenta `#FF00FF` and key it out before wiring them in.

---

## Section 3: what already ships in the box

You do not need to generate these.

- **Three looping video wallpapers** in `assets/wallpapers/` (cotton candy dawn, anime sky, deep space) that rotate on the desktop every 40 seconds, each with a JPG poster frame. Free to use, keep them or swap them.
- **Two real playable games** in `games/` wired into the Play Games app, plus a hidden Konami-code mini-game.
- **Full pixel icon sets** for the dock, desktop tiles, and world objects in `assets/icons-v4/` and `assets/premium-*`.
- **A rickroll easter egg** behind the DO_NOT_OPEN folder.

The prompt block in Section 1 is self-contained. The agent does not need anything else from this file except the image prompts, which it is told to come back and read.
