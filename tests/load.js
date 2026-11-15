'use strict';

/**
 * Loads the DOM-free part of the app into Node the same way the page does: every file is a
 * classic script that registers itself on the SliceStudio global, in dependency order.
 */
const SCRIPTS = [
  'util', 'slicing', 'naming', 'viewport', 'keys', 'history', 'project', 'settings', 'exporter',
];

for (const name of SCRIPTS) require(`../js/${name}.js`);

module.exports = globalThis.SliceStudio;
