import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const defaultWebsiteRoot = path.resolve(appRoot, "../../../website");
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const iconPath = path.join(appRoot, "assets/icon.svg");

let mainWindow;

app.whenReady().then(async () => {
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === "darwin" && !icon.isEmpty()) {
    app.dock.setIcon(icon);
  }

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 880,
    minHeight: 620,
    title: "Michael Demsko Site Admin",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    app.whenReady();
  }
});

ipcMain.handle("settings:get", async () => {
  const websiteRoot = await getWebsiteRoot();
  return {
    websiteRoot,
    valid: await isWebsiteRoot(websiteRoot),
  };
});

ipcMain.handle("settings:chooseWebsiteRoot", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose the website folder",
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    const websiteRoot = await getWebsiteRoot();
    return {
      websiteRoot,
      valid: await isWebsiteRoot(websiteRoot),
    };
  }

  const websiteRoot = await resolveWebsiteRoot(result.filePaths[0]);
  if (!websiteRoot) {
    throw new HttpError("Choose the repo folder or its inner website folder.");
  }

  await writeSettings({ websiteRoot });
  return { websiteRoot, valid: true };
});

ipcMain.handle("images:choose", async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || "Choose image",
    properties: options.multiple ? ["openFile", "multiSelections"] : ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: options.photoOnly ? ["jpg", "jpeg"] : ["jpg", "jpeg", "png", "webp", "gif"],
      },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("photos:list", async () => readPhotos());
ipcMain.handle("posts:list", async () => readPosts());
ipcMain.handle("categories:list", async () => readCategories());

ipcMain.handle("photos:create", async (_event, payload) => {
  const { title, date, imagePath, build } = payload;
  validatePhotoFields({ title, date });
  if (!imagePath) throw new HttpError("Choose a JPG image first.");

  const savedImage = await savePhotoImage(imagePath, date);
  const photo = {
    id: savedImage.id,
    src: savedImage.src,
    title: title.trim(),
    date,
  };

  const photos = await readPhotos();
  const replacedPhoto = photos.find((item) => item.date === date);
  const nextPhotos = [...photos.filter((item) => item.date !== date), photo].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  await writePhotos(nextPhotos);
  if (replacedPhoto) await removeManagedPhotoImage(replacedPhoto.src);

  if (build) await runWebsiteBuild();
  else await mirrorToDocs(savedImage.filename, savedImage.destination, "photo");

  return { photo, photos: nextPhotos };
});

ipcMain.handle("photos:update", async (_event, payload) => {
  const { id, title, date, imagePath, build } = payload;
  validatePhotoFields({ title, date });

  const photos = await readPhotos();
  const photo = photos.find((item) => item.id === id);
  if (!photo) throw new HttpError("Photo entry not found.");

  const duplicateDate = photos.find((item) => item.date === date && item.id !== id);
  if (duplicateDate) throw new HttpError(`Another photo already uses ${date}.`);

  let replacement = null;
  if (imagePath) replacement = await savePhotoImage(imagePath, date);

  const nextPhoto = {
    ...photo,
    ...(replacement ? { id: replacement.id, src: replacement.src } : {}),
    title: title.trim(),
    date,
  };
  const nextPhotos = photos
    .map((item) => (item.id === id ? nextPhoto : item))
    .sort((a, b) => a.date.localeCompare(b.date));

  await writePhotos(nextPhotos);
  if (replacement) await removeManagedPhotoImage(photo.src);

  if (build) await runWebsiteBuild();
  else if (replacement) await mirrorToDocs(replacement.filename, replacement.destination, "photo");

  return { photo: nextPhoto, photos: nextPhotos };
});

ipcMain.handle("photos:delete", async (_event, payload) => {
  const { id, build } = payload;
  const photos = await readPhotos();
  const photo = photos.find((item) => item.id === id);
  if (!photo) throw new HttpError("Photo entry not found.");

  const nextPhotos = photos.filter((item) => item.id !== id);
  await writePhotos(nextPhotos);
  await removeManagedPhotoImage(photo.src);
  if (build) await runWebsiteBuild();

  return { photo, photos: nextPhotos };
});

