# Contribuindo com o Edji

Consulte o [README](README.md) para a visão geral e o [AGENTS.md](AGENTS.md) para as convenções, o estado atual e as decisões em aberto.

## Mudanças e testes

- Trabalhe em branches a partir da `main`; não faça commit direto nela. Se usar worktrees, crie-as em `.worktree/` na raiz do repositório.
- Escreva código, identificadores e nomes de arquivos em inglês. Textos da interface e documentação ficam em português.
- Inclua ou atualize um teste de regressão que cubra cada melhoria e execute as verificações relevantes.
- Registre decisões arquiteturais em `docs/decisions/` (um arquivo numerado por decisão: `NNNN-titulo-curto.md`, com contexto, alternativas, decisão e consequências) e atualize o `AGENTS.md` na mesma mudança.
- Comportamento que depende do aparelho (botão lateral, microfone, papel de assistente padrão) precisa de teste em celular real. Registre modelo, versão do sistema e fabricante na verificação.
- Não envie áudio, transcrições ou tarefas para fora do aparelho sem que isso seja opcional, explícito e documentado.

## Descrição dos pull requests

Comece pelo problema e pelo comportamento resultante. Descreva a mudança para uma pessoa que não acompanhou a conversa. Ajuste a extensão ao escopo, remova seções vazias e mantenha título e descrição coerentes com a implementação final.

Em **Verificação**, informe o que foi executado, em qual ambiente e com qual resultado. Diferencie testes automatizados, testes manuais (com aparelho e versão do sistema) e verificações pendentes. Inclua gravação de tela ou captura quando ajudar a revisão.

### Template

```markdown
## Problema e resultado

<!-- Descreva o problema e o comportamento final. Use um exemplo concreto quando ajudar. -->

## Alterações

<!-- Liste as mudanças que ajudam a revisar o PR e explique decisões relevantes. -->

## Verificação

<!-- Comandos, resultados e testes de regressão. Para testes manuais, registre aparelho, versão do sistema, passos e resultado observado. -->

## Limites e pendências

<!-- Restrições, compatibilidade por plataforma/fabricante ou verificações pendentes. Remova esta seção se não se aplicar. -->
```
