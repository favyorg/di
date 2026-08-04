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
  transformIgnorePatterns: ['node_modules/(?!(es-module-lexer)/)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: { '\\.css$': '<rootDir>/test/style-mock.js' },
  coverageDirectory: '../coverage/docs',
};
