// This app is deliberately NOT an npm workspace member. The web app pins
// react-is 16 (recharts) while expo-router's tree needs react-is 19, so npm
// could never hoist both into one tree: it nested expo-router under mobile/
// while hoisting the expo CLI to the root, and the CLI then could not resolve
// expo-router/_ctx-shared. Giving this app its own node_modules ends that
// fight, and keeps mobile dependencies out of the web app's Vercel installs.
//
// The cost is that Expo's automatic monorepo detection does not apply, so the
// one thing it would have done for us is done by hand: watch @psx/shared, which
// is symlinked in through a file: dependency and compiled from source.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "../packages/shared");

const config = getDefaultConfig(projectRoot);

// Without this, edits to shared code do not trigger a reload.
config.watchFolders = [sharedRoot];

module.exports = config;
