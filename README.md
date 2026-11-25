# Edji

O Edji é um assistente pessoal para celular que roda localmente, no aparelho, sempre que possível. A ideia central é segurar o botão lateral (de ligar/desligar), falar um comando e deixar o assistente cuidar do resto, sem abrir app, sem digitar e sem mandar sua voz para a nuvem.

> **Estado:** planejamento. Ainda não há código executável. O plano, as hipóteses e as decisões em aberto estão no [AGENTS.md](AGENTS.md).

## Primeira versão: lista de tarefas por voz

O MVP é um app Android com uma lista de tarefas:

1. Segure o botão lateral do celular.
2. Fale a tarefa, por exemplo "comprar pão".
3. O Edji transcreve a fala no aparelho e adiciona o item à lista.

A tela do app mostra a lista. As tarefas ficam guardadas no próprio celular. Listar, concluir ou editar por voz, e o suporte a iOS, ficam para depois.

## Princípios

- **Local primeiro.** Reconhecimento de voz, interpretação do comando e dados rodam no aparelho por padrão. Qualquer uso de nuvem é opcional e precisa ser ativado explicitamente.
- **Um gesto, um comando.** Ativar pelo botão lateral, falar e receber confirmação em poucos segundos.
- **Começar pequeno.** Uma funcionalidade útil e verificável antes de ampliar o escopo.

## Plataformas

| Plataforma | Ativação pelo botão lateral                                                                                     | Situação                  |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Android    | Pressionar e segurar o botão liga o assistente padrão, que o usuário escolhe (o Edji precisaria ocupar esse papel). | Hipótese a validar; alvo inicial |
| iOS        | O botão lateral é reservado à Siri. O equivalente mais próximo é o Action Button, que pode disparar um App Intent. | Em avaliação              |

A stack ainda não foi decidida. A proposta preferida é um núcleo em Rust compartilhado com camadas nativas finas (Kotlin no Android, Swift no iOS), detalhada em [AGENTS.md](AGENTS.md#stack).

## Como rodar

Ainda não há o que rodar. Esta seção será preenchida quando o primeiro protótipo existir.

## Contribuindo

Consulte o [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[Apache 2.0](LICENSE).
