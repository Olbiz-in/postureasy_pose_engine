// Node ESM resolver hook: the engine sources use extensionless relative
// imports (resolved by Vite in the app). This lets `node --test` load them
// unchanged by retrying with `.js` / `/index.js`.

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!relative || err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    for (const suffix of ['.js', '/index.js']) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch { /* try next */ }
    }
    throw err;
  }
}
