import { useState } from "react";

export default function TransferModal({ envelopes, fromId, onSubmit, onCancel }) {
    const [value, setValue] = useState("0");
    const [note, setNote] = useState("Transfert");
    const [from, setFrom] = useState(fromId || (envelopes[0]?.id ?? ""));
    const [to, setTo] = useState(envelopes.find(e => e.id !== fromId)?.id ?? "");

    const press = (k) => {
        if (k === "C") return setValue("0");
        if (k === "←") return setValue(v => (v.length > 1 ? v.slice(0, -1) : "0"));
        setValue(v => (v === "0" ? k : v + k));
    };

    const euros = (parseInt(value, 10) || 0) / 100;

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", zIndex: 50 }}>
            <div style={{ width: "100%", maxWidth: 420, background: "#10151f", borderRadius: 20, padding: 16, color: "#e8ecf1" }}>
                <h2 style={{ marginTop: 0 }}>Transfert</h2>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                        <div style={{ fontSize: 12, opacity: .8, marginBottom: 4 }}>De</div>
                        <select value={from} onChange={e => {
                            setFrom(e.target.value);
                            if (e.target.value === to) {
                                const nextTo = envelopes.find(x => x.id !== e.target.value)?.id ?? "";
                                setTo(nextTo);
                            }
                        }} style={{ width: "100%" }}>
                            {envelopes.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <div style={{ fontSize: 12, opacity: .8, marginBottom: 4 }}>Vers</div>
                        <select value={to} onChange={e => setTo(e.target.value)} style={{ width: "100%" }}>
                            {envelopes.filter(e => e.id !== from).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                    </div>
                </div>

                <div style={{ fontSize: 32, textAlign: "right", marginBottom: 8 }}>{euros.toFixed(2)} €</div>
                <input
                    type="text" placeholder="Note" value={note}
                    onChange={(e) => setNote(e.target.value)}
                    style={{ width: "100%", padding: 8, marginBottom: 8 }}
                />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {"123456789".split("").map(n => <button key={n} onClick={() => press(n)}>{n}</button>)}
                    <button onClick={() => press("C")}>C</button>
                    <button onClick={() => press("0")}>0</button>
                    <button onClick={() => press("←")}>←</button>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={onCancel} style={{ flex: 1 }}>Annuler</button>
                    <button
                        style={{ flex: 2, background: "#00d084", color: "#003222" }}
                        onClick={() => onSubmit({ from, to, amount: parseInt(value, 10) || 0, note })}
                        disabled={!from || !to || from === to || (parseInt(value, 10) || 0) <= 0}
                    >
                        Valider
                    </button>
                </div>
            </div>
        </div>
    );
}
