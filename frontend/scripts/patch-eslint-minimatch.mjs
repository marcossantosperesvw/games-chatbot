import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const adapter = path.join(root, "vendor/minimatch-compat/index.cjs");
let configPath;
try {
  configPath = createRequire(import.meta.url).resolve("eslint-config-next");
} catch (error) {
  const omitDev = process.env.npm_config_omit?.split(/[,\s]+/).includes("dev")
    || process.env.NODE_ENV === "production";
  // Production-only installs do not include these development dependencies.
  if (error.code === "MODULE_NOT_FOUND" && omitDev) process.exit(0);
  throw error;
}
const requireFromNext = createRequire(configPath);
const supported = {
  "eslint-plugin-import": "2.32.0",
  "eslint-plugin-jsx-a11y": "6.10.2",
  "eslint-plugin-react": "7.37.5",
};

async function patchDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await patchDirectory(file);
    } else if (entry.name.endsWith(".js")) {
      const original = await readFile(file, "utf8");
      let relativeAdapter = path.relative(directory, adapter).split(path.sep).join("/");
      if (!relativeAdapter.startsWith(".")) relativeAdapter = `./${relativeAdapter}`;
      const patched = original.replace(
        /require\(['"]minimatch['"]\)/g,
        () => `require(${JSON.stringify(relativeAdapter)})`,
      );
      if (patched !== original) await writeFile(file, patched);
    }
  }
}

// These versions still use the callable v3 API. Fail on upgrades so a new
// plugin version cannot silently bypass compatibility validation.
for (const [name, version] of Object.entries(supported)) {
  const manifestPath = requireFromNext.resolve(`${name}/package.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== version) {
    throw new Error(`Revalidate the minimatch compatibility bridge for ${name}@${manifest.version}`);
  }
  await patchDirectory(path.join(path.dirname(manifestPath), "lib"));
}
