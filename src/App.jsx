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
import CarrouselEnv from "./components/CarrouselEnv";

/* =========================
   Helpers dates, libellés & formatage
   ========================= */

// Firestore Timestamp -> Date
const toDate = (at) => (at?.toDate ? at.toDate() : new Date(at));

/** Lundi=1 … Dimanche=7 */
function jsDowTo1_7(dow0_6) { return dow0_6 === 0 ? 7 : dow0_6; }

/** Début de "semaine d’ancrage" (00:00) selon resetDow (1..7) */
function startOfAnchoredWeek(date, resetDow = 1) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const cur = jsDowTo1_7(d.getDay()); // 1..7
  const back = (cur - resetDow + 7) % 7;
  d.setDate(d.getDate() - back);
  return d;
}

/** Fin de "semaine d’ancrage" (23:59:59.999 au 7e jour) */
function endOfAnchoredWeek(date, resetDow = 1) {
  const start = startOfAnchoredWeek(date, resetDow);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Numéro de semaine ISO-8601 (lundi-based) */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/** Date FR longue (ex: "1 septembre 2025") */
function formatLongFR(date) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}
/** Day "01" */
function formatDay2(date) { return String(date.getDate()).padStart(2, "0"); }

/** Relatif FR : aujourd'hui / hier / il y a N jours / sinon date longue */
function formatRelativeFR(date) {
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((a - b) / 86400000);
  if (diffDays === 0) return "aujourd'hui";
  if (diffDays === 1) return "hier";
  if (diffDays > 1 && diffDays < 7) return `il y a ${diffDays} jours`;
  return formatLongFR(date);
}

/** Libellé FR pour la période */
function periodLabel(code) {
  switch (code) {
    case "monthly": return "Mensuel";
    case "weekly": return "Hebdomadaire";
    case "biweekly": return "Quinzomadaire";
    case "daily": return "Journalier";
    case "once": return "Unique";
    default: return code ?? "";
  }
}

/** Format US (1,234.56) pour des centimes */
const USD2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatCentsUS(cents) {
  const v = (cents || 0) / 100;
  return USD2.format(v);
}

