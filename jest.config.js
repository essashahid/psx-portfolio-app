const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  // Match the tsconfig "@/*" path alias so tests can import app modules.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};