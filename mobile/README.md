# Plumb, the mobile app

The Expo app. It ships as **Plumb**, while the web app remains PortfolioOS PK.
It is a separate codebase but lives in the same repo, so both compile the same
TypeScript out of `packages/shared`.

There is no separate backend. This app calls the same Next API routes the web
app uses and the same Supabase project, authenticating with a Supabase access
token as a bearer header instead of session cookies. `requireUser()` in
`lib/shared/api.ts` accepts either.

## Setup

```sh
cp .env.example .env      # then fill in the Supabase URL, anon key and API URL
npm install               # run from the repo root, this is a workspace
```

`EXPO_PUBLIC_API_URL` decides which backend you hit:

| Target | Value |
| --- | --- |
| Production | `https://<your-app>.vercel.app` |
| `next dev`, Android emulator | `http://10.0.2.2:3000` |
| `next dev`, physical device | `http://<your-machine-LAN-IP>:3000` |

`localhost` does not resolve from the emulator or a device. `10.0.2.2` is how
the Android emulator refers to the host machine.

## Running

```sh
npx expo run:android      # builds the native app and installs it on the emulator
npx expo start            # after the first build, for day to day work
```

The first `run:android` runs a full Gradle build and takes a while. After that
`expo start` is enough unless a native dependency changes.

The emulator this was set up against is the `psx_pixel7` AVD on the Android 15
arm64 image. Start it with:

```sh
~/Library/Android/sdk/emulator/emulator -avd psx_pixel7
```

## Layout

```
app/            expo-router screens; (tabs) holds the five tab routes
components/     shared UI pieces
lib/
  api.ts        fetch wrapper that attaches the bearer token and retries a 401 once
  auth.tsx      session context, sign in and sign out
  supabase.ts   Supabase client and the encrypted session store
  theme.ts      the web design tokens, resolved for React Native
```

## What is deliberately not here

Import, saved research, stock comparison and the admin screens stay on the web.
They are desk work. The klinecharts technicals workstation is web only too: it
is built against the DOM.
