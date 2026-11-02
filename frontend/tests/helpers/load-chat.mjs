import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Match the app's TypeScript aliases and JSX compilation in the Node test runner.
const sourceRoot = new URL("../../src/", import.meta.url);
export async function loadChat() {
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let target;
      if (specifier.startsWith("@/")) target = new URL(specifier.slice(2), sourceRoot);
      else if (specifier.startsWith(".") && context.parentURL?.startsWith(sourceRoot.href)) {
        target = new URL(specifier, context.parentURL);
      }
      if (target) {
        for (const suffix of ["", ".ts", ".tsx"]) {
          const url = new URL(target.href + suffix);
          if (existsSync(fileURLToPath(url))) return next(url.href, context);
        }
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith(sourceRoot.href) && url.endsWith(".tsx")) {
        return { format: "module", shortCircuit: true, source: ts.transpileModule(
          readFileSync(new URL(url), "utf8"),
          { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } },
        ).outputText };
      }
      return next(url, context);
    },
  });
  try {
    return await import("../../src/components/chat/chat.tsx");
  } finally {
    hooks.deregister();
  }
}
