import { useEffect, useMemo, useRef, useState } from "react";

// Util: parse "12,34" ou "12.34" -> 1234 (centimes)
function parseToCents(v) {
    if (v == null) return 0;
    const s = String(v).trim().replace(/\s+/g, "");
    if (!s) return 0;
    // Remplace virgule par point pour parseFloat, garde les digits+ponctuation
    const norm = s.replace(",", ".").replace(/[^0-9.]/g, "");
    const n = Number.parseFloat(norm);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
}

export default function AmountModal({ label = "Montant", onSubmit, onCancel, initialCents = 0, initialNote = "" }) {
    const [amountStr, setAmountStr] = useState(initialCents ? (initialCents / 100).toString() : "");
    const [note, setNote] = useState(initialNote);
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const cents = useMemo(() => parseToCents(amountStr), [amountStr]);
    const valid = cents > 0;

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", zIndex: 60 }}>
            <div style={{ width: "100%", maxWidth: 420, background: "#10151f", borderRadius: 20, padding: 16, color: "#e8ecf1" }}>
                <h2 style={{ marginTop: 0 }}>{label}</h2>

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
                        onWheel={(e) => e.currentTarget.blur()} // évite le scroll qui modifie la valeur
                        style={{ padding: 10, borderRadius: 10, border: "1px solid #2a3344", background: "#0e1422", color: "#e8ecf1" }}
                    />
                </label>

                <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                    <span>Note</span>
                    <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="(optionnel)"
                        style={{ padding: 10, borderRadius: 10, border: "1px solid #2a3344", background: "#0e1422", color: "#e8ecf1" }}
                    />
                </label>

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={onCancel} style={{ flex: 1 }}>Annuler</button>
                    <button
                        onClick={() => onSubmit(cents, note)}
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
