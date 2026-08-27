const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  // Match the tsconfig "@/*" path alias so tests can import app modules.
  // @psx/shared is mapped explicitly: ts-jest does not follow the workspace
  // symlink into a package whose exports point at raw .ts files.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@psx/shared$": "<rootDir>/packages/shared/src/index.ts",
    "^@psx/shared/(.*)$": "<rootDir>/packages/shared/src/$1.ts",
  },
  testPathIgnorePatterns: ["/node_modules/", "/mobile/"],
};