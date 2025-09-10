import React, { useEffect, useRef } from "react";

export default function CarrouselEnv({ envelopes, transactions, formatCentsUSSplit }) {
    const ref = useRef(null);

    useEffect(() => {
        ref.current?.scrollTo({ left: 0, behavior: "auto" });
    }, [envelopes?.length]);

    return (
        <div className="carrousel">
            {envelopes?.map(env => {
                const sum = transactions.reduce((a, t) => a + (t.amount || 0), 0);
                const availableCents = (env.base || 0) + (env.carry || 0) + sum;
                const avail = formatCentsUSSplit(availableCents);

                return (
                    <section
                        key={env.id}
                        className="carrousel__item"
                    >
                        <div
                            className="carrousel__item__background"
                            style={{ height: `${availableCents * 100 / (env.base + env.carry)}%` }}
                        ></div>
                        <header className="carrousel__item__header">
                            <h1 className="carrousel__item__header__title">
                                {env.name}
                            </h1>
                        </header>
                        <div className="carrousel__item__body">
                            <p className="carrousel__item__body__amount">
                                {avail.int}
                                <span className="carrousel__item__body__amount__dec">
                                    {avail.dec}
                                </span>
                                €
                            </p>
                            <p className="carrousel__item__body__text">
                                Restants
                                {(() => {
                                    switch (env?.period) {
                                        case "weekly": return " cette semaine";
                                        case "biweekly": return " ces deux semaines";
                                        case "daily": return " ce jour-ci";
                                        case "monthly": return " ce mois-ci";
                                        default: return "";
                                    }
                                })()}
                            </p>
                        </div>
                    </section>
                )
            })}
        </div>
    )
}