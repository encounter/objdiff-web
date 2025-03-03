import './init'; // Must come first

import { init, version } from 'objdiff-wasm';

init('debug');
console.log('Initialized objdiff-wasm', version());
