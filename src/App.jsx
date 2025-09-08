import React, { useState, useEffect } from "react";
import {
  auth, loginAnon, createEnvelope, getEnvelopes,
  updateEnvelope, deleteEnvelopeAndTransactions,
  updateTransaction, deleteTransaction,
  getTransferPair, updateTransfer, deleteTransfer,
  addTransaction, getTransactionsForWindow, transferBetweenEnvelopes, rollEnvelopeIfNeeded
} from "./lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getCurrentWindow } from "./lib/cycle";
import AmountModal from "./components/AmountModal";
import TransferModal from "./components/TransferModal";
import EnvelopeModal from "./components/EnvelopeModal";

export default function App() {
  const [user, setUser] = useState(null);
  const [envelopes, setEnvelopes] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [modal, setModal] = useState(null); // "ENTREE" | "SORTIE" | "TRANSFERT" | "ENVELOPE"
  const [editTx, setEditTx] = useState(null);   // { tx } (transaction choisie)
  const [editEnv, setEditEnv] = useState(null); // { env }
  const [editTransfer, setEditTransfer] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) { setEnvelopes([]); setActiveId(null); setTransactions([]); return; }
      const envs = await getEnvelopes(u.uid);
      setEnvelopes(envs);
      if (envs.length && !activeId) setActiveId(envs[0].id);
    });
    return () => unsub();
  }, []);

  async function refreshActive() {
    if (!user || !activeId) return;
    const env = envelopes.find(e => e.id === activeId);
    if (!env) return;
    // Rollover si besoin (avance 1 cycle max — suffisant en usage normal)
    await rollEnvelopeIfNeeded(user.uid, env);
    // Fenêtre courante
    const { start, next } = getCurrentWindow({ ...env, lastResetAt: env.lastResetAt }, new Date());
    const txs = await getTransactionsForWindow(user.uid, env.id, start, next);
    setTransactions(txs);
    // rafraîchir l’enveloppe (carry/lastResetAt peuvent avoir changé)
    const envs = await getEnvelopes(user.uid);
    setEnvelopes(envs);
  }

  useEffect(() => { refreshActive(); /* eslint-disable-next-line */ }, [user, activeId]);

  async function handleCreateEnvelope() {
    setModal("ENVELOPE");
  }
  async function submitEnvelope(form) {
    if (!user) return;
    await createEnvelope(user.uid, form.name, form.base, form.period, { resetDow: form.resetDow, resetDom: form.resetDom });
    const envs = await getEnvelopes(user.uid);
    setEnvelopes(envs);
    const created = envs.find(e => e.name === form.name && e.base === form.base && e.period === form.period);
    if (created) setActiveId(created.id);
    setModal(null);
  }

  async function handleTransaction(type, amount, note) {
    if (!user || !activeId) return;
    const env = envelopes.find(e => e.id === activeId);
    if (!env) return;
    if (type === "ENTREE") await addTransaction(user.uid, env.id, amount, note);
    if (type === "SORTIE") await addTransaction(user.uid, env.id, -amount, note);
    await refreshActive();
    setModal(null);
  }

  async function handleTransfer(payload) {
    if (!user) return;
    await transferBetweenEnvelopes(user.uid, payload.from, payload.to, payload.amount, payload.note);
    await refreshActive();
  }

  const activeEnv = envelopes.find(e => e.id === activeId);
  const sum = transactions.reduce((a, t) => a + (t.amount || 0), 0);
  const available = ((activeEnv?.base || 0) + (activeEnv?.carry || 0) + sum) / 100;

  return (
    <div style={{ padding: 20 }}>
      <h1>Zenko Budget</h1>
      {!user && <button onClick={loginAnon}>Connexion anonyme</button>}
      {user && <button onClick={() => signOut(auth)}>Déconnexion</button>}

      {user && (
        <>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {envelopes.map(e => (
              <div key={e.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {/* bouton principal : active l’enveloppe */}
                <button
                  onClick={() => setActiveId(e.id)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 12,
                    border: activeId === e.id ? "2px solid #00d084" : "1px solid #2a3344",
                    background: activeId === e.id ? "rgba(0,208,132,.12)" : "#111623",
                    color: "#e8ecf1"
                  }}
                >
                  {e.name} · {(e.base / 100).toFixed(0)}€ · {e.period}
                </button>

                {/* boutons modifier / supprimer */}
                <button onClick={() => setEditEnv({ env: e })} title="Modifier">✏️</button>
                <button
                  onClick={async () => {
                    if (confirm(`Supprimer l’enveloppe "${e.name}" et toutes ses transactions ?`)) {
                      await deleteEnvelopeAndTransactions(user.uid, e.id);
                      const envs = await getEnvelopes(user.uid);
                      setEnvelopes(envs);
                      if (activeId === e.id) setActiveId(envs[0]?.id ?? null);
                      await refreshActive();
                    }
                  }}
                  title="Supprimer"
                >
                  🗑️
                </button>
              </div>
            ))}

            <button onClick={handleCreateEnvelope} style={{ padding: "8px 12px", borderRadius: 12 }}>+ Enveloppe</button>
          </div>

          <div style={{ margin: "16px 0", padding: 12, border: "1px solid #2a3344", borderRadius: 12 }}>
            <div style={{ opacity: .8, fontSize: 12 }}>Disponible (base + report ± mouvements période)</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{available.toFixed(2)} €</div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setModal("ENTREE")} disabled={!activeEnv}>Entrée</button>
            <button onClick={() => setModal("SORTIE")} disabled={!activeEnv}>Sortie</button>
            <button onClick={() => setModal("TRANSFERT")} disabled={envelopes.length < 2}>Transfert</button>
          </div>

          {modal === "ENTREE" && (
            <AmountModal
              label={`Entrée · ${activeEnv?.name ?? ""}`}
              onCancel={() => setModal(null)}
              onSubmit={(valueCents, note) => handleTransaction("ENTREE", valueCents, note)}
            />
          )}
          {modal === "SORTIE" && (
            <AmountModal
              label={`Sortie · ${activeEnv?.name ?? ""}`}
              onCancel={() => setModal(null)}
              onSubmit={(valueCents, note) => handleTransaction("SORTIE", valueCents, note)}
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
          {modal === "ENVELOPE" && <EnvelopeModal onCancel={() => setModal(null)} onSubmit={submitEnvelope} />}
          {editEnv && (
            <EnvelopeModal
              initial={{
                name: editEnv.env.name,
                base: editEnv.env.base,
                period: editEnv.env.period,
                resetDow: editEnv.env.resetDow ?? 1,
                resetDom: editEnv.env.resetDom ?? 1
              }}
              onCancel={() => setEditEnv(null)}
              onSubmit={async (form) => {
                await updateEnvelope(user.uid, editEnv.env.id, {
                  name: form.name, base: form.base, period: form.period,
                  resetDow: form.resetDow, resetDom: form.resetDom
                });
                setEditEnv(null);
                const envs = await getEnvelopes(user.uid);
                setEnvelopes(envs);
                await refreshActive();
              }}
            />
          )}
          {/* Édition Entrée/Sortie */}
          {editTx && (
            <AmountModal
              label={`${editTx.type === "ENTREE" ? "Modifier entrée" : "Modifier sortie"}`}
              initialCents={editTx.amountCents}
              initialNote={editTx.note}
              onCancel={() => setEditTx(null)}
              onSubmit={async (valueCents, note) => {
                const newAmount = editTx.type === "ENTREE" ? valueCents : -valueCents;
                await updateTransaction(user.uid, editTx.tx.id, { amount: newAmount, note });
                setEditTx(null);
                await refreshActive();
              }}
            />
          )}

          {/* Édition Transfert */}
          {editTransfer && (
            <TransferModal
              envelopes={envelopes}
              fromId={editTransfer.fromId}
              initial={{
                fromId: editTransfer.fromId,
                toId: editTransfer.toId,
                amountCents: editTransfer.amountCents,
                note: editTransfer.note
              }}
              onCancel={() => setEditTransfer(null)}
              onSubmit={async ({ from, to, amount, note }) => {
                await updateTransfer(user.uid, editTransfer.groupId, {
                  fromId: from, toId: to, amount, note
                });
                setEditTransfer(null);
                await refreshActive();
              }}
            />
          )}

          <h2 style={{ marginTop: 20 }}>Transactions · {activeEnv?.name ?? ""}</h2>
          <ul>
            {transactions.map(t => (
              <li key={t.id}>
                <strong>{t.type}</strong> — {t.note} : {(t.amount / 100).toFixed(2)} €
                {" "}
                <button
                  onClick={async () => {
                    if (t.groupId) {
                      // Édition d’un transfert
                      const pair = await getTransferPair(user.uid, t.groupId);
                      const out = pair.out, inn = pair.inn;
                      setEditTransfer({
                        groupId: t.groupId,
                        fromId: out.envelopeId,
                        toId: inn.envelopeId,
                        amountCents: Math.abs(inn.amount),
                        note: (out.note || "").replace(/ →.*$/, "").replace(/ ←.*$/, "") || "Transfert"
                      });
                    } else {
                      // Édition d’une entrée/sortie
                      setEditTx({
                        tx: t,
                        type: t.amount >= 0 ? "ENTREE" : "SORTIE",
                        amountCents: Math.abs(t.amount),
                        note: t.note || ""
                      });
                    }
                  }}
                  title="Modifier"
                >✏️</button>
                <button
                  onClick={async () => {
                    if (t.groupId) {
                      if (confirm("Supprimer ce transfert (les 2 mouvements) ?")) {
                        await deleteTransfer(user.uid, t.groupId);
                        await refreshActive();
                      }
                    } else {
                      if (confirm("Supprimer cette transaction ?")) {
                        await deleteTransaction(user.uid, t.id);
                        await refreshActive();
                      }
                    }
                  }}
                  title="Supprimer"
                >🗑️</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
