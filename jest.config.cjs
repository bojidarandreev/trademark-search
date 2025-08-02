/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["./jest.setup.cjs"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "axios-cookiejar-support": "<rootDir>/__mocks__/axios-cookiejar-support.js",
  },
};