ipcMain.handle("posts:create", async (_event, payload) => {
  const {
    title,
    date,
    category,
    summary = "",
    tags = "",
    plainText = "",
    iframe = "",
    imagePaths = [],
    build,
  } = payload;

  validatePostFields({ title, date, category });

  const categories = await readCategories();
  if (!categories.some((item) => item.id === category)) {
    throw new HttpError("Choose a valid post category.");
  }

  const posts = await readPosts();
  const slug = uniqueSlug(slugify(title), posts);
  const savedImages = [];

  for (const imagePath of imagePaths) {
    savedImages.push(await savePostImage(imagePath, slug));
  }

  const body = [];
  if (plainText.trim()) {
    body.push(
      ...plainText
        .split(/\n{2,}/)
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({ type: "paragraph", text })),
    );
  }

  for (const image of savedImages) {
    body.push({ type: "image", src: image.src, alt: title.trim() });
  }

  const post = {
    slug,
    title: title.trim(),
    date,
    category,
    tags: splitTags(tags),
    summary: summary.trim() || plainText.trim().slice(0, 160) || "New post.",
    ...(iframe.trim() ? { embedHtml: iframe.trim() } : {}),
    body,
  };

  const nextPosts = [post, ...posts].sort((a, b) => b.date.localeCompare(a.date));
  await writePosts(nextPosts);

  if (build) await runWebsiteBuild();
  else await Promise.all(savedImages.map((image) => mirrorToDocs(image.filename, image.destination, "post")));

  return { post, posts: nextPosts };
});

ipcMain.handle("site:publish", async () => {
  const websiteRoot = await getWebsiteRoot();
  if (!(await isWebsiteRoot(websiteRoot))) {
    throw new HttpError("Choose a valid website folder before publishing.");
  }

  const repoRoot = path.dirname(websiteRoot);
  await runGit(["status", "--porcelain"], repoRoot);

  const statusBefore = await runGit(["status", "--porcelain"], repoRoot);
  if (!statusBefore.trim()) {
    return { published: false, message: "No local website changes to publish." };
  }

  await runGit(["add", "website", "docs"], repoRoot);

  const staged = await runGit(["diff", "--cached", "--name-only"], repoRoot);
  if (!staged.trim()) {
    return { published: false, message: "No website or docs changes to publish." };
  }

  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  await runGit(["commit", "-m", `Publish site updates ${timestamp}`], repoRoot);
  const pushOutput = await runGit(["push", "origin", "main"], repoRoot);
  const commit = await runGit(["rev-parse", "--short", "HEAD"], repoRoot);

  return {
    published: true,
    commit: commit.trim(),
    message: pushOutput.trim() || `Published ${commit.trim()} to GitHub.`,
  };
});

async function getWebsiteRoot() {
  const candidates = [];

  try {
    const settings = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
    if (settings.websiteRoot) candidates.push(await resolveWebsiteRoot(settings.websiteRoot));
  } catch {
    // No saved settings yet.
  }

  candidates.push(
    defaultWebsiteRoot,
    await findWebsiteRootNear(process.resourcesPath || appRoot),
    path.resolve(app.getAppPath(), "../../../website"),
    await findWebsiteRootNear(app.getAppPath()),
    await findWebsiteRootNear(process.cwd()),
  );

  for (const candidate of uniqueValues(candidates)) {
    if (await isWebsiteRoot(candidate)) return candidate;
  }

  return candidates[0] || defaultWebsiteRoot;
}

async function writeSettings(settings) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
}

