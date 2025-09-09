import { useEffect, useRef, useState } from "react";

function mapFirebaseError(e) {
  const code = e.code || "";
  if (code.includes("invalid-email")) return "Adresse e-mail invalide.";
  if (code.includes("email-already-in-use")) return "Un compte existe déjà avec cet e-mail.";
  if (code.includes("weak-password")) return "Mot de passe trop faible (au moins 6 caractères).";
  if (code.includes("wrong-password")) return "Mot de passe incorrect.";
  if (code.includes("user-not-found")) return "Aucun compte trouvé avec cet e-mail.";
  return "Erreur : " + (e.message || "inconnue");
}

export default function EmailAuthModal({ mode = "signin", onSubmit, onReset, onCancel, allowLinkAnon = false }) {
  // mode: "signin" | "signup"
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [err, setErr] = useState("");
  const emailRef = useRef(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"grid",placeItems:"center",zIndex:70}}>
      <div style={{width:"100%",maxWidth:420,background:"#10151f",borderRadius:20,padding:16,color:"#e8ecf1"}}>
        <h2 style={{marginTop:0}}>{mode === "signin" ? "Connexion" : "Créer un compte"}</h2>

        <label style={{display:"grid",gap:6,marginBottom:12}}>
          <span>E-mail</span>
          <input
            ref={emailRef}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            style={{padding:10,borderRadius:10,border:"1px solid #2a3344",background:"#0e1422",color:"#e8ecf1"}}
          />
        </label>

        <label style={{display:"grid",gap:6,marginBottom:6}}>
          <span>Mot de passe</span>
          <div style={{display:"flex",gap:8}}>
            <input
              type={showPwd ? "text" : "password"}
              placeholder="••••••••"
              value={pwd}
              onChange={(e)=>setPwd(e.target.value)}
              style={{flex:1,padding:10,borderRadius:10,border:"1px solid #2a3344",background:"#0e1422",color:"#e8ecf1"}}
            />
            <button onClick={()=>setShowPwd(v=>!v)} style={{minWidth:90}}>
              {showPwd ? "Masquer" : "Afficher"}
            </button>
          </div>
        </label>

        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
          <small style={{opacity:.8}}>Min. 6 caractères</small>
          {mode === "signin" &&
            <button onClick={() => onReset?.(email)} style={{fontSize:12}}>Mot de passe oublié ?</button>
          }
        </div>

        {err && <div style={{color:"#ff8080",marginBottom:8}}>{err}</div>}

        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button onClick={onCancel} style={{flex:1}}>Annuler</button>
          <button
            onClick={async () => {
              try {
                await onSubmit(email.trim(), pwd);
              } catch (e) {
                setErr(mapFirebaseError(e));
              }
            }}
            style={{flex:2,background:"#00d084",color:"#003222"}}
            disabled={!email || !pwd}
          >
            {mode === "signin" ? "Se connecter" : "Créer"}
          </button>
        </div>

        {allowLinkAnon && (
          <div style={{marginTop:10,opacity:.8,fontSize:12}}>
            Astuce : si vous êtes connecté en anonyme, vous pouvez lier ce compte à cet e-mail pour conserver vos données.
          </div>
        )}
      </div>
    </div>
  );
}
