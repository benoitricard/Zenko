import { useEffect, useMemo, useRef, useState } from "react";

function parseToCents(v) {
    const s = String(v ?? "").trim().replace(/\s+/g, "");
    if (!s) return 0;
    const norm = s.replace(",", ".").replace(/[^0-9.]/g, "");
    const n = Number.parseFloat(norm);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
}

const DOWS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"]; // (facultatif si tu affiches des jours)

export default function TransferModal({ envelopes, fromId, onSubmit, onCancel, initial }) {
    const [from, setFrom] = useState(initial?.fromId ?? fromId ?? (envelopes[0]?.id ?? ""));
    const [to, setTo] = useState(initial?.toId ?? envelopes.find(e => e.id !== fromId)?.id ?? "");
    const [amountStr, setAmountStr] = useState(initial?.amountCents ? (initial.amountCents / 100).toString() : "");
    const [note, setNote] = useState(initial?.note ?? "Transfert");
    const inputRef = useRef(null);
    useEffect(() => { inputRef.current?.focus(); }, []);

    useEffect(() => {
        if (from === to) {
            const nextTo = envelopes.find(x => x.id !== from)?.id ?? "";
            setTo(nextTo);
        }
    }, [from, to, envelopes]);

    const cents = useMemo(() => parseToCents(amountStr), [amountStr]);
    const valid = from && to && from !== to && cents > 0;

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", zIndex: 60 }}>
            <div style={{ width: "100%", maxWidth: 480, background: "#10151f", borderRadius: 20, padding: 16, color: "#e8ecf1" }}>
                <h2 style={{ marginTop: 0 }}>Transfert</h2>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                        <span>De</span>
                        <select value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: 10, borderRadius: 10, background: "#0e1422", color: "#e8ecf1", border: "1px solid #2a3344" }}>
                            {envelopes.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                        <span>Vers</span>
                        <select value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: 10, borderRadius: 10, background: "#0e1422", color: "#e8ecf1", border: "1px solid #2a3344" }}>
                            {envelopes.filter(e => e.id !== from).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                    </label>
                </div>

                <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                    <span>Montant (€)</span>
                    <input
                        ref={inputRef}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="0,00"
                        value={amountStr}
                        onChange={(e) => setAmountStr(e.target.value)}
                        onWheel={(e) => e.currentTarget.blur()}
                        style={{ padding: 10, borderRadius: 10, border: "1px solid #2a3344", background: "#0e1422", color: "#e8ecf1" }}
                    />
                </label>

                <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                    <span>Note</span>
                    <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        style={{ padding: 10, borderRadius: 10, border: "1px solid #2a3344", background: "#0e1422", color: "#e8ecf1" }}
                    />
                </label>

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={onCancel} style={{ flex: 1 }}>Annuler</button>
                    <button
                        onClick={() => valid && onSubmit({ from, to, amount: cents, note })}
                        disabled={!valid}
                        style={{ flex: 2, background: "#00d084", color: "#003222" }}
                    >
                        Valider
                    </button>
                </div>
            </div>
        </div>
    );
}
