const { src, dest, parallel } = require('gulp');

function buildIcons() {
  return src('src/icons/**/*.svg').pipe(dest('dist/icons'));
}

function copyNodeJson() {
  return src('src/nodes/**/*.node.json').pipe(dest('dist/nodes'));
}

function copyIconToNodes() {
  return src('src/icons/**/*.svg').pipe(dest('dist/nodes/CoinbaseAgentTool'))
    .pipe(dest('dist/nodes/CoinbaseCdp'))
    .pipe(dest('dist/nodes/CoinbaseTrigger'));
}

exports['build:icons'] = parallel(buildIcons, copyNodeJson, copyIconToNodes);
