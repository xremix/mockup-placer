const DATABASE = "mockup-placer-projects";
export const PROJECT_LIMIT = 5;

export function openProjects() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Mockup Placer tabs to enable project storage."));
  });
}

export function listProjects(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("projects", "readonly");
    const request = transaction.objectStore("projects").getAll();
    transaction.oncomplete = () => resolve(request.result
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(project => ({
        ...project,
        mockup: { ...project.mockup, blob: new Blob([project.mockup.blob], { type: project.mockup.type }) },
        screenshot: { ...project.screenshot, blob: new Blob([project.screenshot.blob], { type: project.screenshot.type }) },
        thumbnail: new Blob([project.thumbnail], { type: "image/jpeg" }),
      })));
    transaction.onabort = () => reject(transaction.error || new Error("Could not read recent projects."));
  });
}

export async function saveProject(database, project) {
  // ArrayBuffers also work in WebKit hosts that cannot persist Blob/File objects.
  const [mockup, screenshot, thumbnail] = await Promise.all([
    project.mockup.blob.arrayBuffer(),
    project.screenshot.blob.arrayBuffer(),
    project.thumbnail.arrayBuffer(),
  ]);
  const record = {
    ...project,
    mockup: { ...project.mockup, blob: mockup },
    screenshot: { ...project.screenshot, blob: screenshot },
    thumbnail,
  };
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("projects", "readwrite");
    const store = transaction.objectStore("projects");
    store.put(record);
    const request = store.getAll();
    request.onsuccess = () => {
      const recent = request.result.sort((a, b) => b.updatedAt - a.updatedAt);
      for (const old of recent.slice(PROJECT_LIMIT)) store.delete(old.id);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Could not save your project."));
  });
}
