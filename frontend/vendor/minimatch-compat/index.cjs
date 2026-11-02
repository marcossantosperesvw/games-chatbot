// The legacy plugins load this adapter synchronously through CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const modern = require("minimatch");

// Only the legacy ESLint plugins use this bridge. All matching is performed by
// patched minimatch; no code from minimatch 3 is retained.
function withDefaults(defaultOptions = {}) {
  const optionsFor = (options) => ({ ...defaultOptions, ...options });
  const match = (path, pattern, options) =>
    modern.minimatch(path, pattern, optionsFor(options));

  return Object.assign(match, modern.minimatch.defaults(defaultOptions), {
    // eslint-plugin-import only calls .test() on makeRe's return value.
    // Version 11 removed regex generation; keep its safer matching engine.
    makeRe(pattern, options) {
      const matcher = new modern.Minimatch(pattern, optionsFor(options));
      return { test: (path) => matcher.match(path) };
    },
    defaults: (options) => withDefaults(optionsFor(options)),
  });
}

module.exports = withDefaults();
