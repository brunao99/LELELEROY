// Entrada do app: a mesma do expo-router, com uma proteção em volta. Um erro que
// fecharia o app aparece numa tela, com o texto para compartilhar (src/crash).
import '@expo/metro-runtime';

import { CrashGate } from './src/crash/CrashGate';
import { installCrashHandler, reportCrash } from './src/crash/state';

installCrashHandler();

let App = null;
try {
  App = require('expo-router/build/qualified-entry').App;
} catch (error) {
  reportCrash(error);
}

const { renderRootComponent } = require('expo-router/build/renderRootComponent');

function Root() {
  return <CrashGate>{App ? <App /> : null}</CrashGate>;
}

renderRootComponent(Root);
