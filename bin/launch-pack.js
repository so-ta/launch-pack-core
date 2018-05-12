#!/usr/bin/env node
'use strict';

const server = require('../lib/server');

console.log('LaunchPack Launch');

// Set env var for ORIGINAL cwd
// before anything touches it
let cwd = process.cwd();

// Exit with 0 or 1
let failed = false;
process.once('exit', function (code) {
  if (code === 0 && failed) {
    process.exit(1);
  }
});

server.launchServer(cwd);
