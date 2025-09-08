import React, { useState, useEffect } from "react";
import {
  auth, loginAnon, createEnvelope, getEnvelopes,
  addTransaction, getTransactionsByEnvelope, transferBetweenEnvelopes
} from "./lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import NumpadModal from "./components/NumpadModal";
import TransferModal from "./components/TransferModal";

export default function App() {
  const [user, setUser] = useState(null);
  const [envelopes, setEnvelopes] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [modal, setModal] = useState(null); // "ENTREE" | "SORTIE" | "TRANSFERT"

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const envs = await getEnvelopes(u.uid);
        setEnvelopes(envs);
        if (envs.length && !activeId) setActiveId(envs[0].id);
      } else {
        setEnvelopes([]); setActiveId(null); setTransactions([]);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user || !activeId) return;
    getTransactionsByEnvelope(user.uid, activeId).then(setTransactions);
  }, [user, activeId]);

  async function handleAddEnvelope() {
    if (!user) return;
    const name = prompt("Nom de l'enveloppe ?");
    if (!name) return;
    const limitStr = prompt("Plafond mensuel (€) ? (ex: 300)");
    const euros = Number(limitStr?.replace(",", "."));
    if (!Number.isFinite(euros) || euros <= 0) return alert("Montant invalide");
    try {
      await createEnvelope(user.uid, name, Math.round(euros * 100));
      const envs = await getEnvelopes(user.uid);
      setEnvelopes(envs);
      const created = envs.find(e => e.name === name && e.limit === Math.round(euros * 100));
      if (created) setActiveId(created.id);
      console.log("Enveloppe créée ✅");
    } catch (e) {
      console.error(e);
      alert(`Erreur création enveloppe: ${e.message}`);
    }
  }

  async function handleTransaction(type, amount, note) {
    if (!user || !activeId) return;
    try {
      if (type === "ENTREE") {
        await addTransaction(user.uid, activeId, amount, note);
      } else if (type === "SORTIE") {
        await addTransaction(user.uid, activeId, -amount, note);
      }
      setTransactions(await getTransactionsByEnvelope(user.uid, activeId));
    } catch (e) {
      console.error(e);
      alert(`Erreur transaction: ${e.message}`);
    } finally {
      setModal(null);
    }
  }

  async function handleTransfer({ from, to, amount, note }) {
    if (!user) return;
    if (!from || !to || from === to || amount <= 0) return;
    try {
      await transferBetweenEnvelopes(user.uid, from, to, amount, note);
      // rafraîchir les listes concernées
      if (activeId === from || activeId === to) {
        setTransactions(await getTransactionsByEnvelope(user.uid, activeId));
      }
    } catch (e) {
      console.error(e);
      alert(`Erreur transfert: ${e.message}`);
    } finally {
      setModal(null);
    }
  }

  const activeEnv = envelopes.find(e => e.id === activeId);
  const total = transactions.reduce((acc, t) => acc + t.amount, 0);
  const balance = ((activeEnv?.limit ?? 0) + total) / 100;

  return (
    <div style={{ padding: 20, fontFamily: "system-ui, -apple-system, Segoe UI" }}>
      <h1>Zenko Budget</h1>

      {!user && <button onClick={loginAnon}>Connexion anonyme</button>}
      {user && <button onClick={() => signOut(auth)}>Déconnexion</button>}

      {user && (
        <>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {envelopes.map(e => (
              <button
                key={e.id}
                onClick={() => setActiveId(e.id)}
                style={{
                  padding: "8px 12px", borderRadius: 12,
                  border: activeId === e.id ? "2px solid #00d084" : "1px solid #2a3344",
                  background: activeId === e.id ? "rgba(0,208,132,.12)" : "#111623",
                  color: "#e8ecf1"
                }}
              >
                {e.name} · {(e.limit / 100).toFixed(0)}€
              </button>
            ))}
            <button onClick={handleAddEnvelope} style={{ padding: "8px 12px", borderRadius: 12 }}>
              + Enveloppe
            </button>
          </div>

          <div style={{ margin: "16px 0", padding: 12, border: "1px solid #2a3344", borderRadius: 12 }}>
            <div style={{ opacity: .8, fontSize: 12 }}>Solde enveloppe</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{balance.toFixed(2)} €</div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setModal("ENTREE")}>Entrée</button>
            <button onClick={() => setModal("SORTIE")}>Sortie</button>
            <button onClick={() => setModal("TRANSFERT")} disabled={envelopes.length < 2}>Transfert</button>
          </div>

          {modal === "ENTREE" && (
            <NumpadModal
              label={`Entrée · ${activeEnv?.name ?? ""}`}
              onCancel={() => setModal(null)}
              onSubmit={(value, note) => handleTransaction("ENTREE", value, note)}
            />
          )}
          {modal === "SORTIE" && (
            <NumpadModal
              label={`Sortie · ${activeEnv?.name ?? ""}`}
              onCancel={() => setModal(null)}
              onSubmit={(value, note) => handleTransaction("SORTIE", value, note)}
            />
          )}
          {modal === "TRANSFERT" && (
            <TransferModal
              envelopes={envelopes}
              fromId={activeId}
              onCancel={() => setModal(null)}
              onSubmit={handleTransfer}
            />
          )}

          <h2 style={{ marginTop: 20 }}>Transactions · {activeEnv?.name ?? ""}</h2>
          <ul>
            {transactions.map(t => (
              <li key={t.id}>
                <strong>{t.type}</strong> — {t.note} : {(t.amount / 100).toFixed(2)} €
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
