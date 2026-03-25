const config = require('./src/config/env');
const { exec } = require('child_process');
const path = require('path');
const env = { 
    ...process.env, 
    OKX_API_KEY: config.okx.apiKey, 
    OKX_SECRET_KEY: config.okx.secretKey, 
    OKX_PASSPHRASE: config.okx.passphrase 
};
const onchainosPath = path.join(process.env.USERPROFILE, '.local', 'bin', 'onchainos.exe');
exec(`"${onchainosPath}" wallet status`, { env }, (err, stdout) => {
    console.log(stdout);
});
