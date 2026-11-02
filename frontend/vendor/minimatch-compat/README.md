# Compatibilidade do lint com minimatch corrigido

O override instala somente `minimatch` 11.0.1. Este diretório contém código
original do projeto para adaptar as chamadas dos plugins legados; não é uma
cópia de `minimatch` 3 nem uma implementação própria de processamento de globs.

`scripts/patch-eslint-minimatch.mjs` roda no `postinstall` e redireciona as
importações de `minimatch` dos três plugins para `index.cjs`. Os caminhos são
relativos e funcionam em outros diretórios de checkout. O script pode ser
reexecutado e só aceita as versões revisadas dos plugins.

O adaptador oferece a função exportada pelo CommonJS, `Minimatch`, funções
auxiliares e opções padrão usadas pelos plugins. Todas as comparações são
delegadas à versão 11. A chamada `makeRe` usada por `import/no-internal-modules`
retorna um objeto com método `test`, que chama `Minimatch.match`; ela não gera
uma expressão regular. Este contrato atende ao plugin, mas não pretende
substituir toda a API pública de versões antigas de `minimatch`.

Ao atualizar um plugin, confira seus usos de `minimatch` antes de alterar a
versão aceita no script. Execute `npm ci`, `npm audit`, `npm run lint`,
`npm test`, `npx tsc --noEmit` e `npm run build`. Os testes em
`tests/lint-compat.test.mjs` verificam regras reais de React, acessibilidade e
imports, incluindo caminhos válidos e inválidos.

Quando os plugins exigirem uma versão corrigida e forem compatíveis com ela,
remova o `postinstall`, o script, este diretório, os testes específicos e o
override. Regenere o lockfile e repita as verificações.
