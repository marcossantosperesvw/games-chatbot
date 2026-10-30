# Rascunhos da base de conhecimento

Arquivo de rascunhos documentais para revisão humana. Estes textos **não estão
indexados nem são consultados pelo chatbot**. O corpus ativo fica em
[`knowledge/`](../../knowledge/README.md).

## Objetivo e escopo

Responder dúvidas recorrentes sobre plataformas e ferramentas, sem precisar
escrever um guia para cada jogo. Cada arquivo trata de um assunto limitado;
isso facilita revisar, atualizar e recuperar trechos relevantes depois.

Este primeiro lote cobre Steam, Epic Games, PS5 e Windows. Não pretende cobrir
todos os consoles e sistemas. macOS, Linux, Xbox e guias específicos de jogos
podem entrar em lotes posteriores, com fontes e perguntas próprias.

## Documentos para revisar

| Arquivo | Assunto | Atenção principal |
| --- | --- | --- |
| [Steam: arquivos](steam-verificacao-arquivos.md) | Verificação de integridade | Validar nomes dos menus no cliente |
| [Steam Input e keybinds](steam-input-keybinds.md) | Configuração de controles | Fonte inclui interface antiga; não universalizar botões |
| [Steam: compatibilidade](steam-compatibilidade-sistemas.md) | Sistema operacional e requisitos | Não prometer desempenho ou compatibilidade por inferência |
| [Epic: arquivos](epic-verificacao-arquivos.md) | Verificação de integridade | Não reutilizar o caminho da Steam |
| [PS5: botões](ps5-remapeamento-controle.md) | Personalização do DualSense | Distinguir configuração do console e ações do jogo |
| [Windows: atalhos](windows-atalhos.md) | Atalhos do sistema | Não tratar como comandos universais de jogos |
| [Windows: especificações](windows-especificacoes.md) | Versão, RAM, processador e armazenamento | Não compartilhar identificadores pessoais |
| [PlayStation Store](playstation-store-compras.md) | Localizar e conferir conteúdo | Não inferir preço, edição ou disponibilidade atual |

## Como fazer sua revisão

1. Abra a fonte indicada no documento e confira se sustenta as afirmações.
2. Quando possível, reproduza o procedimento no aplicativo ou console. Registre
   data, idioma e versão realmente utilizados; não preencha por estimativa.
3. Faça ajustes pontuais no Markdown e mantenha as limitações explícitas.
4. Revise as condições de uso antes de aprovar a inclusão na base. São resumos
   autorais curtos, não cópias integrais; citar a fonte não comprova permissão.
5. Use as perguntas ao final de cada arquivo e o [roteiro de avaliação](avaliacao.md).

Data de consulta documental não significa validação prática. Todos os guias
permanecem pendentes da sua revisão, inclusive quando o conteúdo corresponde à fonte.

## Critério para aprovação documental

- Conteúdo sustentado por fonte identificada, sem completar lacunas por suposição.
- Plataforma, produto e limites claros; caminho de menu validado ou ressalvado.
- Procedimentos potencialmente destrutivos não adicionados como solução genérica.
- Perguntas respondíveis e não respondíveis identificadas.
- Condições de uso revisadas e eventuais pendências registradas.

Registre a aprovação e o resultado da validação prática no próprio documento.
Se não puder executar o procedimento, mantenha essa pendência explícita.

## Inclusão na base ativa

O contrato atual aceita documentos gerais com `scope: "general"`. Após a revisão,
crie os metadados JSON correspondentes, mova os pares Markdown/JSON aprovados para
`knowledge/`, reconstrua o índice e avalie as respostas. O [guia da base ativa](../../knowledge/README.md)
descreve o formato e os critérios. README, modelo e roteiro de avaliação não
devem fazer parte do corpus de respostas.

Nenhuma chamada paga, alteração de configuração ou indexação é necessária para
você revisar e editar estes rascunhos.
