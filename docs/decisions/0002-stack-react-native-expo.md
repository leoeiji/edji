# 0002: Stack: React Native + Expo com módulo nativo de voz

- **Status:** aceita
- **Data:** 2026-11-23
- **Relacionadas:** [0001](0001-ativacao-pelo-botao-lateral-android.md), [0003](0003-arquitetura-de-plugins.md)

## Contexto

O spike (ADR 0001) mostrou que a parte difícil é nativa e pequena: o serviço de assistente, a sessão de voz e o STT on-device, já escritos em Kotlin e validados no Galaxy S26 Ultra. O resto do app (lista, aba lateral de plugins, onboarding, configurações) é interface comum e precisa chegar ao iOS sem reescrita. O mantenedor conhece React e TypeScript e não quer depender só de Kotlin.

## Alternativas

1. **React Native + Expo**, com a sessão de voz num módulo nativo (Expo Modules: Kotlin no Android, Swift no iOS).
2. **Kotlin Multiplatform + Compose Multiplatform.** Android sem ponte, mas a interface no iOS é menos madura e tudo fica em Kotlin.
3. **Núcleo em Rust + UniFFI** com telas nativas. Exige pontes Kotlin e Swift desde o início para pouca lógica compartilhada, e duas interfaces.
4. **Tauri 2 / Flutter.** A sessão de voz seria nativa de qualquer forma; webview no gesto aumenta a latência (Tauri), e Flutter não aproveita o conhecimento de React.

## Decisão

App em **Expo (React Native, TypeScript)** com *development builds* (não Expo Go, por causa do código nativo). A captura de voz fica num módulo nativo local, `modules/edji-assistant`, portado do spike. A persistência é SQLite (`expo-sqlite`), num arquivo acessível também pelo código nativo.

## Consequências

- A tela, os plugins e a lógica dos tools são TypeScript e servem às duas plataformas; só a captura de voz é nativa por plataforma.
- A sessão abre o microfone sem iniciar JavaScript, mantendo os ~160 ms medidos. Como os tools dos plugins são TypeScript, a execução depois da fala depende de um runtime JS em segundo plano; ver o caminho da voz na ADR 0003 (hipótese ainda não medida).
- IA local futura pode usar bibliotecas do ecossistema (`llama.rn`, `whisper.rn`). Rust continua possível depois, como módulo nativo, se algum núcleo exigir.
- O spike em Kotlin foi removido depois do port; fica no histórico (commit `7d16948`).
