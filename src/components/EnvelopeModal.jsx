import { useMemo, useState } from "react";

// Parse "1,234.56" / "1234.56" / "1234,56" -> 123456 (centimes)
function parseToCents(v) {
    if (v == null) return 0;
    let s = String(v).trim();
    if (!s) return 0;
    s = s.replace(/\s+/g, "");
    if (s.includes(".")) {
        // US: "." = décimales → supprimer les virgules de millier
        s = s.replace(/,/g, "");
    } else if (s.includes(",")) {
        // EU: "," = décimales → convertir en "."
        // (tous les "," deviennent ".": suffisant ici)
        s = s.replace(/,/g, ".");
    }
    s = s.replace(/[^0-9.]/g, "");
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
}

// Garde uniquement digits + un seul point (format brut US, sans milliers)
function normalizeUSRaw(input) {
    if (input == null) return "";
    let s = String(input).trim().replace(/\s+/g, "");
    // retirer toutes les virgules (elles servent uniquement à l'affichage)
    s = s.replace(/,/g, "");
    // digits et points seulement
    s = s.replace(/[^0-9.]/g, "");
    // un seul point max
    const firstDot = s.indexOf(".");
    if (firstDot !== -1) {
        s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    }
    return s;
}

// Ajoute les virgules de milliers, conserve les décimales telles que saisies
function formatUS(value) {
    const raw = normalizeUSRaw(value);
    if (!raw) return "";
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return "";
    const [intPart, decPart] = n.toFixed(2).split(".");
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${intFormatted}.${decPart}`;
}

// Libellés FR -> codes internes
const PERIODS = [
    { label: "Mensuel", code: "monthly" },
    { label: "Hebdomadaire", code: "weekly" },
    { label: "Quinzomadaire", code: "biweekly" },
    { label: "Journalier", code: "daily" },
    { label: "Unique", code: "once" },
];

// Lundi=1 … Dimanche=7 (cohérent avec ton default resetDow=1)
const DOWS = [
    { label: "Lundi", value: 1 },
    { label: "Mardi", value: 2 },
    { label: "Mercredi", value: 3 },
    { label: "Jeudi", value: 4 },
    { label: "Vendredi", value: 5 },
    { label: "Samedi", value: 6 },
    { label: "Dimanche", value: 7 },
];

const DAYS_IN_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

export default function EnvelopeModal({
    initial = {
        name: "",
        base: 0,            // centimes
        period: "weekly",   // "monthly" | "weekly" | "biweekly" | "daily" | "once"
        resetDow: 1,        // 1..7 (Lundi..Dimanche) — pour weekly/biweekly
        resetDom: 1,        // 1..31 — pour monthly
        nextBase: null,     // centimes ou null (optionnel)
    },
    onSubmit,
    onCancel,
}) {
    const [name, setName] = useState(initial.name || "");
    const [baseStr, setBaseStr] = useState(
        initial.base ? formatUS((initial.base / 100).toFixed(2)) : ""
    );

    // période en code interne
    const [period, setPeriod] = useState(initial.period || "weekly");

    // sélecteurs de reset
    const [resetDow, setResetDow] = useState(
        typeof initial.resetDow === "number" ? initial.resetDow : 1
    );
    const [resetDom, setResetDom] = useState(
        typeof initial.resetDom === "number" ? initial.resetDom : 1
    );

    // prochain budget (au prochain reset) — optionnel
    const [nextBaseStr, setNextBaseStr] = useState(
        typeof initial.nextBase === "number" && initial.nextBase >= 0
            ? formatUS((initial.nextBase / 100).toFixed(2))
            : ""
    );

    const base = useMemo(() => parseToCents(baseStr), [baseStr]);
    const nextBase = useMemo(
        () => (nextBaseStr.trim() ? parseToCents(nextBaseStr) : null),
        [nextBaseStr]
    );
    const valid = name.trim().length > 0 && base > 0;

    const isMonthly = period === "monthly";
    const isWeeklyLike = period === "weekly" || period === "biweekly";
    // daily/once → pas de sélecteurs

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", zIndex: 60 }}>
            <div style={{ width: "100%", maxWidth: 540, background: "#10151f", borderRadius: 20, padding: 16, color: "#e8ecf1" }}>
                <h2 style={{ marginTop: 0 }}>{initial?.name ? "Modifier l’enveloppe" : "Nouvelle enveloppe"}</h2>

                {/* Nom */}
                <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                    <span>Nom</span>
                    <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        style={{ padding: 10, borderRadius: 10, border: "1px solid #2a3344", background: "#0e1422", color: "#e8ecf1" }}
                    />
                </label>

                {/* Budget courant & prochain budget */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                        <span>Budget courant (€ / période)</span>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={baseStr}
                            onFocus={() => setBaseStr(normalizeUSRaw(baseStr))}     // on édite la valeur brute (sans virgules)
                            onChange={(e) => setBaseStr(normalizeUSRaw(e.target.value))}
                            onBlur={() => setBaseStr(formatUS(baseStr))}            // on réapplique le format US
                            style={{ padding: 10, borderRadius: 10, border: "1px solid #2a3344", background: "#0e1422", color: "#e8ecf1" }}
                        />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                        <span>Prochain budget (appliqué au prochain reset) — optionnel</span>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="e.g. 85.00"
                            value={nextBaseStr}
                            onFocus={() => setNextBaseStr(normalizeUSRaw(nextBaseStr))}
                            onChange={(e) => setNextBaseStr(normalizeUSRaw(e.target.value))}
                            onBlur={() => setNextBaseStr(formatUS(nextBaseStr))}
                            style={{ padding: 10, borderRadius: 10, border: "1px solid #2a3344", background: "#0e1422", color: "#e8ecf1" }}
                        />
                    </label>
                </div>

                {/* Périodicité (FR) */}
                <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                    <span>Périodicité</span>
                    <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        style={{ padding: 10, borderRadius: 10, background: "#0e1422", color: "#e8ecf1", border: "1px solid #2a3344" }}
                    >
                        {PERIODS.map(p => (
                            <option key={p.code} value={p.code}>{p.label}</option>
                        ))}
                    </select>
                </label>

                {/* Mensuel : jour du mois */}
                {isMonthly && (
                    <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                        <span>Jour de reset du mois</span>
                        <select
                            value={resetDom}
                            onChange={e => setResetDom(Number(e.target.value))}
                            style={{ padding: 10, borderRadius: 10, background: "#0e1422", color: "#e8ecf1", border: "1px solid #2a3344" }}
                        >
                            {DAYS_IN_MONTH.map(d => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>
                        <small style={{ opacity: .75 }}>
                            Astuce : si le mois n’a pas ce jour (ex. 31), on prend le dernier jour disponible (ex. 30 ou 28/29 en février).
                        </small>
                    </label>
                )}

                {/* Hebdo / Quinzomadaire : jour de la semaine */}
                {isWeeklyLike && (
                    <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                        <span>Jour de reset</span>
                        <select
                            value={resetDow}
                            onChange={e => setResetDow(Number(e.target.value))}
                            style={{ padding: 10, borderRadius: 10, background: "#0e1422", color: "#e8ecf1", border: "1px solid #2a3344" }}
                        >
                            {DOWS.map(d => (
                                <option key={d.value} value={d.value}>{d.label}</option>
                            ))}
                        </select>
                        <small style={{ opacity: .75 }}>
                            Pour Quinzomadaire, le reset se fait un {DOWS.find(d => d.value === resetDow)?.label?.toLowerCase() ?? "jour choisi"} sur deux.
                        </small>
                    </label>
                )}

                {/* Journalier / Unique : aucun sélecteur supplémentaire */}

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={onCancel} style={{ flex: 1 }}>Annuler</button>
                    <button
                        onClick={() => onSubmit({
                            name,
                            base,               // centimes
                            period,             // "monthly" | "weekly" | "biweekly" | "daily" | "once"
                            resetDow: isWeeklyLike ? resetDow : null,
                            resetDom: isMonthly ? resetDom : null,
                            nextBase            // centimes ou null
                        })}
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
