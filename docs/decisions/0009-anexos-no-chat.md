# 0009: Anexos no chat

- **Status:** aceita; nada verificado em aparelho (versão `0.4.0-rc.1`)
- **Data:** 2026-11-28
- **Relacionadas:** [0004](0004-agente-com-ai-sdk-e-openrouter.md) (privacidade: o que sai do aparelho), [0006](0006-chat-com-historico.md) (conversas guardadas; emenda ao `chat_parts`), [0008](0008-metricas-de-uso.md) (tokens de imagem entram na entrada)

## Contexto

O chat de texto só aceitava texto. Pedir "lança os gastos desse cupom" ou "o que diz essa fatura" exige mandar imagem ou arquivo ao modelo. O AI SDK aceita partes `file` (imagem, PDF) na mensagem do usuário, e o OpenRouter repassa. O conceito das telas foi publicado como artefato ("Edji: anexos no chat"). Fora do escopo: anexos na sessão de voz e acesso do agente ao sistema de arquivos.

## Alternativas

- **Guardar os bytes no SQLite:** infla o `edji.db` e o torna lento para a lista de conversas; arquivo no disco com ponteiro no banco é mais simples.
- **Guardar em cache (`cacheDirectory`):** o sistema pode limpar, e a conversa perderia a imagem. Fica em `documentDirectory/attachments/`.
- **Mandar a imagem original:** fotos de câmera têm vários MB, e o custo de entrada cresce com a resolução. Reduzimos ao copiar.
- **Reenviar todos os anexos a cada turno:** uma foto de 1600 px custa alguns milhares de tokens por turno, para sempre. Só o anexo da mensagem sendo enviada vai inteiro.
- **Ler PDF no aparelho:** exigiria uma biblioteca nativa. O OpenRouter lê PDF para qualquer modelo (por parser próprio quando o modelo não o lê direto), então o PDF vai como `file`.
- **Bloquear sempre que o modelo for desconhecido:** a lista pública do OpenRouter pode falhar ou não trazer o modelo; bloquear tiraria o recurso de quem usa modelo novo. Desconhecido deixa passar e o provedor decide.

## Decisão

- **Tipos aceitos:** imagem (qualquer `image/*`), PDF e texto (TXT, CSV, JSON, MD). Até **4 anexos** por mensagem e **10 MB** por arquivo; texto até **200 KB**, porque entra no prompt como texto. Os limites vivem em `agent/attachments.ts`.
- **Origem:** botão **+** do composer abre uma folha com Tirar foto (`expo-image-picker`, câmera), Galeria (seletor de fotos do sistema, sem permissão) e Arquivo (`expo-document-picker`).
- **Armazenamento:** ao escolher, o arquivo é copiado para `documentDirectory/attachments/`. Imagens são reduzidas (lado maior 1600 px, JPEG 80%, `expo-image-manipulator`) antes de guardar. Tirar o anexo do composer apaga a cópia; apagar a conversa (ou todas) apaga os arquivos dela. Usa `expo-file-system/legacy` (API estável de cópia, leitura em base64 e exclusão).
- **Banco:** migração 2 do `_chat` acrescenta colunas `att_*` em `chat_parts`; um anexo é uma parte `attachment` da mensagem do usuário, antes do texto, na ordem escolhida. Mensagem só com anexos é válida (o título usa o nome do primeiro).
- **O que vai ao modelo:** na mensagem sendo enviada, imagem e PDF vão inteiros (parte `file` com `mediaType`; o SDK marca a parte `image` como obsoleta) e texto vai como `[Arquivo: nome]` + conteúdo. Nos turnos anteriores, imagem e PDF viram `[Anexo enviado antes: nome]`; texto continua inteiro. Um arquivo que sumiu vira essa nota, sem derrubar o turno. Consequência: o agente não "revê" uma foto de turnos atrás; para isso, o usuário anexa de novo.
- **Imagem exige visão:** ao haver imagem no composer, o app consulta a lista pública de modelos do OpenRouter (`/api/v1/models`, sem chave e sem dado do usuário; uma vez por execução) e, se o modelo escolhido declara não ler imagem, bloqueia o envio com aviso e botão para as Configurações. Se a lista falhar ou não trouxer o modelo, deixa passar.
- **Privacidade (emenda à 0004):** com anexo, **o conteúdo do arquivo vai ao OpenRouter** junto com a mensagem, não só o texto digitado. O composer avisa isso enquanto houver anexo. Os arquivos ficam só no aparelho. O áudio continua nunca saindo. O modelo leve (títulos) não recebe anexos nem o texto deles: só o texto digitado e a resposta, como antes.
- **Injeção por conteúdo:** o texto de um PDF ou arquivo é dado, não pedido, mas o agente tem tools que gravam (`finance.add`). O `CHAT_INSTRUCTIONS` diz ao modelo que o conteúdo dos anexos é para ler, nunca instrução. Isso reduz, não elimina, o risco; uma confirmação nas escritas é assunto de outra ADR. Rotinas (`ask_agent`) e voz não recebem anexos.
- **Interface:** miniaturas e cartões de arquivo acima do campo, com ✕; no balão do usuário, a imagem (toque abre inteira) e o cartão do arquivo antes do texto. Arquivos que não são imagem ainda não abrem no balão.

## Consequências

- Anexar muda o custo: a imagem aparece como tokens de entrada nas métricas (ADR 0008), sem contagem própria.
- A migração 2 é aditiva: conversas antigas seguem como estavam.
- Dependências novas com código nativo (`expo-image-picker`, `expo-document-picker`, `expo-file-system`, `expo-image-manipulator`): exigem novo build, não vale OTA. O plugin do `expo-image-picker` **não** pode receber `microphonePermission: false`, porque bloquearia o `RECORD_AUDIO` da voz (há teste no `app.config`).
- **A verificar em aparelho:** câmera e seletores no S26; HEIC; PDF de vários MB com modelo sem leitura nativa (custo do parser do OpenRouter); o `expo/fetch` mandando o corpo grande em base64; tempo do redimensionamento; a nota de privacidade legível. Se o PDF por parser pago surpreender na fatura, restringir PDF a modelos que o leem direto.
