import { initializeApp } from "firebase/app";
import {
  getFirestore, connectFirestoreEmulator, addDoc, collection, getDocs, query,
  where, orderBy, runTransaction, doc, serverTimestamp, updateDoc, deleteDoc
} from "firebase/firestore";
import { computeInitialLastResetAt, getCurrentWindow } from "./cycle";

// --- Auth ---
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  linkWithCredential,
  EmailAuthProvider,
  signInAnonymously,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  linkWithPopup,
  linkWithRedirect,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FB_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://localhost:9099");
  connectFirestoreEmulator(db, "localhost", 8080);
}

// -------- Auth helpers
export async function loginAnon() {
  const { user } = await signInAnonymously(auth);
  return user;
}

// -------- Enveloppes
export async function createEnvelope(uid, name, baseLimit, period = "monthly", opts = {}) {
  const lastResetAt = computeInitialLastResetAt(period, {
    resetDow: opts.resetDow ?? 1,
    resetDom: opts.resetDom ?? 1
  });

  const allSnap = await getDocs(collection(db, "budgets", uid, "envelopes"));
let maxOrder = -1;
for (const d of allSnap.docs) {
const o = d.data().order;
if (typeof o === "number" && Number.isFinite(o) && o > maxOrder) maxOrder = o;
}
const nextOrder = maxOrder + 1;

  await addDoc(collection(db, "budgets", uid, "envelopes"), {
    name,
    base: baseLimit,                 // montant de base (centimes)
    carry: 0,                        // cumul des reports
    period,                          // "monthly" | "weekly" | "biweekly" | "daily" | "once"
    resetDow: opts.resetDow ?? null, // 0..6 si weekly/biweekly
    resetDom: opts.resetDom ?? null, // 1..31 si monthly
    lastResetAt,                     // Date JS
    createdAt: serverTimestamp(),
    order: nextOrder,
  });
}

export async function updateEnvelope(uid, envelopeId, patch) {
  // Rien de spécial pour 'at' sur une enveloppe : on ne gère pas ce champ ici.
  await updateDoc(doc(db, "budgets", uid, "envelopes", envelopeId), { ...patch });
}

export async function deleteEnvelopeAndTransactions(uid, envelopeId) {
  // supprime l’enveloppe + toutes ses transactions (par lots)
  const qTx = query(collection(db, "budgets", uid, "transactions"), where("envelopeId", "==", envelopeId));
  const snap = await getDocs(qTx);
  const batchSize = 450;
  let batch = [];
  for (const d of snap.docs) {
    batch.push(deleteDoc(d.ref));
    if (batch.length >= batchSize) { await Promise.all(batch); batch = []; }
  }
  if (batch.length) await Promise.all(batch);
  await deleteDoc(doc(db, "budgets", uid, "envelopes", envelopeId));
}

export async function getEnvelopes(uid) {
  const col = collection(db, "budgets", uid, "envelopes");
  const snap = await getDocs(query(col, orderBy("order", "asc")));
  const envs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // place les undefined à la fin + tri par nom pour stabilité
  return envs.sort((a, b) =>
    (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY)
    || (a.name || "").localeCompare(b.name || "", "fr")
  );
}

export async function setEnvelopeOrder(uid, envelopeId, order) {
  await updateDoc(doc(db, "budgets", uid, "envelopes", envelopeId), { order });
}

export async function swapEnvelopeOrder(uid, idA, idB) {
  await runTransaction(db, async (tx) => {
    const refA = doc(db, "budgets", uid, "envelopes", idA);
    const refB = doc(db, "budgets", uid, "envelopes", idB);
    const snapA = await tx.get(refA);
    const snapB = await tx.get(refB);
    if (!snapA.exists() || !snapB.exists()) throw new Error("Enveloppe introuvable");
    const a = snapA.data();
    const b = snapB.data();
    const orderA = typeof a.order === "number" ? a.order : 0;
    const orderB = typeof b.order === "number" ? b.order : 0;
    tx.update(refA, { order: orderB });
    tx.update(refB, { order: orderA });
  });
}

// -------- Transactions
export async function addTransaction(uid, envelopeId, amount, note = "", at = new Date()) {
  return await addDoc(collection(db, "budgets", uid, "transactions"), {
    envelopeId,
    amount,                          // + entrée, - sortie (centimes)
    note,
    type: amount >= 0 ? "ENTRÉE" : "SORTIE",
    at,                              // Date JS
    createdAt: serverTimestamp(),
  });
}

