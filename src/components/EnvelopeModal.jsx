import { useState, useMemo } from "react";

const DOWS = [
    { v: 1, label: "Lundi" }, { v: 2, label: "Mardi" }, { v: 3, label: "Mercredi" },
    { v: 4, label: "Jeudi" }, { v: 5, label: "Vendredi" }, { v: 6, label: "Samedi" }, { v: 0, label: "Dimanche" },
];

export default function EnvelopeModal({ onCancel, onSubmit, initial }) {
    const [name, setName] = useState(initial?.name || "");
    const [euros, setEuros] = useState(initial?.base ? (initial.base / 100).toString() : "100");
    const [period, setPeriod] = useState(initial?.period || "monthly");
    const [resetDow, setResetDow] = useState(initial?.resetDow ?? 1);
    const [resetDom, setResetDom] = useState(initial?.resetDom ?? 1);

    const showDow = period === "weekly" || period === "biweekly";
    const showDom = period === "monthly";

    const valid = useMemo(() => {
        const n = parseFloat(euros.replace(",", "."));
        if (!name.trim() || !Number.isFinite(n) || n <= 0) return false;
        if (showDow && (resetDow < 0 || resetDow > 6)) return false;
        if (showDom && (resetDom < 1 || resetDom > 31)) return false;
        return true;
    }, [name, euros, period, resetDow, resetDom, showDow, showDom]);

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", zIndex: 60 }}>
            <div style={{ width: "100%", maxWidth: 480, background: "#10151f", borderRadius: 20, padding: 16, color: "#e8ecf1" }}>
                <h2 style={{ marginTop: 0 }}>{initial ? "Modifier l’enveloppe" : "Nouvelle enveloppe"}</h2>

                <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                    <span>Nom</span>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Courses" />
                </label>

                <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                    <span>Montant de base (€)</span>
                    <input value={euros} onChange={e => setEuros(e.target.value)} inputMode="decimal" />
                </label>

                <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                    <span>Périodicité</span>
                    <select value={period} onChange={e => setPeriod(e.target.value)}>
                        <option value="monthly">Mensuel</option>
                        <option value="biweekly">Bi-hebdomadaire (toutes les 2 semaines)</option>
                        <option value="weekly">Hebdomadaire</option>
                        <option value="daily">Journalier</option>
                        <option value="once">Unique</option>
                    </select>
                </label>

                {showDow && (
                    <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                        <span>Jour de reset (semaine)</span>
                        <select value={resetDow} onChange={e => setResetDow(parseInt(e.target.value, 10))}>
                            {DOWS.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
                        </select>
                    </label>
                )}

                {showDom && (
                    <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                        <span>Jour de reset (mois)</span>
                        <select value={resetDom} onChange={e => setResetDom(parseInt(e.target.value, 10))}>
                            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </label>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={onCancel} style={{ flex: 1 }}>Annuler</button>
                    <button
                        style={{ flex: 2, background: "#00d084", color: "#003222" }}
                        disabled={!valid}
                        onClick={() => {
                            const cents = Math.round(parseFloat(euros.replace(",", ".")) * 100);
                            onSubmit({
                                name: name.trim(),
                                base: cents,
                                period,
                                resetDow: showDow ? resetDow : null,
                                resetDom: showDom ? resetDom : null
                            });
                        }}
                    >
                        Valider
                    </button>
                </div>
            </div>
        </div>
    );
}
