// @ts-nocheck -- Jest loads this through ts-node with CommonJS overrides.
/* eslint-disable */
export default {
  displayName: 'docs',
  preset: '../jest.preset.js',
  roots: ['<rootDir>/test'],
  testEnvironment: 'jsdom',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: {
    '^react$': '<rootDir>/../node_modules/react',
    '^react/jsx-runtime$': '<rootDir>/../node_modules/react/jsx-runtime.js',
    '^react-dom$': '<rootDir>/../node_modules/react-dom',
    '^react-dom/client$': '<rootDir>/../node_modules/react-dom/client.js',
    '^react-dom/test-utils$':
      '<rootDir>/../node_modules/react-dom/test-utils.js',
    '\\.css$': '<rootDir>/test/style-mock.js',
  },
  coverageDirectory: '../coverage/docs',
};
