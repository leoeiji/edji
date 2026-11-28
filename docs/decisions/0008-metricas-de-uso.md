# 0008: Métricas de uso do modelo e o plugin Uso

- **Status:** aceita; nada verificado em aparelho
- **Data:** 2026-11-28
- **Relacionadas:** [0004](0004-agente-com-ai-sdk-e-openrouter.md), [0006](0006-chat-com-historico.md) (o chat deixa de usar bolha na resposta), [0003](0003-arquitetura-de-plugins.md)

## Contexto

O agente manda o histórico e os tools a cada pedido, e não havia como ver quanto isso custa em tokens, dinheiro ou tempo. O AI SDK (`ai` 7) devolve, por passo, uso padronizado (`usage`, com cache e raciocínio), desempenho (`performance`: primeiro texto, tokens por segundo, intervalo entre partes, tempo de cada tool), motivo do fim, ids da resposta e `providerMetadata`. O OpenRouter acrescenta o provedor que atendeu e o custo (`providerMetadata.openrouter`). O conceito das telas foi publicado como artefato ("Edji · Métricas de uso").

## Alternativas

- **Guardar só os totais por mensagem:** menos linhas, mas perde o passo a passo das tools e não serve a análises novas sem migrar.
- **Guardar nas partes do chat (`chat_parts`):** deixaria de fora voz sem conversa, rotinas e títulos, e apagar a conversa apagaria o uso.
- **Plugin dono da tabela:** desligar o plugin pararia a contagem; o uso precisa ser contado pelo núcleo, que é quem chama o modelo.
- **Pedir o custo à API de gerações do OpenRouter depois:** uma chamada de rede a mais por resposta. Em vez disso, o modelo é criado com `usage: { include: true }` (contabilidade de uso do OpenRouter), que pede o custo e o provedor no último bloco da mesma resposta. Que eles chegam de fato pelo `expo/fetch` ainda precisa ser conferido em aparelho.

## Decisão

- **Uma linha por passo do modelo** em `usage_steps`, no `edji.db`, com migração própria sob o id `_usage`. Guarda tudo o que o SDK e o provedor dão: modelo pedido e o que respondeu, provedor do SDK e o provedor real (OpenRouter), id da geração, motivo do fim, tokens (entrada, sem cache, lidos e gravados no cache, saída, texto, raciocínio, total), custo e custo no provedor, tempos e velocidades, o intervalo entre partes (mín, p10, mediana, média, p90, máx), o tempo de cada tool, avisos, o `usage.raw` inteiro e o `providerMetadata` sem o texto de raciocínio. Nenhum texto da conversa.
- **Origem:** `chat`, `voice`, `routine` (`ask_agent`) ou `title` (modelo leve), com conversa, mensagem e sessão de voz quando houver. Sem chave estrangeira: apagar uma conversa preserva o uso.
- **Captura:** `runAgent` e `runLight` aceitam `onStep`, ligado a `onStepEnd` e `onStepError` do SDK (`stepCallbacks`). Um passo que falha guarda a nossa mensagem curta (`describeError`), nunca o texto do provedor. Erros ao medir ou gravar nunca quebram a resposta. `runPersistedTurn` grava cada passo na mesma fila das partes, ligado à mensagem da resposta; os outros caminhos usam `usageRecorder`.
- **Chat:** a resposta do agente deixa a bolha e ocupa a largura toda; só o usuário fica em bolha. Abaixo de cada resposta terminada, uma linha com entrada, saída e **tpm** (tokens de saída por minuto de streaming, `outputTokensPerSecond × 60`, somando os passos pelo tempo de cada um, sem contar tools nem a espera pelo primeiro token). Tocar abre todas as métricas da resposta. No topo, o total da sessão (todos os passos da conversa, título incluso), com a divisão entre entrada e saída e o custo. A sessão de voz em Kotlin mantém os balões e não mostra métricas.
- **Plugin `usage` ("Uso"):** só leitura do `usage_steps`, sem tabelas nem tools. Mostra um mês: total com comparação com os mesmos dias do mês anterior, custo, tokens por dia (entrada, entrada do cache, saída), parcela de entrada, origem, modelos e provedores, velocidade (medianas e p90/p10) e as conversas que mais gastaram. Os cálculos ficam em `insights.ts`, sem modelo, e as frases só descrevem.

## Consequências

- **Privacidade:** nada novo sai do aparelho; as métricas vêm da resposta que já chegava. O uso fica só no `edji.db`, sem texto de conversa nem de notificação.
- **Espaço:** uma linha por passo, algumas centenas de bytes cada (mais o `usage.raw`). Sem limpeza automática por enquanto; se crescer, agregar meses antigos.
- **Custo** vem em créditos do OpenRouter (US$). Com outro provedor, fica vazio e a tela mostra só tokens.
- **A validar no S26:** se o `expo/fetch` entrega o bloco final com `usage` e custo, se `timeToFirstOutputMs` bate com o "fim do STT → primeiro texto" da etapa 3, e a rolagem do chat com a linha de métricas.
