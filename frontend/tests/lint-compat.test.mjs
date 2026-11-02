import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Linter } from "eslint";

const requireFromNext = createRequire(import.meta.resolve("eslint-config-next"));
const plugins = {
  react: requireFromNext("eslint-plugin-react"),
  import: requireFromNext("eslint-plugin-import"),
  "jsx-a11y": requireFromNext("eslint-plugin-jsx-a11y"),
};

function lint(code, rules) {
  return new Linter().verify(code, [{
    files: ["**/*.jsx"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins,
    rules,
  }], { filename: fileURLToPath(new URL("../fixture.jsx", import.meta.url)) });
}

test("React mantém restrições de props com padrões glob", () => {
  const rules = { "react/forbid-component-props": ["error", {
    forbid: [{ propNamePattern: "data-*", disallowedForPatterns: ["Private*"] }],
  }] };
  assert.deepEqual(lint('const x = <PublicCard data-id="1" />;', rules), []);
  assert.equal(lint('const x = <PrivateCard data-id="1" />;', rules)[0]?.ruleId,
    "react/forbid-component-props");
});

test("acessibilidade reconhece controles personalizados por padrão glob", () => {
  const rules = { "jsx-a11y/label-has-associated-control": ["error", {
    controlComponents: ["Input*"], assert: "nesting",
  }] };
  assert.deepEqual(lint('const x = <label>Nome<InputText /></label>;', rules), []);
  assert.equal(lint('const x = <label><InputText /></label>;', rules)[0]?.ruleId,
    "jsx-a11y/label-has-associated-control");
});

test("import mantém bloqueio de módulos internos usando o matcher seguro", () => {
  const rules = { "import/no-internal-modules": ["error", { forbid: ["**/private/**"] }] };
  assert.deepEqual(lint('import x from "./public/util.js";', rules), []);
  assert.equal(lint('import x from "./private/util.js";', rules)[0]?.ruleId,
    "import/no-internal-modules");
});

test("import mantém restrições de caminhos com a classe Minimatch", () => {
  const rules = { "import/no-restricted-paths": ["error", {
    zones: [{ target: "./**", from: "./src/**" }],
  }] };
  assert.deepEqual(lint('import x from "./eslint.config.mjs";', rules), []);
  assert.equal(lint('import x from "./src/lib/chat.ts";', rules)[0]?.ruleId,
    "import/no-restricted-paths");
});

test("o patch de instalação pode ser executado novamente sem quebrar as regras", () => {
  execFileSync(process.execPath, ["scripts/patch-eslint-minimatch.mjs"], {
    cwd: new URL("../", import.meta.url),
  });
  assert.deepEqual(lint('const x = <div />;', { "react/jsx-pascal-case": "error" }), []);
});
