// share.js is browser code; Node needs btoa/atob.
globalThis.btoa = s => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');
