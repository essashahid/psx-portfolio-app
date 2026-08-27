# @psx/shared

Code shared by the Next.js web app (repo root) and the Expo mobile app (`mobile/`).

Ship raw TypeScript. There is no build step: the web app transpiles this package
through `transpilePackages` in `next.config.ts`, and Metro compiles it with Babel
like any other source file.

## What belongs here

Pure TypeScript with no platform assumptions: domain types, formatters, colour
systems, date helpers, request and response schemas.

## What must never be imported here

`react`, `react-dom`, `react-native`, `next/*`, `@supabase/ssr`, anything reading
`process.env`, and anything touching the DOM. The tsconfig omits the DOM lib so
most of these fail at typecheck. A type-only import of `@supabase/supabase-js` is
fine; it is declared as an optional peer dependency.

Import from the web app or mobile app as `@psx/shared/<module>`, for example
`@psx/shared/sector-colors`.
