import "react-native-get-random-values";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as aesjs from "aes-js";
import { AppState } from "react-native";
import { createClient, type SupportedStorage } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy mobile/.env.example to mobile/.env and fill them in."
  );
}

/**
 * Session storage that survives being larger than the keychain allows.
 *
 * expo-secure-store is backed by the iOS keychain, whose items top out around
 * 2KB. A Supabase session carries an access token, a refresh token and the user
 * object, which regularly exceeds that. So the session is encrypted with a
 * one-time AES key, the key goes in SecureStore (small, hardware backed) and the
 * ciphertext goes in AsyncStorage (large, but useless on its own).
 */
const LargeSecureStore: SupportedStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const encrypted = await AsyncStorage.getItem(key);
      if (!encrypted) return null;

      const encryptionKeyHex = await SecureStore.getItemAsync(key);
      if (!encryptionKeyHex) return null;

      const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex));
      return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(encrypted)));
    } catch {
      // The two halves can desync: a keychain reset, a restore from backup, a
      // half finished write. Treat any failure as "no session" and let the user
      // sign in again rather than wedging the app on a corrupt read.
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey);
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(Array.from(encryptionKey)));
    await AsyncStorage.setItem(key, aesjs.utils.hex.fromBytes(Array.from(encrypted)));
  },

  async removeItem(key: string): Promise<void> {
    // Both halves, always. A stray key without its ciphertext is harmless, but
    // ciphertext left behind after a sign out is not.
    await Promise.all([SecureStore.deleteItemAsync(key), AsyncStorage.removeItem(key)]);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: LargeSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    // There is no URL to read a session out of in a native app, and leaving this
    // on makes supabase-js look for one on every load.
    detectSessionInUrl: false,
  },
});

/**
 * Refresh tokens only while the app is actually in front of someone. Left
 * running in the background it burns battery and keeps failing offline.
 */
let appStateSubscription: { remove(): void } | null = null;

export function startSessionAutoRefresh(): () => void {
  appStateSubscription?.remove();
  appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
  if (AppState.currentState === "active") supabase.auth.startAutoRefresh();

  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
    supabase.auth.stopAutoRefresh();
  };
}
