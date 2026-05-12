<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/4fb20179-3e82-4eb3-aae2-4164147fd22a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `GEMINI_API_KEY` in [.env.local](.env.local) for `npm run dev`. For Docker Compose builds, use a project [.env](.env) (see [.env.example](.env.example)); if the key lives only in `.env.local`, add `GEMINI_API_KEY_FILE=.env.local` to `.env` so Compose can mount it.
3. Run the app:
   `npm run dev`
