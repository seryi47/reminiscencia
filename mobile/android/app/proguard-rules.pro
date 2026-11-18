# ProGuard/R8 rules para la release minificada (ADR-0049).
# Objetivo: encoger el APK sin romper las interfaces nativas de Flutter y plugins.

# Flutter core: todo lo de `io.flutter.*` y `io.flutter.embedding.*` debe quedarse tal cual (lo llama la VM por nombre).
-keep class io.flutter.** { *; }
-keep class io.flutter.embedding.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class io.flutter.plugin.** { *; }
-dontwarn io.flutter.embedding.**

# Plugins con acceso nativo que suelen romperse al minificar.
-keep class com.ryanheise.** { *; }                     # audio_service + just_audio
-keep class com.llfbandit.record.** { *; }             # record 5.1.2 (mic)
-keep class com.arthenica.ffmpegkit.** { *; }          # ffmpeg_kit_flutter_new_audio
-keep class com.linusu.flutter_web_auth.** { *; }      # OAuth de Spotify (si se usa)
-keep class com.baseflow.permissionhandler.** { *; }   # permission_handler
-keep class androidx.lifecycle.DefaultLifecycleObserver { *; }

# Anotaciones (Flutter las usa internamente para plugins).
-keep @androidx.annotation.Keep class *
-keepclassmembers class * {
    @androidx.annotation.Keep <methods>;
    @androidx.annotation.Keep <fields>;
}

# Clases serializables desde JSON por reflection.
-keepattributes *Annotation*
-keepattributes InnerClasses
-keepattributes Signature

# Evitar avisos de librerías de soporte ya removidas en AndroidX.
-dontwarn java.beans.**
-dontwarn javax.lang.model.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
