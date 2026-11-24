# Spike: botão lateral → voz → lista (Android)

Protótipo descartável para validar a hipótese crítica do Edji (ver [AGENTS.md](../../AGENTS.md#hipótese-crítica-ativação-pelo-botão-lateral)): segurar o botão lateral abre o Edji como assistente digital, a fala é transcrita no aparelho e vira uma tarefa na lista.

Não é o MVP. O código serve para medir e registrar o comportamento real em aparelho; o que for aprendido vai para um ADR em `docs/decisions/`.

## O que tem

| Arquivo | Papel |
| --- | --- |
| `EdjiVoiceInteractionService` | Serviço que o sistema mantém rodando quando o Edji é o assistente padrão. |
| `EdjiSessionService` / `EdjiSession` | A sessão aberta pelo gesto: "Ouvindo..." → transcrição → "Anotado.", com vibração, e fecha sozinha. |
| `EdjiRecognitionService` | Stub exigido para o Edji aparecer na lista de assistentes. Não reconhece nada. |
| `VoiceCapture` | Reconhecimento em pt-BR: usa o on-device do sistema; se faltar, outro serviço escolhido explicitamente (nunca o stub). |
| `TaskStore` | Lista em JSON nos arquivos privados do app. |
| `MainActivity` | Status (microfone, assistente padrão), teste de voz dentro do app, lista e registro de eventos. |

## Preparar o Mac (uma vez)

Versões: AGP 9.4.0 (Kotlin embutido, Compose compiler 2.3.0), Gradle 9.6.0, compileSdk/targetSdk 36, minSdk 31, JDK 17+ (o JBR do Android Studio serve).

1. Instale o Android Studio: `brew install --cask android-studio`.
2. Instale o SDK (ou use o assistente do Studio):
   ```sh
   brew install --cask android-commandlinetools
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   sdkmanager --sdk_root="$HOME/Library/Android/sdk" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   ```
3. Compile e rode os testes pela linha de comando:
   ```sh
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$ANDROID_HOME/platform-tools:$PATH"
   ./gradlew testDebugUnitTest assembleDebug
   ```
   Ou, no Android Studio, **Open** → esta pasta (`spikes/android-assistant`).

## Preparar o celular (uma vez)

1. Configurações → Sobre o telefone → Informações do software → toque 7 vezes em **Número de compilação**.
2. Configurações → Opções do desenvolvedor → **Depuração USB** (ou **Depuração sem fio**).
3. Conecte e aceite a autorização. `adb devices` deve listar o aparelho.

## Rodar e testar no Galaxy

1. Instale: **Run** no Android Studio, ou `./gradlew installDebug`.
2. Abra o **Edji (spike)** e toque em **Permitir** no microfone.
3. Toque em **Testar voz aqui** e diga "comprar pão". A tarefa deve aparecer marcada como `TESTE`. Isso valida o reconhecimento antes do botão.
4. Toque em **Configurar** e escolha o Edji como **app assistente digital**.
5. Configurações → Recursos avançados → **Botão lateral** → **Pressionar e manter** → **Assistente digital**. Na engrenagem, confira se o Edji é o escolhido.
6. Segure o botão lateral, diga "comprar pão". Deve aparecer "Anotado." e a tarefa entra na lista como `VOZ`.
7. Repita o passo 3 depois do passo 4 (com o Edji já como assistente) e repita o passo 6 com a tela bloqueada.

Para acompanhar em tempo real:

```sh
adb logcat -s Edji
```

## O que registrar

Copie do registro (no app ou no logcat) e anote para o ADR:

- [ ] O Edji aparece como opção de assistente digital? E na engrenagem do botão lateral?
- [ ] Segurar o botão abre a sessão? Valor de `showFlags` e `args` na linha "sessão aberta".
- [ ] Qual reconhecedor rodou (`stt: usando ...`) e se funcionou sem internet (modo avião).
- [ ] Latências: "gesto → microfone" e "gesto → tarefa salva".
- [ ] Funciona com a tela bloqueada? E com a tela apagada?
- [ ] O teste no app continua funcionando depois que o Edji vira assistente padrão?
- [ ] Modelo, versão do Android e da One UI.

## Problemas conhecidos e alternativas

- **Microfone dentro da sessão.** Se o teste no app funciona e a sessão dá erro de permissão ou de áudio, a alternativa é a sessão abrir uma atividade pequena que faz a captura. Ainda não implementado.
- **Edji não aparece na lista da Samsung.** Alternativa: Botão lateral → **Pressionar duas vezes** → **Abrir app**. Exigiria uma atividade de voz como ponto de entrada; ainda não implementado.
- **Reconhecimento on-device sem pt-BR.** O `VoiceCapture` tenta outro serviço e registra o erro. Pode ser preciso baixar o idioma em Configurações → Gerenciamento geral → Idiomas/Reconhecimento de voz.
