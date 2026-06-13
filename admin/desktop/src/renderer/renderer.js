const state = {
  photoImagePath: "",
  replacementImagePath: "",
  postImagePaths: [],
  photos: [],
  posts: [],
};

const adminApi = window.siteAdmin;
const desktopOnlyMessage =
  "Open the packaged desktop app to manage the website. The browser preview cannot read or write local website files.";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

$("#photo-date").valueAsDate = new Date();
$("#post-date").valueAsDate = new Date();

$$(".module-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".module-tab").forEach((item) => item.classList.toggle("active", item === tab));
    $$(".module-view").forEach((view) => view.classList.toggle("active", view.id === tab.dataset.moduleTarget));
  });
});

$("#choose-root").addEventListener("click", async () => {
  if (!ensureDesktopApp()) return;
  try {
    await adminApi.chooseWebsiteRoot();
    await loadAll();
  } catch (error) {
    setRootStatus(error.message, false);
  }
});

$("#publish-site").addEventListener("click", async () => {
  if (!ensureDesktopApp()) return;
  setPublishStatus("Publishing local website changes to GitHub...", true);

  try {
    const result = await adminApi.publishSite();
    setPublishStatus(result.published ? `Published ${result.commit} to GitHub.` : result.message, true);
  } catch (error) {
    setPublishStatus(error.message, false);
  }
});

$("#photo-image-button").addEventListener("click", async () => {
  if (!ensureDesktopApp()) return;
  setStatus("#photo-status", "Opening image picker...");

  try {
    const [imagePath] = await adminApi.chooseImages({
      title: "Choose photo of the day JPG",
      photoOnly: true,
    });
    if (!imagePath) {
      setStatus("#photo-status", "");
      return;
    }
    state.photoImagePath = imagePath;
    $("#photo-image-label").textContent = imagePath;
    setStatus("#photo-status", "Image selected.");
  } catch (error) {
    setStatus("#photo-status", error.message);
  }
});

$("#post-images-button").addEventListener("click", async () => {
  if (!ensureDesktopApp()) return;
  setStatus("#post-status", "Opening image picker...");

  try {
    const imagePaths = await adminApi.chooseImages({
      title: "Choose post images",
      multiple: true,
    });
    state.postImagePaths = imagePaths;
    $("#post-image-label").textContent = imagePaths.length
      ? `${imagePaths.length} image${imagePaths.length === 1 ? "" : "s"} selected`
      : "No images selected";
    setStatus("#post-status", imagePaths.length ? "Images selected." : "");
  } catch (error) {
    setStatus("#post-status", error.message);
  }
});

$("#photo-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ensureDesktopApp()) return;
  setStatus("#photo-status", "Updating...");

  try {
    const payload = {
      title: $("#photo-title").value,
      date: $("#photo-date").value,
      imagePath: state.photoImagePath,
      build: $("#photo-build").checked,
    };
    const result = await adminApi.createPhoto(payload);
    state.photoImagePath = "";
    $("#photo-form").reset();
    $("#photo-date").valueAsDate = new Date();
    $("#photo-image-label").textContent = "No image selected";
    setStatus("#photo-status", `Saved "${result.photo.title}" locally. Click Publish to GitHub to update the live site.`);
    renderPhotos(result.photos);
  } catch (error) {
    setStatus("#photo-status", error.message);
  }
});

$("#post-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ensureDesktopApp()) return;
  setStatus("#post-status", "Publishing...");

  try {
    const payload = {
      title: $("#post-title").value,
      date: $("#post-date").value,
      category: $("#post-category").value,
      summary: $("#post-summary").value,
      tags: $("#post-tags").value,
      plainText: $("#post-text").value,
      iframe: $("#post-iframe").value,
      imagePaths: state.postImagePaths,
      build: $("#post-build").checked,
    };
    const result = await adminApi.createPost(payload);
    state.postImagePaths = [];
    $("#post-form").reset();
    $("#post-date").valueAsDate = new Date();
    $("#post-image-label").textContent = "No images selected";
    setStatus("#post-status", `Saved "${result.post.title}" locally. Click Publish to GitHub to update the live site.`);
    renderPosts(result.posts);
  } catch (error) {
    setStatus("#post-status", error.message);
  }
});

$("#photo-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const photo = state.photos.find((item) => item.id === button.dataset.id);
  if (!photo) return;

  if (button.dataset.action === "preview") {
    previewPhoto(photo);
  }

  if (button.dataset.action === "edit") {
    renderPhotoEdit(photo);
  }

  if (button.dataset.action === "cancel") {
    renderPhotos(state.photos);
  }

  if (button.dataset.action === "replace") {
    if (!ensureDesktopApp()) return;
    setStatus("#photo-status", "Opening replacement image picker...");

    try {
      const [imagePath] = await adminApi.chooseImages({
        title: "Choose replacement JPG",
        photoOnly: true,
      });
      if (!imagePath) {
        setStatus("#photo-status", "");
        return;
      }
      state.replacementImagePath = imagePath;
      const item = button.closest(".photo-item");
      item.querySelector(".replace-label").textContent = imagePath;
      setStatus("#photo-status", "Replacement image selected.");
    } catch (error) {
      setStatus("#photo-status", error.message);
    }
  }

  if (button.dataset.action === "save") {
    await savePhotoEdit(photo.id, button.closest(".photo-item"));
  }

  if (button.dataset.action === "delete") {
    await deletePhoto(photo);
  }
});

$("#preview-close").addEventListener("click", () => $("#preview-dialog").close());
$("#preview-dialog").addEventListener("click", (event) => {
  if (event.target === $("#preview-dialog")) $("#preview-dialog").close();
});

