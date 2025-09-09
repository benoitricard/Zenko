import React, { useState, useEffect, useMemo } from "react";
import {
  auth, loginAnon, createEnvelope, getEnvelopes,
  updateEnvelope, deleteEnvelopeAndTransactions,
  updateTransaction, deleteTransaction,
  getTransferPair, updateTransfer, deleteTransfer,
  addTransaction, getTransactionsForWindow, transferBetweenEnvelopes, rollEnvelopeIfNeeded, signInWithEmail, signUpWithEmail, sendReset, logout, linkAnonToEmail,
  signInWithGoogle, completeGoogleRedirect, linkAnonToGoogle, swapEnvelopeOrder
} from "./lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getCurrentWindow } from "./lib/cycle";
import AmountModal from "./components/AmountModal";
import TransferModal from "./components/TransferModal";
import EnvelopeModal from "./components/EnvelopeModal";
import EmailAuthModal from "./components/EmailAuthModal";

/* =========================
   Helpers dates & formatage
   ========================= */

// Firestore Timestamp -> Date
const toDate = (at) => (at?.toDate ? at.toDate() : new Date(at));

/** Début de semaine (lundi 00:00:00) */
function startOfISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7; // 1..7 (lundi=1, dimanche=7)
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  return d;
}

/** Fin de semaine (dimanche 23:59:59.999) */
function endOfISOWeek(date) {
  const start = startOfISOWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Numéro de semaine ISO-8601 */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Jeudi de cette semaine
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/** Format long FR sans zéro sur le jour (ex: "1 septembre 2025") */
function formatLongFR(date) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

/** Jour avec zero-pad "01" */
function formatDay2(date) {
  return String(date.getDate()).padStart(2, "0");
}

/** Format relatif FR demandé */
function formatRelativeFR(date) {
  const now = new Date();
  // On compare en jours "civils"
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffMs = a - b;
  const diffDays = Math.round(diffMs / 86400000); // aujourd'hui = 0, hier = 1, etc.

  if (diffDays === 0) return "aujourd'hui";
  if (diffDays === 1) return "hier";
  if (diffDays > 1 && diffDays < 7) return `il y a ${diffDays} jours`;
  return formatLongFR(date);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [envelopes, setEnvelopes] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [modal, setModal] = useState(null); // "ENTREE" | "SORTIE" | "TRANSFERT" | "ENVELOPE"
  const [editTx, setEditTx] = useState(null);   // { tx } (transaction choisie)
  const [editEnv, setEditEnv] = useState(null); // { env }
  const [editTransfer, setEditTransfer] = useState(null);
  const [authModal, setAuthModal] = useState(null); // "signin" | "signup" | null
  const [isAnon, setIsAnon] = useState(false);

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setIsAnon(!!u && u.isAnonymous);
      setUser(u || null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    // au mount, si on revient d’un redirect Google
    completeGoogleRedirect().catch(() => {});
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

  async function handleGoogleLogin() {
    try {
      if (isAnon) {
        await linkAnonToGoogle(); // conserve enveloppes/transactions
      } else {
        await signInWithGoogle();
      }
    } catch (e) {
      if (e?.code === "auth/account-exists-with-different-credential") {
        alert("Un compte existe déjà avec cet e-mail via un autre fournisseur (ex: email/mot de passe). Connecte-toi avec celui-ci puis lie Google dans ton profil.");
      } else {
        alert(e.message || "Erreur de connexion Google");
      }
    }
  }

  const activeEnv = envelopes.find(e => e.id === activeId);
  const sum = transactions.reduce((a, t) => a + (t.amount || 0), 0);
  const available = ((activeEnv?.base || 0) + (activeEnv?.carry || 0) + sum) / 100;

  /* ================================
     Groupement des transactions par semaine (ISO)
     ================================ */
  const weeks = useMemo(() => {
    if (!transactions?.length) return [];
    const map = new Map();
    for (const t of transactions) {
      const d = toDate(t.at);
      const ws = startOfISOWeek(d);
      const key = ws.toISOString().slice(0, 10); // YYYY-MM-DD
      if (!map.has(key)) {
        map.set(key, { key, start: ws, items: [], total: 0 });
      }
      const bucket = map.get(key);
      bucket.items.push(t);
      bucket.total += t.amount || 0;
    }
    // Tri des semaines: récentes d'abord
    const arr = Array.from(map.values()).sort((a, b) => b.start - a.start);
    // Tri interne: transactions récentes d'abord
    for (const w of arr) {
      w.items.sort((a, b) => toDate(b.at) - toDate(a.at));
      w.isoWeek = getISOWeek(w.start);
      w.end = endOfISOWeek(w.start);
    }
    return arr;
  }, [transactions]);

  return (
    <div style={{ padding: 20 }}>
      <h1>Zenko Budget</h1>

      {!user && (
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <button onClick={() => setAuthModal("signin")}>Se connecter</button>
          <button onClick={() => setAuthModal("signup")}>Créer un compte</button>
          <button onClick={handleGoogleLogin} style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18" height="18" alt="" />
            Continuer avec Google
          </button>
        </div>
      )}

      {user && (
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <span style={{opacity:.8}}>Connecté {isAnon ? "(anonyme)" : ""}</span>
          <button onClick={logout}>Déconnexion</button>
        </div>
      )}

      {authModal && (
        <EmailAuthModal
          mode={authModal}
          allowLinkAnon={isAnon}
          onCancel={() => setAuthModal(null)}
          onReset={async (email) => {
            if (!email) return alert("Saisis ton e-mail d’abord");
            await sendReset(email);
            alert("E-mail de réinitialisation envoyé.");
          }}
          onSubmit={async (email, pwd) => {
            if (authModal === "signup") {
              if (isAnon) {
                await linkAnonToEmail(email, pwd);
              } else {
                await signUpWithEmail(email, pwd);
              }
            } else {
              await signInWithEmail(email, pwd);
            }
            setAuthModal(null);
          }}
        />
      )}

      {user && (
        <>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
  {envelopes.map((e, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === envelopes.length - 1;
    return (
      <div key={e.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {/* flèche gauche */}
        <button
          onClick={async () => {
            if (!user || isFirst) return;
            await swapEnvelopeOrder(user.uid, envelopes[idx - 1].id, e.id);
            const envs = await getEnvelopes(user.uid);
            setEnvelopes(envs);
          }}
          title="Déplacer à gauche"
          disabled={isFirst}
        >
          ⬅️
        </button>

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
          {e.name} · {(e.base / 100).toFixed(2)}€ · {e.period}
        </button>

        {/* flèche droite */}
        <button
          onClick={async () => {
            if (!user || isLast) return;
            await swapEnvelopeOrder(user.uid, e.id, envelopes[idx + 1].id);
            const envs = await getEnvelopes(user.uid);
            setEnvelopes(envs);
          }}
          title="Déplacer à droite"
          disabled={isLast}
        >
          ➡️
        </button>

        {/* modifier / supprimer */}
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
    );
  })}

  <button onClick={handleCreateEnvelope} style={{ padding: "8px 12px", borderRadius: 12 }}>
    + Enveloppe
  </button>
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
              onSubmit={async (valueCents, note, at) => {
                await addTransaction(user.uid, activeId, valueCents, note, at);
                await refreshActive();
                setModal(null);
              }}
            />
          )}
          {modal === "SORTIE" && (
            <AmountModal
              label={`Sortie · ${activeEnv?.name ?? ""}`}
              onCancel={() => setModal(null)}
              onSubmit={async (valueCents, note, at) => {
                await addTransaction(user.uid, activeId, -valueCents, note, at);
                await refreshActive();
                setModal(null);
              }}
            />
          )}
          {modal === "TRANSFERT" && (
            <TransferModal
              envelopes={envelopes}
              fromId={activeId}
              onCancel={() => setModal(null)}
              onSubmit={async ({ from, to, amount, note, at }) => {
                await transferBetweenEnvelopes(user.uid, from, to, amount, note, at);
                await refreshActive();
                setModal(null);
              }}
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
    initialAt={editTx.tx.at?.toDate ? editTx.tx.at.toDate() : editTx.tx.at}
    onCancel={() => setEditTx(null)}
    onSubmit={async (valueCents, note, at) => {
      const newAmount = editTx.type === "ENTREE" ? valueCents : -valueCents;
      await updateTransaction(user.uid, editTx.tx.id, { amount: newAmount, note, at });
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
      note: editTransfer.note,
      at: editTransfer.at
    }}
    onCancel={() => setEditTransfer(null)}
    onSubmit={async ({ from, to, amount, note, at }) => {
      await updateTransfer(user.uid, editTransfer.groupId, {
        fromId: from, toId: to, amount, note, at
      });
      setEditTransfer(null);
      await refreshActive();
    }}
  />
)}

          {/* ===========================
              Transactions par blocs/semaine
              =========================== */}
          <h2 style={{ marginTop: 20 }}>Transactions · {activeEnv?.name ?? ""}</h2>

          <div style={{ display: "grid", gap: 16 }}>
            {weeks.map(week => {
              const weekNumber = week.isoWeek;
              const start = week.start; // lundi
              const end = week.end;     // dimanche
              const startStr = formatLongFR(start).replace(/^\d+/, String(start.getDate())); // pas de zero-pad
              // "07" pour le jour de fin, comme ton exemple
              const endStr = `${formatDay2(end)} ${new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(end)} ${end.getFullYear()}`;

              return (
                <section key={week.key} style={{ border: "1px solid #2a3344", borderRadius: 12, padding: 12 }}>
                  <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>
                      {`Semaine ${weekNumber} - du ${startStr} au ${endStr}`}
                    </div>
                    <div style={{ opacity: .8 }}>
                      Total semaine : {(week.total / 100).toFixed(2)} €
                    </div>
                  </header>

                  <ul style={{ marginTop: 8 }}>
                    {week.items.map(t => (
                      <li key={t.id}>
                        <strong>{t.type}</strong> — {t.note} : {(t.amount / 100).toFixed(2)} €
                        {" · "}
                        {formatRelativeFR(toDate(t.at))}
                        <button
                          onClick={async () => {
                            if (t.groupId) {
                              const pair = await getTransferPair(user.uid, t.groupId);
                              const out = pair.out, inn = pair.inn;
                              setEditTransfer({
                                groupId: t.groupId,
                                fromId: out.envelopeId,
                                toId: inn.envelopeId,
                                amountCents: Math.abs(inn.amount),
                                note: (out.note || "").replace(/ →.*$/, "").replace(/ ←.*$/, "") || "Transfert",
                                at: out.at?.toDate ? out.at.toDate() : out.at
                              });
                            } else {
                              setEditTx({
                                tx: t,
                                type: t.amount >= 0 ? "ENTREE" : "SORTIE",
                                amountCents: Math.abs(t.amount),
                                note: t.note || ""
                              });
                            }
                          }}
                          title="Modifier"
                          style={{ marginLeft: 8 }}
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
                          style={{ marginLeft: 6 }}
                        >🗑️</button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}

            {/* Fallback si aucune transaction */}
            {weeks.length === 0 && (
              <div style={{ opacity: .8 }}>Aucune transaction dans cette période.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
