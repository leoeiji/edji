# 0007: Atualização do app pelo GitHub Releases

- **Status:** aceita; nada verificado em aparelho. Emendada em 2026-11-28: versões candidatas (ver abaixo).
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

- **Chave própria:** o `release.yaml` assina com a chave do Edji (secrets `ANDROID_KEYSTORE_BASE64` e `ANDROID_KEYSTORE_PASSWORD`; o alias `edji` fica no workflow, porque o GitHub descarta outputs que contêm o valor de um secret) e falha se o certificado do APK não tiver o SHA-256 esperado (`16f9d969…ef1f4b`). O `app.config.ts` aplica a assinatura no `build.gradle` gerado quando `EDJI_KEYSTORE_FILE` existe; sem ela, builds locais seguem com a chave de debug. A keystore fica fora do repositório. Perder a chave obriga cada aparelho a desinstalar para atualizar.
- **Fonte:** `GET https://api.github.com/repos/leoeiji/edji/releases/latest`, sem token (o repositório é público). Rascunhos e prereleases ficam de fora. O asset precisa se chamar `edji-<versão>.apk` e ter `digest` sha256; sem isso, a release é recusada.
- **Comparação:** pelo `versionCode` da tag contra o instalado (fórmula na emenda abaixo; até a 0.2.0 era MAJOR×10000 + MINOR×100 + PATCH). `src/core/version.ts` é uma cópia do cálculo do `app.config.ts`, porque o carregador de config do Expo não importa TypeScript local; um teste confere os dois.
- **Opt-in:** procurar é tocar em "Procurar" (Configurações → Atualizações) ou ligar "Procurar sozinho", desligado por padrão. Ligado, o app consulta ao abrir, no máximo uma vez por dia; só uma resposta conta, então sem rede ele tenta na próxima abertura. A consulta revela o IP ao GitHub e não envia nada do Edji.
- **Instalação (nativo, `AppUpdater`):** só quando o usuário toca em Atualizar (no aviso do chat ou nas Configurações). Baixa para o cache numa thread própria (nunca na fila do módulo, para não atrasar a voz), confere tamanho e SHA-256, depois pacote, versão maior e certificado iguais aos do app instalado (`UpdateRules`, testado na JVM), e entrega ao `PackageInstaller`. O sistema pede confirmação; o resultado volta ao `AppUpdateReceiver` (não exportado). A permissão "Instalar apps desconhecidos" está na aba Permissões (`install_updates`). O APK baixado é apagado na próxima abertura do app.

## Consequências

- Trocar a chave de debug pela do Edji obriga a desinstalar uma vez quem tinha a 0.0.1 (os dados locais se perdem). Daí em diante, cada release instala por cima.
- O hash vem da mesma origem do APK: protege contra download corrompido, não contra o GitHub comprometido. A garantia real é a assinatura, que o Android exige.
- Renomear o asset ou trocar a chave quebra a atualização de todos os aparelhos; o `release.yaml` avisa nos comentários e confere o certificado.
- A validar no S26: o fluxo completo (permissão, download de ~75 MB, confirmação, reabertura), se o papel de assistente e as rotinas sobrevivem (`MY_PACKAGE_REPLACED` já re-registra os gatilhos) e se dá para instalar sem confirmação a partir da segunda atualização.

## Emenda (2026-11-28): versões candidatas

**Contexto.** Cada versão só é validada em aparelho depois de lançada; faltava um jeito de instalar uma versão no S26 antes de ela chegar a todos. A fórmula antiga do `versionCode` não deixava número entre duas versões.

**Decisão.**

- **Versão candidata:** `X.Y.Z-rc.N` (N de 1 a 98), criada com `npm version X.Y.Z-rc.N` e a tag `vX.Y.Z-rc.N`. Pode ser marcada na branch do PR, porque o `release.yaml` compila a partir da tag; a versão final é marcada na `main` depois do merge.
- **`versionCode` = MAJOR×1.000.000 + MINOR×10.000 + PATCH×100 + N**, com N = 99 na versão final: `0.3.0-rc.1` → 30001, `0.3.0-rc.2` → 30002, `0.3.0` → 30099. Cada candidata instala por cima da anterior e a final por cima das candidatas. Da 0.3.0 em diante, todo código é maior que o da última versão na fórmula antiga (a 0.2.0 era 200), então a troca não exige desinstalar. Não tem volta: voltar à fórmula antiga faria os códigos diminuírem.
- **Publicação:** a candidata sai como prerelease no GitHub, com notas desde a release anterior. A final tem notas desde a última final, para incluir o que entrou nas candidatas.
- **Canal de teste:** "Versões de teste" nas Configurações, desligado por padrão. Desligado, nada muda: o app consulta `releases/latest`, que nunca devolve prerelease. Ligado, consulta `GET /repos/leoeiji/edji/releases?per_page=20` (mesma consulta sem dados do Edji) e oferece a maior versão utilizável, candidata ou final. Quem está numa candidata recebe a final mesmo com o canal desligado.

**Consequências.** Uma candidata publicada fica visível para qualquer um com o canal ligado; não é privada. A primeira candidata de quem está na 0.2.0 precisa ser instalada à mão (a 0.2.0 não tem o canal) ou esperar a final.
