# 0010: Skills do agente

- **Status:** aceita; nada verificado em aparelho
- **Data:** 2026-11-28
- **Relacionadas:** emenda a [0003](0003-arquitetura-de-plugins.md) e [0004](0004-agente-com-ai-sdk-e-openrouter.md); [0005](0005-rotinas.md), [0006](0006-chat-com-historico.md)

## Contexto

O agente só tinha instruções fixas e tools. Orientações longas (como montar uma rotina, como analisar gastos) ou preferências da pessoa ("trate por você, sem emoji") ou incham o prompt de todo turno ou não têm onde morar. O design foi aprovado como artefato ("Skills do Edji").

## Alternativas

- **Tudo no prompt fixo:** simples, mas cada turno paga o texto de todas as orientações, e a pessoa não edita nada.
- **Skills inteiras no catálogo:** mesmo custo do prompt fixo.
- **Só a pessoa edita, o agente só lê:** mais seguro, mas perde o "crie uma skill para isso" por voz ou chat.
- **Desfazer com versões:** descartado nesta etapa; a pessoa vê o cartão no chat e edita ou apaga pela tela.

## Decisão

- **Skill** = `id`, `name`, `when` (uma frase: o momento do pedido) e `instructions`. O id é `<origem>.<slug>`: `system.write_skill`, `<plugin>.<slug>`, `user.<slug>`. Os ids de plugin `skills`, `system` e `user` são reservados.
- **Três origens.** Sistema (`core/skills/system.ts`, hoje só "Escrever uma skill"), plugins (campo `Plugin.skills`, ligadas enquanto o plugin está ligado) e a pessoa ou o agente (tabela `user_skills` no `edji.db`, esquema `_skills`). Só as da pessoa se criam, alteram, desligam e apagam; as outras são só leitura, e a tela oferece "Criar cópia para editar".
- **Catálogo e carga sob demanda.** `agentInstructions` anexa às instruções do chat e da voz uma linha por skill ligada (id, nome, "quando usar"). O texto vem só quando o modelo chama `skills__load`. O catálogo vai ao modelo sob o mesmo opt-in da chave.
- **Tools do núcleo** `skills.load`, `create`, `update` e `delete`, sem `routineAction`: execuções de rotina (`ask_agent`) não as recebem nem veem o catálogo, para texto de notificação não escrever o que o agente lerá depois. `create`, `update` e `delete` recusam ids fora de `user.`.
- **Limites** contra custo e injeção por texto de anexo: nome 60, "quando usar" 200, instruções 4.000 caracteres, 50 skills da pessoa. Nome e "quando usar" viram uma linha só.
- **Chat.** Ler uma skill é uma linha discreta "Leu a skill X", sem abrir e sem o texto. Criar e alterar usam o cartão de tool tingido de verde com "Abrir skill" (`edji://skills/<id>`).
- **Voz.** O chip de skill (`pushTool` com `kind: 'skill'`) é verde-claro com um livro desenhado em `BookDrawable`, sem marca de estado.
- **Aba lateral.** Novo grupo "Agente" (abre e fecha): Skills primeiro, depois o **Uso**, que continua plugin mas declara `view.group: 'agent'`. Tela em `SkillsScreen`.

## Consequências

- Plugins ganham um jeito de entregar orientação ao agente sem inchar descrições de tools; mover a orientação de rotinas e finanças para skills fica para depois.
- O agente pode gravar uma skill a partir de texto malicioso num anexo. Mitigação: o cartão sempre aparece no chat, os limites de tamanho e a edição pela tela. Sem Desfazer, a correção é manual.
- Cada turno gasta algumas linhas de catálogo mesmo sem usar skill.
- **Não verificado em aparelho:** o grupo da aba, o chip com livro na sessão de voz, o agente criando e depois usando uma skill, e o `edji://skills/<id>` aberto de dentro do app. Testes JS e JVM passam e o Kotlin compila.
