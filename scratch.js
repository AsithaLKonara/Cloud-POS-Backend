require('dotenv').config({ path: '/Volumes/240GB SSD/Projects/Laural-Clothing/Backend/.env' });
const crypto = require('crypto');

const privateKeyRaw = process.env.KOKO_PRIVATE_KEY;

function formatKey(key, type) {
    if (!key) return '';
    key = key.replace(/\\n/g, '\n').trim();
    if (key && !key.includes('-----BEGIN')) {
        const stripped = key.replace(/\s+/g, '');
        const formattedKey = stripped.match(/.{1,64}/g)?.join('\n') || stripped;
        // The old code used RSA PRIVATE KEY, let's see which one works
        return `-----BEGIN ${type === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'} KEY-----\n${formattedKey}\n-----END ${type === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'} KEY-----`;
    }
    return key;
}

const newFormat = formatKey(privateKeyRaw, 'PRIVATE');
console.log(newFormat);

try {
    const sign = crypto.createSign('SHA256');
    sign.update("test");
    sign.sign(newFormat, 'base64');
    console.log("Success with PRIVATE KEY!");
} catch(e) {
    console.log("Failed with PRIVATE KEY:", e.message);
}

function formatKeyRSA(key, type) {
    if (!key) return '';
    key = key.replace(/\\n/g, '\n').trim();
    if (key && !key.includes('-----BEGIN')) {
        const stripped = key.replace(/\s+/g, '');
        const formattedKey = stripped.match(/.{1,64}/g)?.join('\n') || stripped;
        return `-----BEGIN ${type === 'PRIVATE' ? 'RSA PRIVATE' : 'PUBLIC'} KEY-----\n${formattedKey}\n-----END ${type === 'PRIVATE' ? 'RSA PRIVATE' : 'PUBLIC'} KEY-----`;
    }
    return key;
}

const rsaFormat = formatKeyRSA(privateKeyRaw, 'PRIVATE');
try {
    const sign = crypto.createSign('SHA256');
    sign.update("test");
    sign.sign(rsaFormat, 'base64');
    console.log("Success with RSA PRIVATE KEY!");
} catch(e) {
    console.log("Failed with RSA PRIVATE KEY:", e.message);
}
