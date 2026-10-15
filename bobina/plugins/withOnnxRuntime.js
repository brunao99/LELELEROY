// Plugin de configuração do ONNX Runtime (recorte com laço).
// O pacote onnxruntime-react-native pede a versão nativa "mais nova" no Android
// e qualquer versão no iOS. Aqui as duas ficam presas à versão do pacote JS, para
// o app compilado hoje e daqui a um mês ser o mesmo. Também tira do APK as
// bibliotecas de teste (mockito) que o módulo Android declara como dependência.
const { withAppBuildGradle, withDangerousMod, withProjectBuildGradle } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ORT_VERSION = require('onnxruntime-react-native/package.json').version;
const MARKER = '// ledits: onnxruntime';

const PIN_ANDROID = `
${MARKER}
subprojects {
  configurations.configureEach {
    resolutionStrategy.eachDependency { details ->
      if (details.requested.group == 'com.microsoft.onnxruntime') {
        details.useVersion('${ORT_VERSION}')
      }
    }
  }
}
`;

const EXCLUDE_TEST_LIBS = `
${MARKER}
configurations.configureEach {
  exclude group: 'org.mockito'
}
`;

module.exports = function withOnnxRuntime(config) {
  config = withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) cfg.modResults.contents += PIN_ANDROID;
    return cfg;
  });
  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) cfg.modResults.contents += EXCLUDE_TEST_LIBS;
    return cfg;
  });
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf-8');
      const line = `  pod 'onnxruntime-c', '${ORT_VERSION}'`;
      if (!contents.includes("pod 'onnxruntime-c'")) {
        // Logo depois da abertura do target, como o plugin do próprio pacote faz.
        const anchor = /^(target .+ do)$/m;
        if (!anchor.test(contents)) throw new Error('withOnnxRuntime: target do app não encontrado no Podfile.');
        fs.writeFileSync(podfile, contents.replace(anchor, `$1\n${line}`));
      }
      return cfg;
    },
  ]);
  return config;
};
