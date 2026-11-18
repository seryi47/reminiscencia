import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "es.orbitalabs.reminiscencia"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "es.orbitalabs.reminiscencia"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // Nota: NO ponemos `ndk.abiFilters` aquí porque choca con `--split-per-abi` de Flutter. Para el universal, al
        // compilar pasamos `--target-platform=android-arm64,android-x64` explícitamente (ADR-0049). Resultado: universal
        // sin armeabi-v7a pesa 111 MB (de 142). Los splits generan los 3 como antes, por si alguien necesita el de 32-bit.
    }

    // Firma de publicación: android/key.properties (ignorado por Git). Si falta, se usa la de depuración.
    val keyPropertiesFile = rootProject.file("key.properties")
    val keyProperties = Properties().apply {
        if (keyPropertiesFile.exists()) keyPropertiesFile.inputStream().use { load(it) }
    }

    signingConfigs {
        create("release") {
            if (keyPropertiesFile.exists()) {
                keyAlias = keyProperties["keyAlias"] as String
                keyPassword = keyProperties["keyPassword"] as String
                storeFile = file(keyProperties["storeFile"] as String)
                storePassword = keyProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (keyPropertiesFile.exists()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            // Optimización de la release (ADR-0049): R8 minifica dex y shrinkResources quita recursos no referenciados.
            // Reglas de ProGuard en proguard-rules.pro: mantener todo lo de Flutter, audio_service, record, just_audio y
            // ffmpeg_kit para que no se eliminen símbolos nativos. Resultado esperado: ~5-10 MB menos de APK.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    // El APK por ABI (--split-per-abi) no duplica los `.so`. Para la UNIVERSAL filtramos los NEON de armeabi-v7a: la
    // librería `libavcodec.so` ya trae el camino NEON por autodetección; `libavcodec_neon.so` suma +10 MB redundantes.
    packaging {
        jniLibs {
            excludes.add("**/libavcodec_neon.so")
            excludes.add("**/libavformat_neon.so")
            excludes.add("**/libavfilter_neon.so")
            excludes.add("**/libavdevice_neon.so")
            excludes.add("**/libavutil_neon.so")
            excludes.add("**/libswresample_neon.so")
            excludes.add("**/libswscale_neon.so")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
