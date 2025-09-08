import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, connectAuthEmulator } from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator, addDoc, collection, getDocs, query,
  where, orderBy, runTransaction, doc, serverTimestamp, updateDoc, deleteDoc
} from "firebase/firestore";
import { computeInitialLastResetAt, getCurrentWindow } from "./cycle";

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

if (import.meta.env.DEV) {
  connectAuthEmulator(auth, "http://localhost:9099");
  connectFirestoreEmulator(db, "localhost", 8080);
}

// -------- Auth
export async function loginAnon() {
  const { user } = await signInAnonymously(auth);
  return user;
}

// -------- Enveloppes
export async function createEnvelope(uid, name, baseLimit, period = "monthly", opts = {}) {
  const lastResetAt = computeInitialLastResetAt(period, { resetDow: opts.resetDow ?? 1, resetDom: opts.resetDom ?? 1 });
  await addDoc(collection(db, "budgets", uid, "envelopes"), {
    name,
    base: baseLimit,               // montant de base (centimes)
    carry: 0,                      // cumul des reports
    period,                        // "monthly" | "weekly" | "biweekly" | "daily" | "once"
    resetDow: opts.resetDow ?? null, // 0..6 si weekly/biweekly
    resetDom: opts.resetDom ?? null, // 1..31 si monthly
    lastResetAt,
    createdAt: serverTimestamp()
  });
}

export async function updateEnvelope(uid, envelopeId, patch) {
  await updateDoc(doc(db, "budgets", uid, "envelopes", envelopeId), {
    ...patch
  });
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
  const snap = await getDocs(collection(db, "budgets", uid, "envelopes"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// -------- Transactions
export async function addTransaction(uid, envelopeId, amount, note = "") {
  return await addDoc(collection(db, "budgets", uid, "transactions"), {
    envelopeId,
    amount,          // + entrée, - sortie (centimes)
    note,
    type: amount >= 0 ? "ENTRÉE" : "SORTIE",
    at: new Date(),
    createdAt: serverTimestamp()
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
  await updateDoc(doc(db, "budgets", uid, "transactions", txId), { ...patch });
}

export async function deleteTransaction(uid, txId) {
  await deleteDoc(doc(db, "budgets", uid, "transactions", txId));
}

// --- Transferts : on relie les 2 écritures avec un groupId ---
function newId(path) { return doc(collection(db, path)).id; }

export async function transferBetweenEnvelopes(uid, fromId, toId, amount, note = "Transfert") {
  const abs = Math.abs(amount);
  const groupId = newId(`budgets/${uid}/transactions`); // même id de groupe pour les 2 lignes
  await runTransaction(db, async (tx) => {
    const col = collection(db, "budgets", uid, "transactions");
    const outRef = doc(col);
    const inRef  = doc(col);
    tx.set(outRef, {
      groupId, envelopeId: fromId, amount: -abs, type: "TRANSFERT_OUT",
      note: `${note} → vers ${toId}`, at: new Date(), createdAt: serverTimestamp()
    });
    tx.set(inRef,  {
      groupId, envelopeId: toId,   amount:  abs, type: "TRANSFERT_IN",
      note: `${note} ← de ${fromId}`, at: new Date(), createdAt: serverTimestamp()
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

export async function updateTransfer(uid, groupId, { fromId, toId, amount, note }) {
  const abs = Math.abs(amount);
  await runTransaction(db, async (tx) => {
    const qTx = query(collection(db, "budgets", uid, "transactions"), where("groupId", "==", groupId));
    const snap = await getDocs(qTx);
    if (snap.empty || snap.size !== 2) throw new Error("Groupe de transfert introuvable");
    for (const d of snap.docs) {
      const isOut = d.data().amount < 0;
      tx.update(d.ref, {
        envelopeId: isOut ? fromId : toId,
        amount: isOut ? -abs : abs,
        note: isOut ? `${note} → vers ${toId}` : `${note} ← de ${fromId}`,
        // garde 'type', met à jour la date d'édition si tu veux un champ updatedAt:
      });
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
  // Pour "once" et "daily", pas de rollover accumulatif (daily repart à 0 chaque jour mais carry reste géré par ici si tu veux)
  const { start, next } = getCurrentWindow(envelope, new Date());
  const now = new Date();
  if (now < next) return { changed: false, start, next };

  // Il faut avancer d’au moins un cycle : on calcule la somme des montants de la fenêtre écoulée.
  const txs = await getTransactionsForWindow(uid, envelope.id, start, next);
  const sum = txs.reduce((acc, t) => acc + (t.amount || 0), 0); // somme signée des montants
  const newCarry = (envelope.carry || 0) + (envelope.base || 0) + sum; // carry += base + net(montants)

  // Avance la *dernière* borne d’un cran (un seul cycle). Si tu veux rattraper plusieurs cycles, boucle.
  const envRef = doc(db, "budgets", uid, "envelopes", envelope.id);
  await updateDoc(envRef, { carry: newCarry, lastResetAt: next });

  return { changed: true, start: next, next: getCurrentWindow({ ...envelope, lastResetAt: next }, now).next };
}
