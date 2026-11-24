// AGP 9 has built-in Kotlin: the Kotlin Android plugin is not applied.
// The Kotlin version is pinned here only so the Compose compiler plugin matches it.
plugins {
    id("com.android.application") version "9.4.0" apply false
    id("org.jetbrains.kotlin.android") version "2.3.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.0" apply false
}
