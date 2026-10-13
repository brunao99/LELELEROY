// Plugin de configuração: no Android, quando o app fecha por um erro nativo
// (Java/Kotlin), grava a pilha em files/last-crash.txt antes de fechar. Na
// próxima abertura, a tela de erro (src/crash) mostra o texto para compartilhar.
const { withMainApplication } = require('expo/config-plugins');

const MARKER = 'last-crash.txt';

const HOOK = `
    // Bobina: guarda o erro que fechar o app, para a tela de erro mostrar na próxima abertura.
    val bobinaDefaultHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        java.io.File(filesDir, "${MARKER}").writeText(
          "Thread: " + thread.name + "\\n" + android.util.Log.getStackTraceString(error)
        )
      } catch (_: Throwable) {
      }
      bobinaDefaultHandler?.uncaughtException(thread, error)
    }`;

module.exports = function withCrashLog(config) {
  return withMainApplication(config, (cfg) => {
    const source = cfg.modResults.contents;
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withCrashLog: MainApplication em Kotlin esperado.');
    }
    if (!source.includes(MARKER)) {
      const anchor = 'super.onCreate()';
      if (!source.includes(anchor)) throw new Error('withCrashLog: super.onCreate() não encontrado.');
      cfg.modResults.contents = source.replace(anchor, anchor + HOOK);
    }
    return cfg;
  });
};
