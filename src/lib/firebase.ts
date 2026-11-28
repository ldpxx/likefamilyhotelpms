import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';

// Architecture invariants (0 VND cost):
// - Firebase Cloud Storage is intentionally NEVER imported.
// - Google Sign-In (GoogleAuthProvider) is intentionally NEVER imported.
// - All accounts (SuperAdmin + Owner + Staff) authenticate via Firebase Auth Email/Password.
//   Staff usernames map cleanly to `<username>@likefamilyhotel.com` (no real inbox needed).
// - A Secondary Firebase App (`StaffCreator`) lets Owner/SuperAdmin create staff Auth accounts
//   without signing out their own active session (zero Cloud Functions needed).

export const STAFF_EMAIL_DOMAIN = 'likefamilyhotel.com';

export function usernameToInternalEmail(usernameOrEmail: string): string {
  const clean = usernameOrEmail.trim().toLowerCase().replace(/\s+/g, '');
  if (!clean) return '';
  return clean.includes('@') ? clean : `${clean}@${STAFF_EMAIL_DOMAIN}`;
}

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const USE_EMULATOR = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

export const app =
  getApps().find((a) => a.name === '[DEFAULT]') || initializeApp(firebaseConfig);
export const auth = getAuth(app);
if (USE_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

let staffCreatorApp: FirebaseApp | null = null;
let staffCreatorEmulatorBound = false;
export function getStaffCreatorAuth(): Auth {
  if (!staffCreatorApp) {
    staffCreatorApp =
      getApps().find((a) => a.name === 'StaffCreator') ||
      initializeApp(firebaseConfig, 'StaffCreator');
  }
  const scAuth = getAuth(staffCreatorApp);
  if (USE_EMULATOR && !staffCreatorEmulatorBound) {
    connectAuthEmulator(scAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    staffCreatorEmulatorBound = true;
  }
  return scAuth;
}

let dbInstance: Firestore;
if (USE_EMULATOR) {
  dbInstance = getFirestore(app);
  connectFirestoreEmulator(dbInstance, '127.0.0.1', 8080);
} else {
  try {
    dbInstance = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    try {
      dbInstance = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentSingleTabManager({ forceOwnership: true }),
        }),
      });
    } catch {
      dbInstance = getFirestore(app);
    }
  }
}

export const db = dbInstance;
