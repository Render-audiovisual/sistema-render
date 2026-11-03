// One import promise per attempt. Main must also recreate React.lazy(load) and
// remount its error boundary after an explicit, navigation-guarded retry.
// This does not evict the browser's module map or repair failed Vite CSS links.
export function createSectionModule(loader, name) {
  if (typeof loader !== 'function' || typeof name !== 'string' || !name) {
    throw new TypeError('A section loader and named export are required.');
  }
  let promise;
  let failed = false;
  return Object.freeze({
    load() {
      if (!promise) {
        promise = Promise.resolve().then(loader).then(module => {
          if (module?.[name] == null) throw new TypeError('Section export is unavailable.');
          return { default: module[name] };
        }).catch(error => {
          failed = true;
          throw error;
        });
      }
      return promise;
    },
    retry() {
      // Never duplicate an in-flight import or invalidate a healthy module.
      if (failed) {
        promise = undefined;
        failed = false;
      }
    },
  });
}
