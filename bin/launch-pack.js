#!/usr/bin/env node

'use strict';

const { version } = require('../package.json');

console.info(`[LaunchPack] version ${version}`);

global.LaunchPack = {
  VERSION: version,
};

// 実行モードの設定
const eunModeIndex = 2;
if (eunModeIndex < process.argv.length) {
  global.LaunchPack.RUN_MODE = process.argv[eunModeIndex];
} else {
  global.LaunchPack.RUN_MODE = 'local'; // デフォルトの設定
}

// デバッグモードのデフォルト設定
global.LaunchPack.DEBUG_MODE = false;

require('../lib/server').launchServer();
