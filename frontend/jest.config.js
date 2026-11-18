const strict = {
  branches: 95, functions: 95, lines: 95, statements: 95,
};

module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/src/**/*.test.{js,jsx}'],
  moduleNameMapper: {
    '\.css$': '<rootDir>/src/testUtils/styleStub.js',
    '^axios$': 'axios/dist/node/axios.cjs',
  },
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: ['src/**/*.{js,jsx}', '!src/**/*.test.{js,jsx}', '!src/main.jsx', '!src/testUtils/**'],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 80, functions: 80, lines: 80, statements: 80,
    },
    // Security-relevant client code: session handling, CSRF, route guards, permission rules
    './src/api/api.js': strict,
    './src/context/AuthContext.jsx': strict,
    './src/routes/ProtectedRoute.jsx': strict,
    './src/utils/permissions.js': strict,
  },
};
