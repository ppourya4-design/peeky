// Signs a release file with the project's Ed25519 key (PEEKY_SIGN_KEY, a PKCS#8 PEM kept in the repository
// secrets) and writes the signature next to it as base64. The app checks it before it installs an update.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const pem = process.env.PEEKY_SIGN_KEY;
if (!file || !pem) { console.error('usage: PEEKY_SIGN_KEY=<pem> node sign.mjs <file>'); process.exit(1); }
const sig = sign(null, readFileSync(file), createPrivateKey(pem.replace(/\\n/g, '\n')));
writeFileSync(file + '.sig', sig.toString('base64'));
console.log(`signed ${file} (${sig.length} bytes)`);