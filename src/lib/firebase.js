// src/lib/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, connectAuthEmulator } from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator,
  addDoc, collection, getDocs, query, where, orderBy,
  runTransaction, doc, serverTimestamp
} from "firebase/firestore";

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

// ---- Helpers ----
export async function loginAnon() {
  const { user } = await signInAnonymously(auth);
  return user;
}

export async function createEnvelope(uid, name, limit) {
  // crée un doc dans budgets/{uid}/envelopes
  await addDoc(collection(db, "budgets", uid, "envelopes"), {
    name,
    limit,                     // en centimes
    createdAt: serverTimestamp()
  });
}

export async function getEnvelopes(uid) {
  // simple get (pas d'orderBy pour éviter d'exiger un index tant que c'est le début)
  const snap = await getDocs(collection(db, "budgets", uid, "envelopes"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addTransaction(uid, envelopeId, amount, note = "") {
  return await addDoc(collection(db, "budgets", uid, "transactions"), {
    envelopeId,
    amount,                    // + = entrée, - = sortie
    note,
    type: amount >= 0 ? "ENTRÉE" : "SORTIE",
    at: serverTimestamp(),
    createdAt: serverTimestamp()
  });
}

export async function getTransactionsByEnvelope(uid, envelopeId) {
  const q = query(
    collection(db, "budgets", uid, "transactions"),
    where("envelopeId", "==", envelopeId),
    orderBy("at", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function transferBetweenEnvelopes(uid, fromId, toId, amount, note = "Transfert") {
  // amount en centimes (positif). On écrit 2 docs : OUT puis IN, de manière atomique.
  const abs = Math.abs(amount);
  await runTransaction(db, async (transaction) => {
    const txCol = collection(db, "budgets", uid, "transactions");

    const outRef = doc(txCol); // auto-id
    transaction.set(outRef, {
      envelopeId: fromId,
      amount: -abs,
      type: "TRANSFERT_OUT",
      note: `${note} → vers ${toId}`,
      at: serverTimestamp(),
      createdAt: serverTimestamp()
    });

    const inRef = doc(txCol);  // auto-id
    transaction.set(inRef, {
      envelopeId: toId,
      amount: abs,
      type: "TRANSFERT_IN",
      note: `${note} ← de ${fromId}`,
      at: serverTimestamp(),
      createdAt: serverTimestamp()
    });
  });
}
