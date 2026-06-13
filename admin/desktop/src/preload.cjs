const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("siteAdmin", {
  ready: true,
  getSettings: () => ipcRenderer.invoke("settings:get"),
  chooseWebsiteRoot: () => ipcRenderer.invoke("settings:chooseWebsiteRoot"),
  chooseImages: (options) => ipcRenderer.invoke("images:choose", options),
  listPhotos: () => ipcRenderer.invoke("photos:list"),
  createPhoto: (payload) => ipcRenderer.invoke("photos:create", payload),
  updatePhoto: (payload) => ipcRenderer.invoke("photos:update", payload),
  deletePhoto: (payload) => ipcRenderer.invoke("photos:delete", payload),
  listPosts: () => ipcRenderer.invoke("posts:list"),
  listCategories: () => ipcRenderer.invoke("categories:list"),
  createPost: (payload) => ipcRenderer.invoke("posts:create", payload),
  publishSite: () => ipcRenderer.invoke("site:publish"),
});
