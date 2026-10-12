// Budget Planner - unlock with the phone's face or fingerprint.
// Mirrors the role that BiometricPrompt has on Android and LAContext has on iOS.
//
// Web: WebAuthn against the device's own authenticator (Touch ID, Windows
// Hello, Android biometrics). The credential is created once, kept in local
// storage, and every later unlock asks the authenticator to sign a fresh
// challenge. The private key never leaves the device and never leaves the
// browser, which is the same guarantee the two native APIs give.
//
// This is a real local-only device gate, not a simulation. It only works on
// https:// or localhost, and only when the browser has an enrolled platform
// authenticator. When it is unavailable the app falls back to the app password,
// exactly as the native builds do.
//
// NOT WIRED UP since accounts moved to the server. A device unlock only makes
// sense when there is a local lock to bypass, and there no longer is one: the
// server session is the gate. This file is kept for the native-parity work and
// is not imported anywhere.

import { Auth } from "../data/Auth.js";

const RP_ID = location.hostname;
const RP_NAME = "Budget Planner";
const USER_ID = new TextEncoder().encode("budget-planner-local-user");
const CHALLENGE_BYTES = 32;

const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const unb64u = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function randomChallenge() {
  return crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES));
}

/** True when this browser can use a device face / fingerprint / PIN. */
export async function available() {
  if (!window.PublicKeyCredential) return false;
  if (!window.isSecureContext) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** True when an enrolled credential is already stored. */
export function enrolled() {
  return !!Auth.bioCredential();
}

function supportedAlgorithms() {
  return ["public-key"];
}

/**
 * Creates the device credential. This pops the system prompt once, so it must
 * only ever be called from inside a user gesture.
 */
export async function enrol() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { id: RP_ID, name: RP_NAME },
      user: { id: USER_ID, name: "budget-planner", displayName: "Budget Planner" },
      pubKeyCredParams: supportedAlgorithms().map((alg) => ({ alg, type: "public-key" })),
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "required",
      },
      attestation: "none",
      timeout: 60_000,
    },
  });
  if (!cred) throw new Error("No credential was created");
  Auth.saveBioCredential({
    id: cred.id,
    rawId: b64u(cred.rawId),
    type: cred.type,
    // the public key is kept so the stored entry can be reused across reloads
    publicKey: cred.response.getPublicKey ? b64u(cred.response.getPublicKey()) : "",
  });
  return true;
}

/**
 * Asks the device to prove the user is present.
 * Resolves true when the authenticator signs the challenge, false otherwise.
 */
export async function unlock() {
  const stored = Auth.bioCredential();
  if (!stored) return false;
  if (!(await available())) return false;

  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      rpId: RP_ID,
      userVerification: "required",
      timeout: 60_000,
      allowCredentials: [{ type: "public-key", id: unb64u(stored.rawId) }],
    },
  });
  return !!cred;
}

/** Forgets the stored credential, e.g. when the user turns the switch off. */
export function forget() {
  Auth.saveBioCredential(null);
}

/** Wipes the credential. Called with the rest of the data on "Erase everything". */
export function wipe() {
  forget();
  Auth.setBioWanted(false);
}

/** A short name for the UI, e.g. "Face ID", "Touch ID" or "fingerprint". */
export function label() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "Face ID";
  if (/Macintosh/.test(ua)) return "Touch ID";
  if (/Android/.test(ua)) return "fingerprint or face";
  return "face or fingerprint";
}
