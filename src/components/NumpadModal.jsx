import { useState } from "react";

export default function NumpadModal({ onSubmit, onCancel, label }) {
    const [value, setValue] = useState("0");
    const [note, setNote] = useState("");

    const press = (k) => {
        if (k === "C") return setValue("0");
        if (k === "←") return setValue((v) => (v.length > 1 ? v.slice(0, -1) : "0"));
        setValue((v) => (v === "0" ? k : v + k));
    };

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center" }}>
            <div style={{ width: "100%", maxWidth: 400, background: "#10151f", borderRadius: 20, padding: 16, color: "white" }}>
                <h2>{label}</h2>
                <div style={{ fontSize: 32, textAlign: "right", marginBottom: 8 }}>
                    {parseInt(value, 10) / 100} €
                </div>
                <input
                    type="text"
                    placeholder="Note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    style={{ width: "100%", padding: 8, marginBottom: 8 }}
                />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {"123456789".split("").map(n => (
                        <button key={n} onClick={() => press(n)}>{n}</button>
                    ))}
                    <button onClick={() => press("C")}>C</button>
                    <button onClick={() => press("0")}>0</button>
                    <button onClick={() => press("←")}>←</button>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={onCancel} style={{ flex: 1 }}>Annuler</button>
                    <button
                        onClick={() => onSubmit(parseInt(value, 10) || 0, note)}
                        style={{ flex: 2, background: "#00d084", color: "#003222" }}
                    >
                        Valider
                    </button>
                </div>
            </div>
        </div>
    );
}
