'use strict';

const makeModuleExports = require('./src/lib/makeModule.js');
const moduleExports = require('./src/lib/module.js');

// Literal assignments let Node expose named imports from this CommonJS entry.
exports.Module = moduleExports.Module;
exports.makeModule = makeModuleExports.makeModule;
exports.withModuleName = makeModuleExports.withModuleName;