async function isWebsiteRoot(websiteRoot) {
  if (!websiteRoot) return false;

  try {
    await Promise.all([
      readLocalText(path.join(websiteRoot, "src/data/photos.json")),
      readLocalText(path.join(websiteRoot, "src/data/posts.json")),
      readLocalText(path.join(websiteRoot, "src/data/categories.json")),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function resolveWebsiteRoot(selectedPath) {
  if (!selectedPath) return "";
  if (await isWebsiteRoot(selectedPath)) return selectedPath;

  const nestedWebsite = path.join(selectedPath, "website");
  if (await isWebsiteRoot(nestedWebsite)) return nestedWebsite;

  return "";
}

async function findWebsiteRootNear(startPath) {
  if (!startPath) return "";

  let current = path.resolve(startPath);
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(current, "website");
    if (await isWebsiteRoot(candidate)) return candidate;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return "";
}

async function websitePath(...parts) {
  return path.join(await getWebsiteRoot(), ...parts);
}

async function docsPath(...parts) {
  return path.join(await getWebsiteRoot(), "..", "docs", ...parts);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readLocalText(filePath));
  } catch (error) {
    if (isDatalessReadError(error)) {
      throw new HttpError(
        [
          "The selected website folder contains macOS placeholder files that cannot be read.",
          "Choose the fresh hydrated checkout, or right-click the repo folder in Finder and choose Download Now.",
        ].join(" "),
      );
    }

    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readLocalText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isDatalessReadError(error)) {
      throw new HttpError(
        [
          `${filePath} is present but not downloaded locally.`,
          "Choose a hydrated checkout or download the folder in Finder before using the admin app.",
        ].join(" "),
      );
    }

    throw error;
  }
}

function isDatalessReadError(error) {
  return error?.errno === -81 || String(error?.message || "").includes("Unknown system error -81");
}

async function readPhotos() {
  return readJson(await websitePath("src/data/photos.json"));
}

async function writePhotos(photos) {
  await writeJson(await websitePath("src/data/photos.json"), photos);
}

async function readPosts() {
  return readJson(await websitePath("src/data/posts.json"));
}

async function writePosts(posts) {
  await writeJson(await websitePath("src/data/posts.json"), posts);
}

async function readCategories() {
  return readJson(await websitePath("src/data/categories.json"));
}

async function savePhotoImage(imagePath, date) {
  const imageDir = await websitePath("public/images/photo/daily");
  await fs.mkdir(imageDir, { recursive: true });

  const id = await createFileId(imagePath, date);
  const filename = `${id}.jpg`;
  const destination = path.join(imageDir, filename);
  await fs.copyFile(imagePath, destination);

  return { id, filename, destination, src: `/images/photo/daily/${filename}` };
}

async function savePostImage(imagePath, slug) {
  const imageDir = await websitePath("public/images/posts");
  await fs.mkdir(imageDir, { recursive: true });

  const extension = normalizedImageExtension(imagePath);
  const filename = `${slug}-${crypto.randomBytes(3).toString("hex")}${extension}`;
  const destination = path.join(imageDir, filename);
  await fs.copyFile(imagePath, destination);

  return { filename, destination, src: `/images/posts/${filename}` };
}

async function mirrorToDocs(filename, source, kind) {
  const targetDir =
    kind === "photo"
      ? await docsPath("images/photo/daily")
      : await docsPath("images/posts");
  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(source, path.join(targetDir, filename));
}

async function removeManagedPhotoImage(src) {
  if (!src.startsWith("/images/photo/daily/")) return;
  const filename = path.basename(src);
  await Promise.all([
    fs.rm(await websitePath("public/images/photo/daily", filename), { force: true }),
    fs.rm(await docsPath("images/photo/daily", filename), { force: true }),
  ]);
}

async function createFileId(imagePath, date) {
  const base = path
    .basename(imagePath, path.extname(imagePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
  return `${date}-${base || "image"}-${crypto.randomBytes(3).toString("hex")}`;
}

function normalizedImageExtension(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) {
    return extension === ".jpeg" ? ".jpg" : extension;
  }
  return ".jpg";
}

function validatePhotoFields({ title, date }) {
  if (!title?.trim()) throw new HttpError("Caption is required.");
  if (!date?.match(/^\d{4}-\d{2}-\d{2}$/)) throw new HttpError("Date must use YYYY-MM-DD.");
}

function validatePostFields({ title, date, category }) {
  if (!title?.trim()) throw new HttpError("Post title is required.");
  if (!date?.match(/^\d{4}-\d{2}-\d{2}$/)) throw new HttpError("Date must use YYYY-MM-DD.");
  if (!category) throw new HttpError("Choose a post category.");
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "post"
  );
}

function uniqueSlug(base, posts) {
  const existing = new Set(posts.map((post) => post.slug));
  if (!existing.has(base)) return base;

  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

async function runWebsiteBuild() {
  const cwd = await getWebsiteRoot();
  await ensureWebsiteDependencies(cwd);

  return new Promise((resolve, reject) => {
    execFile("npm", ["run", "build"], { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            [
              "The update was saved locally, but the site build failed.",
              "Try clicking Publish to GitHub after the build dependency repair finishes, or run npm install from the repo root.",
              compactCommandOutput(stderr || stdout || error.message),
            ]
              .filter(Boolean)
              .join("\n\n"),
          ),
        );
        return;
      }
      resolve();
    });
  });
}

async function ensureWebsiteDependencies(cwd) {
  const esbuildPackage = process.arch === "arm64" ? "@esbuild/darwin-arm64" : "@esbuild/darwin-x64";

  try {
    await fs.access(path.join(cwd, "..", "node_modules", ...esbuildPackage.split("/")));
    return;
  } catch {
    // Missing native optional dependencies are repaired by npm install.
  }

  await new Promise((resolve, reject) => {
    execFile("npm", ["install", "--workspaces", "--include=dev"], { cwd: path.dirname(cwd) }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(compactCommandOutput(stderr || stdout || error.message)));
        return;
      }
      resolve();
    });
  });
}

function compactCommandOutput(value) {
  const lines = String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-12).join("\n");
}

async function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${stderr || stdout || error.message}`.trim()));
        return;
      }
      resolve(stdout || stderr || "");
    });
  });
}

class HttpError extends Error {}
