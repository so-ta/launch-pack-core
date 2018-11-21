#!/usr/bin/env node

'use strict';

const server = require('../lib/server');

const cwd = process.cwd();
server.launchServer(cwd);

console.info('LaunchPack Launch');
