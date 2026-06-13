# michael demsko jr

Static personal site plus a local Mac admin app for publishing photos and posts.

## Structure

- `website/`: React + Vite website source.
- `docs/`: generated GitHub Pages output.
- `admin/desktop/`: Electron desktop admin app.

## Website

```bash
npm install
npm run dev:website
npm run build
```

`npm run build` writes the production site to `docs/`, which keeps GitHub Pages compatible with publishing from `main/docs`.

## Desktop Admin

```bash
npm run admin:desktop
```

The desktop app edits the local `website/` folder by default. It can also choose another website folder from the app toolbar. It can update photo-of-the-day entries, create posts, copy images into the website assets, and optionally rebuild `docs/`.

To package a Mac app:

```bash
npm run admin:package
```
