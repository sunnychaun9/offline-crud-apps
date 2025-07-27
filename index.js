/**
 * @format
 */
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { sha256 } from '@noble/hashes/sha256';

if (typeof global.crypto === 'undefined') {
  global.crypto = {};
}

global.crypto.subtle = {
  digest: async function (algorithm, data) {
    if (algorithm !== 'SHA-256') {
      throw new Error('Only SHA-256 is supported in this polyfill');
    }
    return Uint8Array.from(sha256(new Uint8Array(data))).buffer;
  },
};

AppRegistry.registerComponent(appName, () => App);
