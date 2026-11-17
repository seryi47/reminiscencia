package es.orbitalabs.reminiscencia

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import com.ryanheise.audioservice.AudioServiceActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

// audio_service exige AudioServiceActivity para conectar los controles multimedia.
class MainActivity : AudioServiceActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Canal para la auto-actualización (ADR-0047): tras descargar el APK nuevo a la caché interna, Dart llama a
        // `install` con la ruta del fichero; nosotros lo servimos por FileProvider y abrimos el instalador del sistema.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "reminiscencia/installer")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "install" -> {
                        val filePath = call.argument<String>("path")
                        if (filePath.isNullOrBlank()) {
                            result.error("bad_args", "Falta 'path'", null)
                            return@setMethodCallHandler
                        }
                        try {
                            installApk(filePath)
                            result.success(true)
                        } catch (e: Exception) {
                            result.error("install_failed", e.message, null)
                        }
                    }
                    "canRequestInstall" -> {
                        val pm = packageManager
                        // En Android O+ (API 26) hace falta permiso explícito de usuario para instalar paquetes de fuentes
                        // externas. Lo preguntamos para que la interfaz pueda abrir Ajustes si falta.
                        val allowed = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                            pm.canRequestPackageInstalls()
                        } else { true }
                        result.success(allowed)
                    }
                    "openInstallPermissionSettings" -> {
                        try {
                            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                                .setData(Uri.parse("package:$packageName"))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            startActivity(intent)
                            result.success(true)
                        } catch (e: Exception) {
                            result.error("open_settings_failed", e.message, null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun installApk(path: String) {
        val file = File(path)
        val authority = "$packageName.updates"
        val uri: Uri = FileProvider.getUriForFile(this, authority, file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
    }
}
