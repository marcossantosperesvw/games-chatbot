# Interface do Chat Jogos

Interface web do Chat Jogos, construída com Next.js, React, TypeScript e
Tailwind CSS. Usa a API FastAPI para conversar com o agente; as credenciais ficam
no backend. Consulte o [README principal](../README.md) para configurar o projeto completo.

## Tutoriais em vídeo

O chat permite habilitar buscas no YouTube, com autorização explícita ao lado do
formulário. Um vídeo selecionado aparece com título, canal e player carregado por
clique, sem autoplay, além de link externo. O anexo acompanha a conversa da sessão,
mas não é reenviado no histórico da IA. A autorização começa desligada a cada
recarregamento; nenhum segredo Google fica no frontend.

Veja a [configuração e os testes](../docs/youtube-tutorials.md). A política da
aplicação está na rota `/privacidade`. Falhas de pesquisa não impedem o texto.

## Executar localmente

Use Node.js 24 e prepare o [backend](../backend/README.md). A partir da raiz do
repositório, entre na pasta `frontend/`, instale as dependências e crie a
configuração local, se ainda não existir:

```bash
cd frontend
npm ci --loglevel=error
cp -n .env.example .env.local
```

Se o terminal já estiver em `frontend/`, pule o comando `cd frontend`.
O parâmetro `--loglevel=error` oculta os avisos do npm durante a instalação,
mantendo os erros visíveis. Isso evita os avisos conhecidos de `peerDependencies`
dos plugins de lint que ainda declaram suporte somente até ESLint 9, embora o
[Next.js 16.4 suporte ESLint 10](https://nextjs.org/docs/app/api-reference/config/eslint#setup-eslint).
O parâmetro não altera a resolução das dependências nem corrige esses avisos;
para examiná-los, execute `npm ci` sem ele. Aguarde a instalação terminar com
sucesso antes de iniciar o frontend.

Defina a URL da API em `.env.local`, se necessário:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Em um terminal, execute o backend a partir da pasta `backend/`:

```bash
uv run --locked uvicorn app.main:app --reload
```

Em outro terminal, na pasta `frontend/`:

```bash
npm run dev
```

Abra <http://localhost:3000>. O backend deve permitir essa origem em
`CORS_ORIGINS`. `localhost:3000` e `127.0.0.1:3000` são permitidos pela
configuração padrão de desenvolvimento.

`NEXT_PUBLIC_API_URL` é uma URL pública incorporada durante o build. Ela não
deve conter credenciais. Chaves da OpenAI pertencem exclusivamente ao backend.

## Funcionalidades

- Várias conversas salvas na sessão da aba, com mensagens e rascunhos separados.
- Menu lateral com títulos automáticos, seleção ativa e conversas mais recentes primeiro.
- Envio pelo botão ou por Enter; Shift+Enter insere uma quebra de linha.
- Sugestões iniciais que preenchem o campo sem enviar automaticamente.
- Apresentação inicial com exemplos para descobrir jogos, instalar inicializadores,
  entender serviços de plataforma e conectar controles. Os exemplos não ativam
  buscas de vídeos: a autorização do YouTube continua separada e desligada por padrão.
- Indicação de carregamento por conversa e envios simultâneos em conversas diferentes.
- Erros em português, preservando o rascunho e as mensagens anteriores.
- Nova conversa sem apagar as anteriores; recuperação pelo menu lateral.
- Navegação entre conversas enquanto uma resposta está sendo preparada.
- Menu recolhível em telas pequenas, acessível pelo botão "Conversas".
- Layout responsivo, rótulos acessíveis, foco visível e movimento reduzido.

O backend usa o OpenAI Agents SDK e considera o histórico da conversa selecionada.
Configure chave e modelo conforme o [guia do backend](../backend/README.md).
As conversas são recuperadas ao atualizar
a página; fechar a aba normalmente encerra a sessão de armazenamento.

## Persistência da sessão

O `sessionStorage` guarda o histórico na chave `chat-jogos:session:v1`, por origem
e por aba. Use o mesmo endereço ao voltar: `localhost` e `127.0.0.1` são origens
diferentes. Não há sincronização entre dispositivos nem compartilhamento ao vivo
entre abas. Alguns navegadores podem copiar ou restaurar uma sessão ao duplicar
ou reabrir uma aba; este recurso não é uma garantia de histórico permanente.

O documento salvo tem versão, lista de conversas e identificador da selecionada.
Cada conversa tem UUID, título, mensagens, rascunho e datas de criação/atualização.
O título é derivado da primeira mensagem enviada, com até 60 caracteres Unicode.
As alterações são salvas após as atualizações do estado, inclusive rascunhos.

Os dados são carregados somente após a montagem no navegador. Até a recuperação
terminar, o formulário permanece bloqueado. Isso evita sobrescrever o histórico
com um estado inicial vazio e mantém a renderização inicial consistente no Next.js.

O conteúdo recuperado é validado: versão, identificadores, papéis de mensagens,
datas e conversa ativa. Dados inválidos ou de versão desconhecida são preservados
na chave original; a interface avisa e continua somente em memória. Quando o
armazenamento está bloqueado ou sem espaço, um aviso informa que alterações
podem ser perdidas ao recarregar. Nenhuma outra chave do navegador é removida.

Este armazenamento é local ao navegador, sem conta ou banco no backend. As
mensagens são enviadas à API ao solicitar uma resposta, como nas etapas anteriores.

## Organização

| Local | Responsabilidade |
| --- | --- |
| `src/app/page.tsx` | Compor a página com o componente de chat |
| `src/components/chat/` | Apresentar mensagens, formulário e estados da interface |
| `src/hooks/use-chat.ts` | Coordenar sessão, chamadas HTTP e persistência no navegador |
| `src/lib/api.ts` | Fazer chamadas HTTP e validar respostas em tempo de execução |
| `src/lib/chat.ts` | Preparar requisições e verificar limites do contrato |
| `src/lib/conversations.ts` | Atualizar conversas por identificador e tratar respostas sem misturar históricos |
| `src/lib/conversation-storage.ts` | Validar, recuperar e salvar o documento da sessão |
| `src/types/chat.ts` | Definir tipos TypeScript correspondentes ao contrato HTTP |
| `tests/` | Testar preparação do histórico e comunicação HTTP com respostas simuladas |

O identificador UUID é criado junto com cada conversa e mantido após recarregar
a página. Cada requisição inclui somente as mensagens anteriores da conversa em
`history`; a mensagem atual aparece uma única vez em `message`. IDs locais da
interface não são enviados dentro das mensagens.

Conversas diferentes podem executar envios simultaneamente. Cada conversa permite
apenas um envio em andamento para preservar a ordem do contexto. É possível
criar e selecionar conversas durante a espera. Respostas e erros são associados à conversa que originou o envio;
chegadas tardias não alteram a seleção ou os rascunhos de outras conversas.

A mensagem do usuário aparece enquanto aguarda, mas só entra no histórico
persistido junto com uma resposta bem-sucedida. O rascunho original permanece
salvo até esse momento. Uma recarga durante o envio recupera o rascunho e as
mensagens concluídas, sem restaurar um carregamento infinito nem reenviar a
requisição. Erros transitórios também não são restaurados após a recarga.

Em caso de falha, o texto original volta ao campo de edição da conversa de
origem. Não há reenvio automático. As chamadas têm tempo limite de 30 segundos
e são canceladas quando o componente é desmontado.

## Limites atuais

- Até 4.000 caracteres por mensagem, após remover espaços nas extremidades.
  A contagem considera pontos de código Unicode, como o backend, inclusive
  para emojis.
- Até 50 mensagens anteriores por requisição. Ao ultrapassar esse limite, a
  interface solicita uma nova conversa; não descarta o histórico silenciosamente.
- O backend agora rejeita saídas da IA acima de 4.000 caracteres. Conversas antigas
  da etapa simulada podem conter respostas maiores; a interface preserva esses
  dados e orienta iniciar uma nova conversa, sem apagar conteúdo silenciosamente.

Mensagens são exibidas como texto. Conteúdo HTML recebido da API não é executado.

## Verificações automatizadas

Com Node.js 24, usado nesta implementação:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Os testes usam o executor nativo do Node.js com suporte a TypeScript, em um
único processo. Os testes de interface usam jsdom para montar os componentes
React, com compilação de JSX pelo TypeScript. As chamadas HTTP são
substituídas nos testes: não exigem backend em execução, rede ou credenciais.
A suíte também verifica a recuperação da sessão, falhas de armazenamento,
rascunhos e chegada de respostas/erros após trocar a conversa selecionada.
Os testes de interface também cobrem a inicialização sem `crypto.randomUUID`,
armazenamento bloqueado ou inválido e dois envios simultâneos com respostas
fora de ordem. Os identificadores usam `crypto.getRandomValues` quando
`randomUUID` não está disponível, como no acesso por IP em HTTP na rede local.

## Auditoria de dependências

Na pasta `frontend/`, consulte separadamente as dependências de produção e o
conjunto completo, incluindo as ferramentas de desenvolvimento:

```bash
npm audit --omit=dev
npm audit
```

A atualização de segurança usa Next.js e `eslint-config-next` 16.4.3 e Zod
4.6.7 no lockfile. O override de `minimatch` para 11.0.1 remove as versões
afetadas pelo [aviso de segurança](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Na verificação desta atualização, tanto a auditoria completa quanto a de
produção retornaram zero vulnerabilidades.

Os plugins `eslint-plugin-import`, `eslint-plugin-jsx-a11y` e
`eslint-plugin-react` ainda usam chamadas da API antiga de `minimatch`.
O script `postinstall` aplica um adaptador local a essas chamadas, delegando o
processamento de padrões exclusivamente à versão corrigida. As regras de lint
continuam habilitadas e possuem testes de regressão para essa integração.
Consulte os [detalhes de manutenção](vendor/minimatch-compat/README.md).

Use `npm ci` com os scripts de instalação habilitados. Caso tenha instalado com
`--ignore-scripts`, execute `npm run postinstall` antes do lint e dos testes.
O adaptador valida as versões dos três plugins e interrompe a instalação se
elas mudarem: nesse caso, revise a integração antes de aceitar a atualização.
Remova o script, o adaptador e o override quando os plugins suportarem
nativamente uma versão corrigida. Evite `npm audit fix --force`, que pode
substituir a configuração atual por versões incompatíveis.

`--loglevel=error` controla apenas os logs de instalação; não corrige
vulnerabilidades nem oculta o resumo da auditoria. Os resultados podem mudar
conforme novos avisos são publicados.

## Roteiro de verificação manual

1. Abra a interface com o backend em execução e envie uma mensagem pelo botão.
   Confira o balão do usuário e a resposta da IA (este teste usa sua API e pode ter custo).
2. Envie outra mensagem usando Enter. Na aba Network do navegador, verifique
   o mesmo `conversation_id`, o histórico anterior e a mensagem atual separada.
3. Use Shift+Enter e confira uma quebra de linha. Tente enviar somente espaços:
   o botão deve permanecer desabilitado.
4. Envie mais de 4.000 caracteres: o contador indica o excesso e impede o envio.
5. Crie uma nova conversa. Confira que a anterior continua no menu e que seus
   títulos passam a refletir a primeira mensagem enviada.
6. Escreva rascunhos diferentes em duas conversas. Alterne entre elas e confira
   que mensagens e rascunhos permanecem separados.
7. Atualize a página: a lista, a conversa selecionada e os rascunhos devem voltar.
8. Atrase uma resposta pelas ferramentas de rede do navegador. Crie ou selecione
   outra conversa e envie nela antes da primeira terminar. Confira os indicadores
   de espera em ambas e que cada resposta chega apenas à conversa de origem,
   mesmo fora de ordem. Na mesma conversa, um segundo envio fica bloqueado.
9. Recarregue durante um envio: a mensagem deve voltar como rascunho, sem ser
   enviada automaticamente e sem deixar uma indicação permanente de carregamento.
10. Pare o backend e envie uma mensagem: o erro deve aparecer, com o rascunho
   preservado e sem duplicar mensagens. Reinicie o backend e tente novamente.
11. Confira o uso por teclado e a apresentação em uma largura de 390 pixels;
    o botão "Conversas" deve abrir o menu e a seleção deve recolhê-lo.

## Evolução

Persistência entre sessões, contas de usuário e implantação pública dependem de
decisões sobre autenticação, privacidade, custos e operação. O catálogo IGDB e o
RAG local já estão integrados ao backend; o RAG precisa de um índice construído e
habilitado para participar das respostas.