async function loadAll() {
  if (!ensureDesktopApp()) return;

  setRootStatus("Desktop bridge connected. Locating website folder...", true);

  const settings = await adminApi.getSettings();
  setRootStatus(settings.valid ? settings.websiteRoot : `${settings.websiteRoot} is not valid`, settings.valid);

  const [photos, posts, categories] = await Promise.all([
    adminApi.listPhotos(),
    adminApi.listPosts(),
    adminApi.listCategories(),
  ]);

  renderPhotos(photos);
  renderPosts(posts);
  renderCategories(categories);
}

function renderCategories(categories) {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = categories.length ? "Choose a tag" : "No tags found";
  placeholder.disabled = true;
  placeholder.selected = true;

  $("#post-category").replaceChildren(
    placeholder,
    ...categories.map((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.label;
      return option;
    }),
  );

  if (!categories.length) {
    setStatus("#post-status", "No tags found. Check that the app is using the repo's website folder.");
  }
}

function renderPhotos(photos) {
  state.photos = photos;
  $("#photo-list").replaceChildren(
    ...[...photos]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((photo) => {
        const item = document.createElement("article");
        item.className = "photo-item";
        item.dataset.photoId = photo.id;
        item.innerHTML = `
          <img src="${toFileUrl(photo.src)}" alt="" />
          <div>
            <h2>${escapeHtml(photo.title)}</h2>
            <p>${photo.date}</p>
            <code>${photo.src}</code>
            <div class="row-actions">
              <button type="button" class="secondary" data-action="preview" data-id="${photo.id}">Preview</button>
              <button type="button" data-action="edit" data-id="${photo.id}">Edit</button>
              <button type="button" class="danger" data-action="delete" data-id="${photo.id}">Delete</button>
            </div>
          </div>
        `;
        return item;
      }),
  );
}

function renderPhotoEdit(photo) {
  const item = $$(".photo-item").find((entry) => entry.dataset.photoId === photo.id);
  if (!item) return;
  state.replacementImagePath = "";

  item.innerHTML = `
    <img src="${toFileUrl(photo.src)}" alt="" />
    <form class="edit-form">
      <label>
        <span>Caption</span>
        <input name="title" type="text" value="${escapeAttribute(photo.title)}" required />
      </label>
      <label>
        <span>Date</span>
        <input name="date" type="date" value="${photo.date}" required />
      </label>
      <button type="button" class="secondary" data-action="replace" data-id="${photo.id}">Replace JPG</button>
      <p class="replace-label">Leave empty to keep the current image.</p>
      <label class="checkbox">
        <input name="build" type="checkbox" checked />
        <span>Run site build</span>
      </label>
      <div class="row-actions">
        <button type="button" data-action="save" data-id="${photo.id}">Save</button>
        <button type="button" class="secondary" data-action="cancel" data-id="${photo.id}">Cancel</button>
      </div>
    </form>
  `;
}

async function savePhotoEdit(id, item) {
  const form = item.querySelector(".edit-form");
  setStatus("#photo-status", "Saving edit...");

  try {
    const result = await adminApi.updatePhoto({
      id,
      title: form.elements.title.value,
      date: form.elements.date.value,
      imagePath: state.replacementImagePath,
      build: form.elements.build.checked,
    });
    state.replacementImagePath = "";
    setStatus("#photo-status", `Updated "${result.photo.title}".`);
    renderPhotos(result.photos);
  } catch (error) {
    setStatus("#photo-status", error.message);
  }
}

async function deletePhoto(photo) {
  if (!window.confirm(`Delete "${photo.title}" from the manifest and remove its image file?`)) return;
  setStatus("#photo-status", "Deleting...");

  try {
    const result = await adminApi.deletePhoto({
      id: photo.id,
      build: $("#photo-build").checked,
    });
    setStatus("#photo-status", `Deleted "${result.photo.title}".`);
    renderPhotos(result.photos);
  } catch (error) {
    setStatus("#photo-status", error.message);
  }
}

function renderPosts(posts) {
  state.posts = posts;
  $("#post-list").replaceChildren(
    ...[...posts]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 12)
      .map((post) => {
        const item = document.createElement("article");
        item.className = "post-item";
        item.innerHTML = `
          <span>${escapeHtml(post.category)}</span>
          <h2>${escapeHtml(post.title)}</h2>
          <p>${post.date}</p>
          <code>#/post/${escapeHtml(post.slug)}</code>
        `;
        return item;
      }),
  );
}

function previewPhoto(photo) {
  $("#preview-image").src = toFileUrl(photo.src);
  $("#preview-image").alt = photo.title;
  $("#preview-title").textContent = photo.title;
  $("#preview-date").textContent = photo.date;
  $("#preview-dialog").showModal();
}

function toFileUrl(src) {
  if (!src.startsWith("/images/")) return src;
  const rootText = $("#root-status").dataset.websiteRoot;
  if (!rootText) return src;
  const filePath = `${rootText}/public${src}`;
  return `file://${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

function setRootStatus(message, valid) {
  $("#root-status").textContent = valid ? `Website folder: ${message}` : message;
  $("#root-status").dataset.websiteRoot = valid ? message : "";
  $("#root-status").classList.toggle("invalid", !valid);
}

function setStatus(selector, message) {
  $(selector).textContent = message;
}

function setPublishStatus(message, valid) {
  $("#publish-status").textContent = message;
  $("#publish-status").classList.add("visible");
  $("#publish-status").classList.toggle("invalid", !valid);
}

function ensureDesktopApp() {
  if (adminApi) return true;
  setRootStatus(desktopOnlyMessage, false);
  setStatus("#photo-status", desktopOnlyMessage);
  setStatus("#post-status", desktopOnlyMessage);
  return false;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

loadAll().catch((error) => setRootStatus(error.message, false));
