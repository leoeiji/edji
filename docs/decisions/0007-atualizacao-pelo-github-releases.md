# 0007: Atualização do app pelo GitHub Releases

- **Status:** aceita; nada verificado em aparelho
- **Data:** 2026-11-27
- **Relacionadas:** [0002](0002-stack-react-native-expo.md); princípio "Local e privado" do `AGENTS.md`

## Contexto

O Edji é distribuído só como APK no GitHub Releases (`release.yaml`). Atualizar exigia abrir o GitHub no navegador, baixar e instalar à mão. O APK saía assinado com a chave de debug do template do Expo, que é pública: qualquer APK assinado com ela instalaria por cima do Edji.

## Alternativas

- **Loja (Play Store, F-Droid):** resolve a atualização, mas é cedo para publicar e o Edji pede permissões que a revisão da loja questiona (assistente, notificações, localização o tempo todo).
- **Atualização OTA do JS (`expo-updates`):** não cobre o Kotlin, que muda a cada etapa, e exige um servidor.
- **Obtainium ou outro app de terceiros:** funciona sem código, mas depende de outro app e não segue as mensagens e o opt-in do Edji.
- **Instalar sem confirmação** (`setRequireUserAction(USER_ACTION_NOT_REQUIRED)`, Android 12+, quando o Edji é o instalador de origem): fica para depois de medir no aparelho; a primeira versão pede confirmação ao sistema.

## Decisão

- **Chave própria:** o `release.yaml` assina com a chave do Edji (secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`) e falha se o certificado do APK não tiver o SHA-256 esperado (`16f9d969…ef1f4b`). O `app.config.ts` aplica a assinatura no `build.gradle` gerado quando `EDJI_KEYSTORE_FILE` existe; sem ela, builds locais seguem com a chave de debug. A keystore fica fora do repositório. Perder a chave obriga cada aparelho a desinstalar para atualizar.
- **Fonte:** `GET https://api.github.com/repos/leoeiji/edji/releases/latest`, sem token (o repositório é público). Rascunhos e prereleases ficam de fora. O asset precisa se chamar `edji-<versão>.apk` e ter `digest` sha256; sem isso, a release é recusada.
- **Comparação:** pelo `versionCode` (MAJOR×10000 + MINOR×100 + PATCH) da tag contra o instalado. `src/core/version.ts` é uma cópia do cálculo do `app.config.ts`, porque o carregador de config do Expo não importa TypeScript local; um teste confere os dois.
- **Opt-in:** procurar é tocar em "Procurar" (Configurações → Atualizações) ou ligar "Procurar sozinho", desligado por padrão. Ligado, o app consulta ao abrir, no máximo uma vez por dia; só uma resposta conta, então sem rede ele tenta na próxima abertura. A consulta revela o IP ao GitHub e não envia nada do Edji.
- **Instalação (nativo, `AppUpdater`):** só quando o usuário toca em Atualizar (no aviso do chat ou nas Configurações). Baixa para o cache numa thread própria (nunca na fila do módulo, para não atrasar a voz), confere tamanho e SHA-256, depois pacote, versão maior e certificado iguais aos do app instalado (`UpdateRules`, testado na JVM), e entrega ao `PackageInstaller`. O sistema pede confirmação; o resultado volta ao `AppUpdateReceiver` (não exportado). A permissão "Instalar apps desconhecidos" está na aba Permissões (`install_updates`). O APK baixado é apagado na próxima abertura do app.

## Consequências

- Trocar a chave de debug pela do Edji obriga a desinstalar uma vez quem tinha a 0.0.1 (os dados locais se perdem). Daí em diante, cada release instala por cima.
- O hash vem da mesma origem do APK: protege contra download corrompido, não contra o GitHub comprometido. A garantia real é a assinatura, que o Android exige.
- Renomear o asset ou trocar a chave quebra a atualização de todos os aparelhos; o `release.yaml` avisa nos comentários e confere o certificado.
- A validar no S26: o fluxo completo (permissão, download de ~75 MB, confirmação, reabertura), se o papel de assistente e as rotinas sobrevivem (`MY_PACKAGE_REPLACED` já re-registra os gatilhos) e se dá para instalar sem confirmação a partir da segunda atualização.
