# Open Portfolio OS

A gamified, retro-desktop-OS portfolio template. Static HTML/CSS/JS, zero build step, zero backend. Boot screen, draggable/resizable windows, dock, a real playable arcade game, a hidden Konami-code mini-game, a Finder-style case file explorer, a browser-native AI voice concierge, and a rickroll easter egg behind `DO_NOT_OPEN`.

No frameworks. No dependencies. Open `index.html` in a browser and it runs.

## Quick start

The fastest way to make this yours: drop a photo of your face in the repo root, then paste the prompt block from **`SETUP_PROMPT.md`** into **OpenAI Codex** with this repo open. It asks you one batched round of questions (name, projects, socials, contact, what assets you already have), fills in every `{{TOKEN}}`, and turns your photo into the pixel avatar and sprite.

**Run it in Codex specifically.** Codex generates images natively, so the character comes out of the same session. Claude Code and Cursor will do the text but leave the placeholder avatar in place; if that is what you have, run the image prompts in `SETUP_PROMPT.md` Section 2 yourself and drop the files into `assets/`.

To do it by hand instead:

1. Clone this repo.
2. Find every `{{TOKEN_LIKE_THIS}}` across `index.html` and `app.js` (`grep -rn "{{" .`) and replace it with your own copy.
3. Swap `assets/placeholder-avatar.svg` and `assets/placeholder-sprite.svg` for your own pixel-art character (or keep them — they're deliberately simple and on-palette).
4. Fill in the `clientCases`, `proofVideos`, and project card arrays at the top of `app.js` with your real work.
5. Serve it: `python3 -m http.server 8080` and open `localhost:8080`, or deploy the folder as-is to Netlify / Vercel / GitHub Pages.

## What's inside

- `index.html` / `app.js` / `styles.css` / `styles-v4.css` — the whole OS. One JS file, no bundler.
- `games/` — two real, playable original games (Viper Arena, Fangs.io) wired into a "Play Games" desktop app.
- `assets/wallpapers/` — three looping video wallpapers (cotton candy dawn, anime sky, deep space) that rotate every 40s.
- `assets/icons-v4/`, `assets/premium-*` — pixel-art icon sets for the dock and desktop tiles.

## Customize

Every place you need to personalize is marked with a `{{TOKEN}}`. The big ones:

| Token | What it is |
|---|---|
| `{{YOUR_NAME}}` | Shows up in the OS name, boot screen, meta tags |
| `{{YOUR_ONE_LINE_TITLE}}` | Your one-line positioning (e.g. "AI Voice Engineer in Austin") |
| `{{BOOKING_LINK}}` | Your Calendly / booking URL |
| `{{YOUTUBE_URL}}` / `{{INSTAGRAM_URL}}` / `{{X_URL}}` / `{{GITHUB_URL}}` | Your social links |
| `clientCases` array (top of `app.js`) | Your 3+ real project/client cards |
| `proofVideos` array (top of `app.js`) | Your real YouTube testimonial video IDs — leave empty and it renders a clean empty state |

## License

Do whatever you want with it. No attribution required, though a star is always appreciated.
