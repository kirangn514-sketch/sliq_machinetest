require('@testing-library/jest-dom');
const { TextEncoder, TextDecoder } = require('util');

// React Router needs these in jsdom.
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

// Give async UI queries more headroom on busy CI/dev machines (default is 1s).
const { configure } = require('@testing-library/react');

configure({ asyncUtilTimeout: 4000 });
jest.setTimeout(20000);
