#!/usr/bin/env node

'use strict';

global.LaunchPack = {};

// 実行モードの設定
const eunModeIndex = 2;
if (eunModeIndex < process.argv.length) {
  global.LaunchPack.RUN_MODE = process.argv[eunModeIndex];
} else {
  global.LaunchPack.RUN_MODE = 'local'; // デフォルトの設定
}

require('../lib/server').launchServer(process.cwd());