export async function getTransactionsForWindow(uid, envelopeId, start, end) {
  const q = query(
    collection(db, "budgets", uid, "transactions"),
    where("envelopeId", "==", envelopeId),
    where("at", ">=", start),
    where("at", "<", end),
    orderBy("at", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateTransaction(uid, txId, patch) {
  const data = { ...patch };
  // n’écrase 'at' que s’il est fourni et valide
  if (Object.prototype.hasOwnProperty.call(data, "at") && !(data.at instanceof Date)) {
    // si 'at' fourni mais pas Date (ex: null/undefined), on l’enlève pour ne pas corrompre le type
    delete data.at;
  }
  await updateDoc(doc(db, "budgets", uid, "transactions", txId), data);
}

export async function deleteTransaction(uid, txId) {
  await deleteDoc(doc(db, "budgets", uid, "transactions", txId));
}

// --- Transferts : on relie les 2 écritures avec un groupId ---
function newId(path) { return doc(collection(db, path)).id; }

export async function transferBetweenEnvelopes(uid, fromId, toId, amount, note = "Transfert", at = new Date()) {
  const abs = Math.abs(amount);
  const groupId = newId(`budgets/${uid}/transactions`); // même id de groupe pour les 2 lignes

  await runTransaction(db, async (tx) => {
    const col = collection(db, "budgets", uid, "transactions");
    const outRef = doc(col);
    const inRef  = doc(col);

    tx.set(outRef, {
      groupId,
      envelopeId: fromId,
      amount: -abs,
      type: "TRANSFERT_OUT",
      note: `${note} → vers ${toId}`,
      at,
      createdAt: serverTimestamp(),
    });

    tx.set(inRef,  {
      groupId,
      envelopeId: toId,
      amount:  abs,
      type: "TRANSFERT_IN",
      note: `${note} ← de ${fromId}`,
      at,
      createdAt: serverTimestamp(),
    });
  });

  return groupId;
}

export async function getTransferPair(uid, groupId) {
  const qTx = query(collection(db, "budgets", uid, "transactions"), where("groupId", "==", groupId));
  const snap = await getDocs(qTx);
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // OUT (amount < 0), IN (amount > 0)
  const out = docs.find(d => d.amount < 0);
  const inn = docs.find(d => d.amount > 0);
  return { out, inn };
}

export async function updateTransfer(uid, groupId, { fromId, toId, amount, note, at }) {
  const abs = Math.abs(amount);

  await runTransaction(db, async (tx) => {
    const qTx = query(collection(db, "budgets", uid, "transactions"), where("groupId", "==", groupId));
    const snap = await getDocs(qTx); // (OK pour ton usage; si besoin strict, utiliser tx.get)
    if (snap.empty || snap.size !== 2) throw new Error("Groupe de transfert introuvable");

    for (const d of snap.docs) {
      const isOut = d.data().amount < 0;
      const patch = {
        envelopeId: isOut ? fromId : toId,
        amount: isOut ? -abs : abs,
        note: isOut ? `${note ?? "Transfert"} → vers ${toId}` : `${note ?? "Transfert"} ← de ${fromId}`,
      };
      if (at instanceof Date) patch.at = at;
      tx.update(d.ref, patch);
    }
  });
}

export async function deleteTransfer(uid, groupId) {
  const qTx = query(collection(db, "budgets", uid, "transactions"), where("groupId", "==", groupId));
  const snap = await getDocs(qTx);
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}

// -------- Rollover (appelé au changement d’enveloppe / au chargement)
export async function rollEnvelopeIfNeeded(uid, envelope) {
  const { start, next } = getCurrentWindow(envelope, new Date());
  const now = new Date();
  if (now < next) return { changed: false, start, next };

  // Il faut avancer d’au moins un cycle : on calcule la somme des montants de la fenêtre écoulée.
  const txs = await getTransactionsForWindow(uid, envelope.id, start, next);
  const sum = txs.reduce((acc, t) => acc + (t.amount || 0), 0); // somme signée des montants
  const newCarry = (envelope.carry || 0) + (envelope.base || 0) + sum; // carry += base + net(montants)

  // Avance d’un cran (un seul cycle). Si tu veux rattraper plusieurs cycles, boucle.
  const envRef = doc(db, "budgets", uid, "envelopes", envelope.id);
  await updateDoc(envRef, { carry: newCarry, lastResetAt: next });

  return { changed: true, start: next, next: getCurrentWindow({ ...envelope, lastResetAt: next }, now).next };
}

// -------- Email / Password
export async function signUpWithEmail(email, password) {
  const { user } = await createUserWithEmailAndPassword(getAuth(), email, password);
  return user;
}

export async function signInWithEmail(email, password) {
  const { user } = await signInWithEmailAndPassword(getAuth(), email, password);
  return user;
}

export async function sendReset(email) {
  await sendPasswordResetEmail(getAuth(), email);
}

export async function linkAnonToEmail(email, password) {
  const auth = getAuth();
  const cred = EmailAuthProvider.credential(email, password);
  const { user } = await linkWithCredential(auth.currentUser, cred);
  return user;
}

export async function logout() {
  await signOut(getAuth());
}

// -------- Google
export async function signInWithGoogle({ redirectFallback = true } = {}) {
  const auth = getAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    const { user } = await signInWithPopup(auth, provider);
    return user;
  } catch (e) {
    if (redirectFallback && e?.code === "auth/popup-blocked") {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw e;
  }
}

export async function completeGoogleRedirect() {
  const auth = getAuth();
  const res = await getRedirectResult(auth);
  return res?.user ?? null;
}

export async function linkAnonToGoogle({ redirectFallback = true } = {}) {
  const auth = getAuth();
  const provider = new GoogleAuthProvider();
  try {
    const { user } = await linkWithPopup(auth.currentUser, provider);
    return user;
  } catch (e) {
    if (redirectFallback && e?.code === "auth/popup-blocked") {
      await linkWithRedirect(auth.currentUser, provider);
      return null;
    }
    throw e;
  }
}