/** Début de journée locale 00:00 */
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
/** Fin de journée locale 23:59:59.999 */
function endOfDay(date) {
  const d = startOfDay(date);
  d.setHours(23, 59, 59, 999);
  return d;
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
    completeGoogleRedirect().catch(() => { });
  }, []);

  const activeEnv = envelopes.find(e => e.id === activeId) || null;

  const USD2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function formatCentsUSSplit(cents) {
    const v = (cents || 0) / 100;
    const parts = USD2.formatToParts(v);
    let sign = "", intStr = "", decStr = "";
    for (const p of parts) {
      if (p.type === "minusSign") sign = p.value;               // "-"
      if (p.type === "integer" || p.type === "group") intStr += p.value; // "1,234"
      if (p.type === "decimal" || p.type === "fraction") decStr += p.value; // ".56"
    }
    return { int: sign + intStr, dec: decStr || ".00" };
  }

  async function refreshActive() {
    if (!user || !activeId) return;

    setTransactions([]); // évite d'afficher les anciennes txs si ça plante
    const currentId = activeId;

    try {
      // 1) récupérer l’enveloppe active
      let env = envelopes.find(e => e.id === currentId);
      if (!env) {
        const envs0 = await getEnvelopes(user.uid);
        setEnvelopes(envs0);
        env = envs0.find(e => e.id === currentId);
        if (!env) return;
      }

      // 2) Rollover (no-op pour "once" si tu as appliqué le patch côté firebase.js)
      await rollEnvelopeIfNeeded(user.uid, env);

      // 3) Recharger les enveloppes après rollover
      const envs1 = await getEnvelopes(user.uid);
      setEnvelopes(envs1);
      env = envs1.find(e => e.id === currentId);
      if (!env) return;

      // 4) Fenêtre courante
      const { start, next } = getCurrentWindow({ ...env, lastResetAt: env.lastResetAt }, new Date());

      // 5) IMPORTANT : pas de borne basse pour "once"
      const startForQuery = env.period === "once" ? null : start;
      const endForQuery = next ?? null;

      // 6) Charger les transactions
      const txs = await getTransactionsForWindow(user.uid, env.id, startForQuery, endForQuery);

      // 7) éviter les races si l’utilisateur a changé d’enveloppe
      if (activeId !== currentId) return;

      setTransactions(txs);
    } catch (e) {
      console.error("refreshActive failed:", e);
    }
  }

  useEffect(() => { refreshActive(); /* eslint-disable-next-line */ }, [user, activeId]);

  async function handleCreateEnvelope() { setModal("ENVELOPE"); }

  async function submitEnvelope(form) {
    if (!user) return;
    await createEnvelope(user.uid, form.name, form.base, form.period, {
      resetDow: form.resetDow, resetDom: form.resetDom
    });
    if (typeof form.nextBase === "number" && form.nextBase >= 0) {
      const envs0 = await getEnvelopes(user.uid);
      const created0 = envs0.find(e => e.name === form.name && e.base === form.base && e.period === form.period);
      if (created0) await updateEnvelope(user.uid, created0.id, { nextBase: form.nextBase });
    }
    const envs = await getEnvelopes(user.uid);
    setEnvelopes(envs);
    const created = envs.find(e => e.name === form.name && e.base === form.base && e.period === form.period);
    if (created) setActiveId(created.id);
    setModal(null);
  }

  async function handleTransaction(type, amount, note) {
    if (!user || !activeId || !activeEnv) return;
    if (type === "ENTREE") await addTransaction(user.uid, activeEnv.id, amount, note);
    if (type === "SORTIE") await addTransaction(user.uid, activeEnv.id, -amount, note);
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

  const sum = transactions.reduce((a, t) => a + (t.amount || 0), 0);
  const availableCents = (activeEnv?.base || 0) + (activeEnv?.carry || 0) + sum;
  const avail = formatCentsUSSplit(availableCents);

  /** Fenêtre courante (pour l’entête des blocs non-quotidiens) */
  const currentWindow = useMemo(() => {
    if (!activeEnv) return null;
    return getCurrentWindow({ ...activeEnv, lastResetAt: activeEnv.lastResetAt }, new Date());
  }, [activeEnv?.id, activeEnv?.lastResetAt, activeEnv?.period, activeEnv?.resetDow, activeEnv?.resetDom]);

  /* ===========================================================
     Groupement selon la périodicité de l’enveloppe active
     =========================================================== */
  const blocks = useMemo(() => {
    if (!activeEnv) return [];
    const period = activeEnv.period;

    // -- JOURNALIER : un bloc par jour
    if (period === "daily") {
      if (!transactions?.length) return [];
      const map = new Map(); // key YYYY-MM-DD
      for (const t of transactions) {
        const d = toDate(t.at);
        const s = startOfDay(d);
        const key = s.toISOString().slice(0, 10);
        if (!map.has(key)) map.set(key, { key, start: s, end: endOfDay(s), items: [], total: 0 });
        const b = map.get(key);
        b.items.push(t);
        b.total += t.amount || 0;
      }
      const arr = Array.from(map.values()).sort((a, b) => b.start - a.start);
      // tri des items (récents d’abord)
      for (const b of arr) b.items.sort((a, b) => toDate(b.at) - toDate(a.at));
      return arr.map(b => ({
        ...b,
        title: new Intl.DateTimeFormat("fr-FR", {
          weekday: "long", day: "numeric", month: "long", year: "numeric"
        }).format(b.start)
      }));
    }

    // -- HEBDOMADAIRE : un bloc aligné sur resetDow
    if (period === "weekly") {
      if (!transactions?.length || !currentWindow) return [];
      const resetDow = activeEnv.resetDow ?? 1; // 1..7
      const start = startOfAnchoredWeek(currentWindow.start, resetDow);
      const end = endOfAnchoredWeek(currentWindow.start, resetDow);
      const items = [...transactions].sort((a, b) => toDate(b.at) - toDate(a.at));
      const total = items.reduce((acc, t) => acc + (t.amount || 0), 0);
      const isoWeek = getISOWeek(start);
      const startStr = formatLongFR(start);
      const endStr = `${formatDay2(end)} ${new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(end)} ${end.getFullYear()}`;

      return [{
        key: start.toISOString().slice(0, 10),
        start, end, items, total,
        title: `Semaine ${isoWeek} - du ${startStr} au ${endStr}`
      }];
    }

    // -- QUINZOMADAIRE : bloc 2 semaines aligné resetDow (fenêtre courante)
    if (period === "biweekly") {
      if (!transactions?.length || !currentWindow) return [];
      const start = new Date(currentWindow.start);
      const end = new Date(currentWindow.next); end.setMilliseconds(end.getMilliseconds() - 1);
      const items = [...transactions].sort((a, b) => toDate(b.at) - toDate(a.at));
      const total = items.reduce((acc, t) => acc + (t.amount || 0), 0);
      const startStr = formatLongFR(start);
      const endStr = `${formatDay2(end)} ${new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(end)} ${end.getFullYear()}`;
      return [{
        key: start.toISOString().slice(0, 10),
        start, end, items, total,
        title: `Quinzomadaire - du ${startStr} au ${endStr}`
      }];
    }

    // -- MENSUEL : bloc du mois aligné resetDom (fenêtre courante)
    if (period === "monthly") {
      if (!transactions?.length || !currentWindow) return [];
      const start = new Date(currentWindow.start);
      const end = new Date(currentWindow.next); end.setMilliseconds(end.getMilliseconds() - 1);
      const items = [...transactions].sort((a, b) => toDate(b.at) - toDate(a.at));
      const total = items.reduce((acc, t) => acc + (t.amount || 0), 0);
      const startStr = formatLongFR(start);
      const endStr = `${formatDay2(end)} ${new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(end)} ${end.getFullYear()}`;
      return [{
        key: start.toISOString().slice(0, 10),
        start, end, items, total,
        title: `Mensuel - du ${startStr} au ${endStr}`
      }];
    }

    // -- UNIQUE : un bloc (pas de reset)
    if (period === "once") {
      const items = [...transactions].sort((a, b) => toDate(b.at) - toDate(a.at));
      const total = items.reduce((acc, t) => acc + (t.amount || 0), 0);
      const start = items.length ? startOfDay(toDate(items[items.length - 1].at)) : new Date();
      const end = items.length ? endOfDay(toDate(items[0].at)) : new Date();
      return [{
        key: "once",
        start, end, items, total,
        title: "Unique — en cours"
      }];
    }

    // fallback
    const items = [...transactions].sort((a, b) => toDate(b.at) - toDate(a.at));
    const total = items.reduce((acc, t) => acc + (t.amount || 0), 0);
    return [{ key: "default", start: new Date(), end: new Date(), items, total, title: "Transactions" }];
  }, [transactions, activeEnv, currentWindow]);

  return (
    <div className="app">
      {user &&
        <CarrouselEnv
          envelopes={envelopes}
          transactions={transactions}
          formatCentsUSSplit={formatCentsUSSplit}
        />
      }
      {/* <div className="app__body">
        <header className="header">
          <h1 className="header__title">
            {activeEnv?.name}
          </h1>
        </header>
        <div className="amount">
          <p className="amount__sum">
            {avail.int}
            <span className="amount__sum__dec">
              {avail.dec}
            </span>
            €
          </p>
          <p className="amount__text">
            Restants
            {(() => {
              switch (periodLabel(activeEnv?.period)) {
                case "Hebdomadaire": return " cette semaine";
                case "Quinzomadaire": return " ces deux semaines";
                case "Journalier": return " ce jour-ci";
                case "Mensuel": return " ce mois-ci";
                default: return "";
              }
            })()}
          </p>
        </div>
      </div> */}

      {!user && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setAuthModal("signin")}>Se connecter</button>
          <button onClick={() => setAuthModal("signup")}>Créer un compte</button>
          <button onClick={handleGoogleLogin} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18" height="18" alt="" />
            Continuer avec Google
          </button>
        </div>
      )}

      {user && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <span style={{ opacity: .8 }}>Connecté {isAnon ? "(anonyme)" : ""}</span>
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
                    {e.name} · {formatCentsUS(e.base)} € · {periodLabel(e.period)}
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
            <div style={{ fontSize: 28, fontWeight: 800 }}>{formatCentsUS(availableCents)} €</div>
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
                resetDom: editEnv.env.resetDom ?? 1,
                nextBase: typeof editEnv.env.nextBase === "number" ? editEnv.env.nextBase : null
              }}
              onCancel={() => setEditEnv(null)}
              onSubmit={async (form) => {
                await updateEnvelope(user.uid, editEnv.env.id, {
                  name: form.name,
                  base: form.base,
                  period: form.period,
                  resetDow: form.resetDow,
                  resetDom: form.resetDom,
                  ...(typeof form.nextBase === "number" ? { nextBase: form.nextBase } : { nextBase: null })
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

          {/* ============ Blocs de transactions selon périodicité ============ */}
          <h2 style={{ marginTop: 20 }}>Transactions · {activeEnv?.name ?? ""}</h2>

          <div style={{ display: "grid", gap: 16 }}>
            {blocks.map(block => (
              <section key={block.key} style={{ border: "1px solid #2a3344", borderRadius: 12, padding: 12 }}>
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700 }}>{block.title}</div>
                  <div style={{ opacity: .8 }}>Total : {formatCentsUS(block.total)} €</div>
                </header>

                <ul style={{ marginTop: 8 }}>
                  {block.items.map(t => (
                    <li key={t.id}>
                      <strong>{t.type}</strong> — {t.note} : {formatCentsUS(t.amount)} €
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
            ))}

            {blocks.length === 0 && (
              <div style={{ opacity: .8 }}>Aucune transaction dans cette période.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
