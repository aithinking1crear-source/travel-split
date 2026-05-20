import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "entrepinos-cuentas";
const FAMILIES_KEY = "entrepinos-familias";

function genId() { return Math.random().toString(36).slice(2, 10).toUpperCase(); }
function fmt(n) { return "$" + Math.round(n).toLocaleString("es-CO"); }

async function loadTrips() {
  try {
    const localData = localStorage.getItem(STORAGE_KEY);
    if (localData) return JSON.parse(localData);
    const oldLocal = localStorage.getItem("travel-split-v2");
    if (oldLocal) {
      localStorage.setItem(STORAGE_KEY, oldLocal);
      return JSON.parse(oldLocal);
    }
  } catch {}
  try {
    if (typeof window.storage !== "undefined") {
      const keys = ["entrepinos-cuentas", "travel-split-v2", "travel-split", "travel-split-trips"];
      let merged = {};
      for (const k of keys) {
        try {
          const r = await window.storage.get(k);
          if (r) merged = { ...merged, ...JSON.parse(r.value) };
        } catch {}
      }
      if (Object.keys(merged).length > 0) {
        await window.storage.set(STORAGE_KEY, JSON.stringify(merged));
        return merged;
      }
    }
  } catch {}
  return {};
}

async function saveTrips(trips) {
  const json = JSON.stringify(trips);
  try { localStorage.setItem(STORAGE_KEY, json); } catch {}
  try {
    if (typeof window.storage !== "undefined") {
      await window.storage.set(STORAGE_KEY, json);
      const oldKeys = ["travel-split-v2", "travel-split", "travel-split-trips"];
      for (const k of oldKeys) { try { await window.storage.delete(k); } catch {} }
    }
  } catch {}
  try { localStorage.removeItem("travel-split-v2"); } catch {}
}

async function loadFamilies() {
  try {
    const localData = localStorage.getItem(FAMILIES_KEY);
    if (localData) return JSON.parse(localData);
  } catch {}
  try {
    if (typeof window.storage !== "undefined") {
      const r = await window.storage.get(FAMILIES_KEY);
      if (r) {
        const data = JSON.parse(r.value);
        localStorage.setItem(FAMILIES_KEY, r.value);
        return data;
      }
    }
  } catch {}
  return [];
}

async function saveFamilies(families) {
  const json = JSON.stringify(families);
  try { localStorage.setItem(FAMILIES_KEY, json); } catch {}
  try {
    if (typeof window.storage !== "undefined") {
      await window.storage.set(FAMILIES_KEY, json);
    }
  } catch {}
}

// ── Cálculo de deudas con priorización familiar ──────────
function calcDebts(trip) {
  const { participants, expenses } = trip;
  const totalDays = participants.reduce((a, p) => a + p.days, 0);
  if (totalDays === 0) return { perDayPerPerson: 0, shouldPay: {}, paid: {}, balance: {}, debts: [] };

  const totalSpent = expenses.reduce((a, e) => a + e.amount, 0);
  const perDayPerPerson = totalSpent / totalDays;

  const shouldPay = {};
  participants.forEach(p => { shouldPay[p.name] = perDayPerPerson * p.days; });

  const paid = {};
  participants.forEach(p => { paid[p.name] = 0; });
  expenses.forEach(e => { paid[e.paidBy] = (paid[e.paidBy] || 0) + e.amount; });

  const balance = {};
  participants.forEach(p => { balance[p.name] = (paid[p.name] || 0) - shouldPay[p.name]; });

  // Mapa de familia por persona
  const familyOf = {};
  participants.forEach(p => { familyOf[p.name] = p.family || null; });

  // Algoritmo greedy: emparejar deudores y acreedores
  // Prioridad: misma familia primero (cuando los montos cuadran perfecto), luego cualquier match
  const debts = [];
  const pos = Object.entries(balance).filter(([,v]) => v > 0.5).map(([k,v]) => ({name:k,val:v,family:familyOf[k]}));
  const neg = Object.entries(balance).filter(([,v]) => v < -0.5).map(([k,v]) => ({name:k,val:-v,family:familyOf[k]}));

  // Estrategia: en cada paso, buscar el match que cierre completamente al menos a uno de los dos
  // (para mantener el mínimo de transferencias). De entre esos, preferir misma familia.
  while (pos.length > 0 && neg.length > 0) {
    let bestI = 0, bestJ = 0, bestScore = -1;

    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < neg.length; j++) {
        const amt = Math.min(pos[i].val, neg[j].val);
        const closesPos = Math.abs(pos[i].val - amt) < 0.5;
        const closesNeg = Math.abs(neg[j].val - amt) < 0.5;
        const sameFamily = pos[i].family && neg[j].family && pos[i].family === neg[j].family;

        // Score: cierra ambos > cierra uno > nada; con bonus por misma familia
        let score = 0;
        if (closesPos && closesNeg) score = 100;
        else if (closesPos || closesNeg) score = 50;
        if (sameFamily) score += 10;

        if (score > bestScore) {
          bestScore = score;
          bestI = i;
          bestJ = j;
        }
      }
    }

    const p = pos[bestI], n = neg[bestJ];
    const amt = Math.min(p.val, n.val);
    debts.push({ from: n.name, to: p.name, amount: amt, sameFamily: p.family && n.family && p.family === n.family });
    p.val -= amt; n.val -= amt;
    if (p.val < 0.5) pos.splice(bestI, 1);
    if (n.val < 0.5) neg.splice(bestJ, 1);
  }

  return { perDayPerPerson, shouldPay, paid, balance, debts };
}

// ── Logo del pino ──────────────────────────────────────
function PineIcon({ size = 60 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{display:"inline-block"}}>
      <rect x="44" y="78" width="12" height="14" fill="#6b4423" rx="2"/>
      <polygon points="50,10 25,40 75,40" fill="#2d6a4f"/>
      <polygon points="50,28 22,58 78,58" fill="#40916c"/>
      <polygon points="50,46 18,82 82,82" fill="#52b788"/>
    </svg>
  );
}

// ── Modal de confirmación ───────────────────────────────
function ConfirmModal({ title, message, onConfirm, onCancel, confirmText="Eliminar", danger=true }) {
  return (
    <div style={s.overlay} onClick={onCancel}>
      <div style={{...s.modal,maxWidth:380}} onClick={e=>e.stopPropagation()}>
        <div style={{textAlign:"center",marginBottom:14}}>
          <div style={{fontSize:42}}>⚠️</div>
          <h3 style={{margin:"8px 0 6px",color:"#1b4332"}}>{title}</h3>
          <p style={{margin:0,color:"#666",fontSize:14,lineHeight:1.5}}>{message}</p>
        </div>
        <div style={{display:"flex",gap:10,marginTop:18}}>
          <button style={{...s.btnSecondary,flex:1}} onClick={onCancel}>Cancelar</button>
          <button style={{flex:1,padding:"13px",background:danger?"#c1121f":"#2d6a4f",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:700,cursor:"pointer"}} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

// ── Home ─────────────────────────────────────────────────
function HomeScreen({ onOpen, onCreate, onFamilies }) {
  const [trips, setTrips] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  useEffect(() => { loadTrips().then(setTrips); }, []);

  function askDelete(e, tripId, tripName) {
    e.stopPropagation();
    setToDelete({ id: tripId, name: tripName });
  }

  async function confirmDelete() {
    const all = await loadTrips();
    delete all[toDelete.id];
    await saveTrips(all);
    setTrips({...all});
    setToDelete(null);
  }

  return (
    <div style={s.center}>
      <div style={s.card}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <PineIcon size={72} />
          <h1 style={s.bigTitle}>Entrepinos<br/><span style={{color:"#52b788",fontWeight:600}}>Cuentas</span></h1>
          <p style={s.subtitle}>Dividir las cuentas del paseo<br/>fácil y sin enredos 🌲</p>
        </div>

        <button style={s.btnPrimary} onClick={onCreate}>
          ➕ Crear nuevo paseo
        </button>

        <button style={s.btnSecondary} onClick={onFamilies}>
          👨‍👩‍👧 Gestionar familias
        </button>

        {trips && Object.keys(trips).length > 0 && (
          <div style={{marginTop:32}}>
            <p style={s.listLabel}>📋 Paseos guardados</p>
            {Object.values(trips).sort((a,b)=>b.createdAt-a.createdAt).map(t => (
              <div key={t.id} style={s.tripRow} onClick={()=>onOpen(t.id)}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={s.tripName}>🌲 {t.name}</div>
                  <div style={s.tripMeta}>{t.participants.length} personas</div>
                </div>
                <button style={s.btnDelHome} onClick={(e)=>askDelete(e, t.id, t.name)} title="Eliminar">🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {toDelete && (
        <ConfirmModal
          title="¿Eliminar paseo?"
          message={`El paseo "${toDelete.name}" se borrará para siempre, junto con todos sus gastos.`}
          onConfirm={confirmDelete}
          onCancel={()=>setToDelete(null)}
        />
      )}
    </div>
  );
}

// ── Pantalla de Familias ─────────────────────────────────
function FamiliesScreen({ onBack }) {
  const [families, setFamilies] = useState([]);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => { loadFamilies().then(setFamilies); }, []);

  async function persist(newFamilies) {
    await saveFamilies(newFamilies);
    setFamilies(newFamilies);
  }

  function startNew() {
    setEditing({ name: "", members: [""], isNew: true });
  }

  function startEdit(fam, idx) {
    setEditing({ ...fam, idx, isNew: false });
  }

  async function saveFamily(fam) {
    const cleaned = {
      name: fam.name.trim(),
      members: fam.members.map(m=>m.trim()).filter(Boolean)
    };
    let newList;
    if (fam.isNew) newList = [...families, cleaned];
    else newList = families.map((f,i)=>i===fam.idx?cleaned:f);
    await persist(newList);
    setEditing(null);
  }

  async function deleteFamily() {
    const newList = families.filter((_,i)=>i!==confirmDel.idx);
    await persist(newList);
    setConfirmDel(null);
  }

  return (
    <div style={s.center}>
      <div style={s.card}>
        <button style={s.back} onClick={onBack}>← Inicio</button>
        <div style={{textAlign:"center",marginTop:8,marginBottom:18}}>
          <div style={{fontSize:48}}>👨‍👩‍👧</div>
          <h2 style={s.title}>Familias</h2>
          <p style={{...s.subtitle,marginTop:6,fontSize:14}}>Guarda tus grupos familiares para usarlos en cualquier paseo.</p>
        </div>

        {families.length === 0 && (
          <div style={{textAlign:"center",padding:"24px 12px",color:"#52796f"}}>
            <div style={{fontSize:36,marginBottom:8}}>🌲</div>
            <p style={{margin:0,fontSize:14}}>Aún no has agregado ninguna familia.</p>
          </div>
        )}

        {families.map((f, idx) => (
          <div key={idx} style={s.familyCard}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={s.familyName}>👨‍👩‍👧 {f.name}</span>
              <div style={{display:"flex",gap:6}}>
                <button style={s.btnSmall} onClick={()=>startEdit(f, idx)}>✏️</button>
                <button style={{...s.btnSmall,background:"#fce8e8",color:"#c1121f"}} onClick={()=>setConfirmDel({idx,name:f.name})}>🗑</button>
              </div>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {f.members.map((m,j)=><span key={j} style={s.memberTag}>{m}</span>)}
            </div>
          </div>
        ))}

        <button style={{...s.btnPrimary,marginTop:16}} onClick={startNew}>➕ Agregar familia</button>
      </div>

      {editing && (
        <FamilyEditModal
          family={editing}
          onSave={saveFamily}
          onClose={()=>setEditing(null)}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          title="¿Eliminar familia?"
          message={`Se eliminará la familia "${confirmDel.name}". Esto no afecta los paseos ya creados.`}
          onConfirm={deleteFamily}
          onCancel={()=>setConfirmDel(null)}
        />
      )}
    </div>
  );
}

function FamilyEditModal({ family, onSave, onClose }) {
  const [name, setName] = useState(family.name);
  const [members, setMembers] = useState(family.members.length > 0 ? family.members : [""]);
  const [err, setErr] = useState("");

  function update(i, val) { const m=[...members]; m[i]=val; setMembers(m); }
  function add() { setMembers([...members,""]); }
  function remove(i) { setMembers(members.filter((_,j)=>j!==i)); }

  function handleSave() {
    if (!name.trim()) return setErr("Ponle un nombre a la familia.");
    const valid = members.map(m=>m.trim()).filter(Boolean);
    if (valid.length < 1) return setErr("Agrega al menos 1 miembro.");
    const dup = valid.map(m=>m.toLowerCase());
    if (new Set(dup).size !== dup.length) return setErr("Hay nombres repetidos.");
    onSave({ ...family, name, members });
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{...s.modal,maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{textAlign:"center",marginBottom:14}}>
          <div style={{fontSize:42}}>👨‍👩‍👧</div>
          <h3 style={{margin:"6px 0 0",color:"#1b4332"}}>{family.isNew ? "Nueva familia" : "Editar familia"}</h3>
        </div>

        <label style={s.label}>Nombre de la familia</label>
        <input style={s.input} placeholder="Ej: Familia García" value={name} onChange={e=>setName(e.target.value)} />

        <label style={s.label}>Miembros</label>
        {members.map((m,i)=>(
          <div key={i} style={{display:"flex",gap:8,marginBottom:8}}>
            <input style={{...s.input,margin:0,flex:1}} placeholder={`Persona ${i+1}`} value={m} onChange={e=>update(i,e.target.value)} />
            {members.length>1 && <button style={s.btnRemove} onClick={()=>remove(i)}>✕</button>}
          </div>
        ))}
        <button style={s.btnAdd} onClick={add}>➕ Agregar miembro</button>

        {err && <p style={s.err}>⚠️ {err}</p>}
        <div style={{display:"flex",gap:10,marginTop:12}}>
          <button style={{...s.btnSecondary,flex:1}} onClick={onClose}>Cancelar</button>
          <button style={{...s.btnPrimary,flex:1,margin:0}} onClick={handleSave}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ── Crear paseo ──────────────────────────────────────────
function CreateScreen({ onBack, onCreated }) {
  const [name, setName] = useState("");
  const [participants, setParticipants] = useState([{name:"",days:"",family:null}]);
  const [err, setErr] = useState("");
  const [families, setFamilies] = useState([]);
  const [showAddFamily, setShowAddFamily] = useState(false);

  useEffect(() => { loadFamilies().then(setFamilies); }, []);

  function addP() { setParticipants([...participants,{name:"",days:"",family:null}]); }
  function updateP(i,field,val) { const p=[...participants]; p[i]={...p[i],[field]:val}; setParticipants(p); }
  function removeP(i) { setParticipants(participants.filter((_,j)=>j!==i)); }

  function pickSuggestion(i, memberName, familyName) {
    const p = [...participants];
    p[i] = { ...p[i], name: memberName, family: familyName };
    setParticipants(p);
  }

  function addEntireFamily(fam) {
    const existingNames = new Set(participants.map(p=>p.name.trim().toLowerCase()).filter(Boolean));
    const newOnes = fam.members
      .filter(m => !existingNames.has(m.toLowerCase()))
      .map(m => ({ name: m, days: "", family: fam.name }));
    const emptySlots = participants.filter(p=>!p.name.trim());
    const filled = participants.filter(p=>p.name.trim());
    setParticipants([...filled, ...newOnes, ...emptySlots]);
    setShowAddFamily(false);
  }

  async function handleCreate() {
    if (!name.trim()) return setErr("Ponle un nombre al paseo.");
    const valid = participants.filter(p=>p.name.trim()&&+p.days>0);
    if (valid.length < 2) return setErr("Agrega al menos 2 personas con sus días.");
    const dup = valid.map(p=>p.name.trim().toLowerCase());
    if (new Set(dup).size !== dup.length) return setErr("Hay nombres repetidos.");
    const trip = {
      id: genId(),
      name: name.trim(),
      participants: valid.map(p=>({name:p.name.trim(), days:+p.days, family:p.family||null})),
      expenses: [],
      createdAt: Date.now()
    };
    const trips = await loadTrips();
    trips[trip.id] = trip;
    await saveTrips(trips);
    onCreated(trip.id);
  }

  return (
    <div style={s.center}>
      <div style={{...s.card,maxWidth:500}}>
        <button style={s.back} onClick={onBack}>← Volver</button>
        <div style={{textAlign:"center",marginTop:8,marginBottom:20}}>
          <PineIcon size={48} />
          <h2 style={s.title}>Nuevo paseo</h2>
        </div>

        <label style={s.label}>Nombre del paseo</label>
        <input style={s.input} placeholder="Ej: Paseo de diciembre" value={name} onChange={e=>setName(e.target.value)} />

        <label style={s.label}>Personas y días que estuvieron 🏕️</label>
        <p style={s.helpText}>Empieza a escribir un nombre o agrega una familia completa.</p>

        {families.length > 0 && (
          <button style={s.btnAddFam} onClick={()=>setShowAddFamily(true)}>
            👨‍👩‍👧 Agregar familia completa
          </button>
        )}

        <div style={{display:"grid",gridTemplateColumns:"1fr 70px 36px",gap:"0 8px",marginBottom:6,marginTop:12}}>
          <span style={s.miniLabel}>Nombre</span>
          <span style={s.miniLabel}>Días</span>
          <span/>
        </div>
        {participants.map((p,i)=>(
          <ParticipantRow
            key={i}
            participant={p}
            families={families}
            existingNames={participants.map(pp=>pp.name).filter((_,j)=>j!==i)}
            onChange={(field,val)=>updateP(i,field,val)}
            onPick={(name,family)=>pickSuggestion(i,name,family)}
            onRemove={()=>removeP(i)}
            canRemove={participants.length>1}
          />
        ))}
        <button style={s.btnAdd} onClick={addP}>➕ Agregar persona</button>
        {err && <p style={s.err}>⚠️ {err}</p>}
        <button style={{...s.btnPrimary,marginTop:16}} onClick={handleCreate}>Crear paseo 🌲</button>
      </div>

      {showAddFamily && (
        <PickFamilyModal
          families={families}
          onPick={addEntireFamily}
          onClose={()=>setShowAddFamily(false)}
        />
      )}
    </div>
  );
}

function ParticipantRow({ participant, families, existingNames, onChange, onPick, onRemove, canRemove }) {
  const [focused, setFocused] = useState(false);
  const containerRef = useRef(null);

  // Generar sugerencias
  const allMembers = [];
  families.forEach(f => f.members.forEach(m => allMembers.push({ name: m, family: f.name })));
  const taken = new Set(existingNames.map(n=>n.trim().toLowerCase()).filter(Boolean));
  const q = participant.name.trim().toLowerCase();
  const suggestions = allMembers
    .filter(m => !taken.has(m.name.toLowerCase()))
    .filter(m => q === "" || m.name.toLowerCase().includes(q))
    .filter(m => m.name.toLowerCase() !== q) // no mostrar match exacto
    .slice(0, 6);

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setFocused(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const familyLabel = participant.family
    ? participant.family
    : (participant.name.trim() ? "Invitado" : "");

  return (
    <div ref={containerRef} style={{position:"relative",marginBottom:10}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 70px 36px",gap:"0 8px"}}>
        <div style={{position:"relative"}}>
          <input
            style={{...s.input,margin:0}}
            placeholder="Nombre"
            value={participant.name}
            onChange={e=>{
              onChange("name", e.target.value);
              // Si cambia el nombre manualmente, quitar la asociación a familia
              if (participant.family) {
                const stillMatches = families.some(f =>
                  f.name === participant.family &&
                  f.members.some(m => m.toLowerCase() === e.target.value.trim().toLowerCase())
                );
                if (!stillMatches) onChange("family", null);
              }
            }}
            onFocus={()=>setFocused(true)}
          />
          {focused && suggestions.length > 0 && (
            <div style={s.suggestions}>
              {suggestions.map((sg,k)=>(
                <div key={k} style={s.suggestionItem} onMouseDown={(e)=>{e.preventDefault();onPick(sg.name,sg.family);setFocused(false);}}>
                  <span style={{fontWeight:600,color:"#1b4332"}}>{sg.name}</span>
                  <span style={s.suggestionFam}>{sg.family}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <input style={{...s.input,margin:0,textAlign:"center"}} type="number" min="1" inputMode="numeric" placeholder="0" value={participant.days} onChange={e=>onChange("days",e.target.value)} />
        {canRemove
          ? <button style={s.btnRemove} onClick={onRemove}>✕</button>
          : <span/>}
      </div>
      {familyLabel && (
        <div style={{fontSize:11,color:participant.family?"#52796f":"#999",marginTop:3,marginLeft:4,fontWeight:500}}>
          {participant.family ? `👨‍👩‍👧 ${familyLabel}` : `🎒 ${familyLabel}`}
        </div>
      )}
    </div>
  );
}

function PickFamilyModal({ families, onPick, onClose }) {
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e=>e.stopPropagation()}>
        <div style={{textAlign:"center",marginBottom:14}}>
          <div style={{fontSize:42}}>👨‍👩‍👧</div>
          <h3 style={{margin:"6px 0 0",color:"#1b4332"}}>Elegir familia</h3>
          <p style={{margin:"4px 0 0",fontSize:13,color:"#666"}}>Se agregarán todos los miembros al paseo.</p>
        </div>
        {families.map((f,i)=>(
          <button key={i} style={s.familyPickRow} onClick={()=>onPick(f)}>
            <div style={{fontWeight:700,color:"#1b4332"}}>👨‍👩‍👧 {f.name}</div>
            <div style={{fontSize:12,color:"#52796f",marginTop:3}}>{f.members.join(", ")}</div>
          </button>
        ))}
        <button style={{...s.btnSecondary,marginTop:8}} onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}

// ── Vista del paseo ──────────────────────────────────────
function TripScreen({ tripId, onBack }) {
  const [trip, setTrip] = useState(null);
  const [view, setView] = useState("gastos");
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editingParticipants, setEditingParticipants] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState(null);
  const [confirmDeleteTrip, setConfirmDeleteTrip] = useState(false);

  useEffect(() => { loadTrips().then(trips=>setTrip(trips[tripId])); }, [tripId]);

  async function addExpense(exp) {
    const trips = await loadTrips();
    trips[tripId].expenses.push(exp);
    await saveTrips(trips);
    setTrip({...trips[tripId]});
    setShowForm(false);
  }

  async function updateExpense(idx, exp) {
    const trips = await loadTrips();
    trips[tripId].expenses[idx] = exp;
    await saveTrips(trips);
    setTrip({...trips[tripId]});
    setEditingExpense(null);
  }

  async function deleteExpense(idx) {
    const trips = await loadTrips();
    trips[tripId].expenses.splice(idx,1);
    await saveTrips(trips);
    setTrip({...trips[tripId]});
    setExpenseToDelete(null);
  }

  async function updateParticipants(newParts) {
    const trips = await loadTrips();
    trips[tripId].participants = newParts;
    const validNames = new Set(newParts.map(p=>p.name));
    trips[tripId].expenses = trips[tripId].expenses.filter(e => validNames.has(e.paidBy));
    await saveTrips(trips);
    setTrip({...trips[tripId]});
    setEditingParticipants(false);
  }

  async function deleteTrip() {
    const trips = await loadTrips();
    delete trips[tripId];
    await saveTrips(trips);
    setConfirmDeleteTrip(false);
    onBack();
  }

  if (!trip) return <div style={s.center}><p>Cargando...</p></div>;

  const { perDayPerPerson, shouldPay, paid, balance, debts } = calcDebts(trip);
  const totalSpent = trip.expenses.reduce((a,e)=>a+e.amount,0);
  const totalDays = trip.participants.reduce((a,p)=>a+p.days,0);

  return (
    <div style={{minHeight:"100vh",background:"#f1f8f4"}}>
      <div style={s.header}>
        <button style={s.back} onClick={onBack}>← Inicio</button>
        <div style={{flex:1,textAlign:"center"}}>
          <div style={s.headerTitle}>🌲 {trip.name}</div>
          <div style={s.headerSub}>{trip.participants.length} personas · {totalDays} días</div>
        </div>
        <div style={{width:50}}/>
      </div>

      <div style={s.stats}>
        <div style={s.stat}>
          <div style={s.statLbl}>Total gastado</div>
          <div style={s.statVal}>{fmt(totalSpent)}</div>
        </div>
        <div style={s.statDivider}/>
        <div style={s.stat}>
          <div style={s.statLbl}>Por persona/día</div>
          <div style={s.statVal}>{fmt(perDayPerPerson)}</div>
        </div>
      </div>

      <div style={s.tabs}>
        <button style={view==="gastos"?s.tabActive:s.tab} onClick={()=>setView("gastos")}>💰 Gastos</button>
        <button style={view==="resumen"?s.tabActive:s.tab} onClick={()=>setView("resumen")}>📊 Cuentas</button>
        <button style={view==="config"?s.tabActive:s.tab} onClick={()=>setView("config")}>👥 Personas</button>
      </div>

      <div style={{padding:"14px 16px 110px"}}>
        {view==="gastos" && (
          <>
            {trip.expenses.length===0 && (
              <div style={s.empty}>
                <div style={{fontSize:48,marginBottom:8}}>🧾</div>
                <p style={{margin:0,fontSize:15}}>Aún no hay gastos.</p>
                <p style={{margin:"4px 0 0",fontSize:13,color:"#888"}}>Agrega el primero con el botón de abajo.</p>
              </div>
            )}
            {trip.expenses.map((exp,idx)=>(
              <div key={idx} style={s.expCard}>
                <div style={{flex:1,cursor:"pointer"}} onClick={()=>setEditingExpense(idx)}>
                  <div style={s.expDesc}>{exp.description}</div>
                  <div style={s.expWho}>Pagó: <b>{exp.paidBy}</b></div>
                </div>
                <div style={{textAlign:"right",marginRight:8,cursor:"pointer"}} onClick={()=>setEditingExpense(idx)}>
                  <div style={s.expAmount}>{fmt(exp.amount)}</div>
                  <div style={s.expEdit}>Tocar para editar ✏️</div>
                </div>
                <button style={s.btnDel} onClick={()=>setExpenseToDelete(idx)}>🗑</button>
              </div>
            ))}
          </>
        )}

        {view==="resumen" && (
          <>
            <div style={s.section}>
              <h3 style={s.sectionTitle}>💸 Cómo saldar las cuentas</h3>
              {debts.length===0
                ? <p style={{color:"#2d6a4f",fontSize:15,margin:0,textAlign:"center",padding:"12px 0"}}>¡Todo está saldado! 🎉</p>
                : debts.map((d,i)=>(
                  <div key={i} style={s.debtRow}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={s.debtFrom}>{d.from}</span>
                      <span style={s.debtArrow}>→</span>
                      <span style={s.debtTo}>{d.to}</span>
                      {d.sameFamily && <span style={s.sameFamTag}>👨‍👩‍👧 misma familia</span>}
                    </div>
                    <span style={s.debtAmount}>{fmt(d.amount)}</span>
                  </div>
                ))
              }
            </div>

            <div style={s.section}>
              <h3 style={s.sectionTitle}>👤 Cuenta de cada persona</h3>
              {trip.participants.map(p=>(
                <div key={p.name} style={s.personCard}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div>
                      <div style={s.personName}>{p.name}</div>
                      <div style={{fontSize:11,color:p.family?"#52796f":"#999",marginTop:2,fontWeight:500}}>
                        {p.family ? `👨‍👩‍👧 ${p.family}` : "🎒 Invitado"}
                      </div>
                    </div>
                    <span style={s.personDays}>🏕️ {p.days} días</span>
                  </div>
                  <div style={s.personRow}>
                    <span style={{color:"#666"}}>Debía pagar</span>
                    <span style={{fontWeight:600}}>{fmt(shouldPay[p.name]||0)}</span>
                  </div>
                  <div style={s.personRow}>
                    <span style={{color:"#666"}}>Ya pagó</span>
                    <span style={{fontWeight:600,color:"#2d6a4f"}}>{fmt(paid[p.name]||0)}</span>
                  </div>
                  <div style={{...s.personRow,borderTop:"1px solid #d8e8de",paddingTop:8,marginTop:4}}>
                    <span style={{fontWeight:700}}>Balance</span>
                    <span style={{fontWeight:700, fontSize:15, color: (balance[p.name]||0)>=0?"#2d6a4f":"#c1121f"}}>
                      {(balance[p.name]||0)>=0 ? `+${fmt(balance[p.name]||0)}` : `-${fmt(Math.abs(balance[p.name]||0))}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{...s.section,background:"#e8f3ec",border:"1px solid #b7dcc1"}}>
              <h3 style={{...s.sectionTitle,color:"#2d6a4f"}}>🧮 Cómo se hace la cuenta</h3>
              <p style={{fontSize:14,color:"#444",margin:0,lineHeight:1.7}}>
                Se gastó en total <b>{fmt(totalSpent)}</b>.<br/>
                Sumando los días de todos: <b>{totalDays} días</b>.<br/>
                Esto da <b>{fmt(perDayPerPerson)} por persona al día</b>.<br/><br/>
                Cada persona paga ese valor por los días que estuvo en la finca.
              </p>
            </div>
          </>
        )}

        {view==="config" && (
          <>
            <div style={s.section}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <h3 style={{...s.sectionTitle,margin:0}}>👥 Personas</h3>
                <button style={s.btnSmall} onClick={()=>setEditingParticipants(true)}>✏️ Editar</button>
              </div>
              {trip.participants.map(p=>(
                <div key={p.name} style={s.configRow}>
                  <div>
                    <div style={{fontWeight:600,color:"#333",fontSize:15}}>👤 {p.name}</div>
                    <div style={{fontSize:11,color:p.family?"#52796f":"#999",marginTop:2}}>
                      {p.family ? `👨‍👩‍👧 ${p.family}` : "🎒 Invitado"}
                    </div>
                  </div>
                  <span style={{color:"#666",fontSize:14}}>{p.days} días</span>
                </div>
              ))}
            </div>

            <div style={s.section}>
              <h3 style={s.sectionTitle}>⚠️ Eliminar paseo</h3>
              <p style={{fontSize:13,color:"#666",margin:"0 0 12px"}}>Esta acción borra el paseo y todos sus gastos para siempre.</p>
              <button style={s.btnDanger} onClick={()=>setConfirmDeleteTrip(true)}>🗑 Eliminar paseo</button>
            </div>
          </>
        )}
      </div>

      {view==="gastos" && (
        <button style={s.fab} onClick={()=>setShowForm(true)}>➕ Nuevo gasto</button>
      )}

      {showForm && (
        <ExpenseModal participants={trip.participants} onAdd={addExpense} onClose={()=>setShowForm(false)} />
      )}

      {editingExpense !== null && trip.expenses[editingExpense] && (
        <ExpenseModal
          participants={trip.participants}
          initial={trip.expenses[editingExpense]}
          onAdd={(exp)=>updateExpense(editingExpense, exp)}
          onClose={()=>setEditingExpense(null)}
        />
      )}

      {editingParticipants && (
        <EditParticipantsModal
          participants={trip.participants}
          onSave={updateParticipants}
          onClose={()=>setEditingParticipants(false)}
        />
      )}

      {expenseToDelete !== null && trip.expenses[expenseToDelete] && (
        <ConfirmModal
          title="¿Eliminar gasto?"
          message={`Se borrará "${trip.expenses[expenseToDelete].description}" (${fmt(trip.expenses[expenseToDelete].amount)}).`}
          onConfirm={()=>deleteExpense(expenseToDelete)}
          onCancel={()=>setExpenseToDelete(null)}
        />
      )}

      {confirmDeleteTrip && (
        <ConfirmModal
          title="¿Eliminar paseo?"
          message={`El paseo "${trip.name}" se borrará para siempre, junto con todos sus gastos.`}
          onConfirm={deleteTrip}
          onCancel={()=>setConfirmDeleteTrip(false)}
        />
      )}
    </div>
  );
}

function ExpenseModal({ participants, onAdd, onClose, initial }) {
  const [desc, setDesc] = useState(initial?.description || "");
  const [amount, setAmount] = useState(initial?.amount?.toString() || "");
  const [paidBy, setPaidBy] = useState(initial?.paidBy || participants[0].name);
  const [err, setErr] = useState("");
  const isEdit = !!initial;

  function handleAdd() {
    if (!desc.trim()) return setErr("Describe el gasto.");
    if (!amount || isNaN(amount) || +amount <= 0) return setErr("Ingresa un monto válido.");
    onAdd({ description: desc.trim(), amount: +amount, paidBy });
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e=>e.stopPropagation()}>
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:40}}>{isEdit ? "✏️" : "💰"}</div>
          <h3 style={{margin:"4px 0 0",color:"#1b4332"}}>{isEdit ? "Editar gasto" : "Nuevo gasto"}</h3>
        </div>
        <label style={s.label}>¿En qué se gastó?</label>
        <input style={s.input} placeholder="Ej: Mercado, asado, gasolina..." value={desc} onChange={e=>setDesc(e.target.value)} />
        <label style={s.label}>Monto en pesos</label>
        <input style={s.input} type="number" min="0" inputMode="numeric" placeholder="0" value={amount} onChange={e=>setAmount(e.target.value)} />
        <label style={s.label}>¿Quién pagó?</label>
        <select style={s.input} value={paidBy} onChange={e=>setPaidBy(e.target.value)}>
          {participants.map(p=><option key={p.name} value={p.name}>{p.name} ({p.days} días)</option>)}
        </select>
        {err && <p style={s.err}>⚠️ {err}</p>}
        <div style={{display:"flex",gap:10,marginTop:12}}>
          <button style={{...s.btnSecondary,flex:1}} onClick={onClose}>Cancelar</button>
          <button style={{...s.btnPrimary,flex:1,margin:0}} onClick={handleAdd}>{isEdit ? "Guardar" : "Agregar"}</button>
        </div>
      </div>
    </div>
  );
}

function EditParticipantsModal({ participants, onSave, onClose }) {
  const [parts, setParts] = useState(participants.map(p=>({...p, days: p.days.toString()})));
  const [families, setFamilies] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => { loadFamilies().then(setFamilies); }, []);

  function update(i, field, val) {
    const p = [...parts]; p[i] = {...p[i], [field]: val}; setParts(p);
  }
  function pick(i, name, family) {
    const p = [...parts]; p[i] = {...p[i], name, family}; setParts(p);
  }
  function add() { setParts([...parts, {name:"", days:"", family:null}]); }
  function remove(i) { setParts(parts.filter((_,j)=>j!==i)); }

  function handleSave() {
    const valid = parts.filter(p => p.name.trim() && +p.days > 0);
    if (valid.length < 2) return setErr("Debe haber al menos 2 personas con sus días.");
    const names = valid.map(p=>p.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return setErr("Hay nombres repetidos.");
    onSave(valid.map(p=>({name:p.name.trim(), days:+p.days, family:p.family||null})));
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{...s.modal,maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <div style={{fontSize:40}}>👥</div>
          <h3 style={{margin:"4px 0 0",color:"#1b4332"}}>Editar personas</h3>
        </div>
        <p style={{fontSize:13,color:"#666",textAlign:"center",marginTop:0,marginBottom:16}}>
          Si quitas a alguien, también se borrarán los gastos que esa persona pagó.
        </p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 70px 36px",gap:"0 8px",marginBottom:6}}>
          <span style={s.miniLabel}>Nombre</span>
          <span style={s.miniLabel}>Días</span>
          <span/>
        </div>
        {parts.map((p,i)=>(
          <ParticipantRow
            key={i}
            participant={p}
            families={families}
            existingNames={parts.map(pp=>pp.name).filter((_,j)=>j!==i)}
            onChange={(field,val)=>update(i,field,val)}
            onPick={(name,family)=>pick(i,name,family)}
            onRemove={()=>remove(i)}
            canRemove={parts.length>1}
          />
        ))}
        <button style={s.btnAdd} onClick={add}>➕ Agregar persona</button>
        {err && <p style={s.err}>⚠️ {err}</p>}
        <div style={{display:"flex",gap:10,marginTop:12}}>
          <button style={{...s.btnSecondary,flex:1}} onClick={onClose}>Cancelar</button>
          <button style={{...s.btnPrimary,flex:1,margin:0}} onClick={handleSave}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [tripId, setTripId] = useState(null);
  if (screen==="home") return <HomeScreen onOpen={id=>{setTripId(id);setScreen("trip");}} onCreate={()=>setScreen("create")} onFamilies={()=>setScreen("families")} />;
  if (screen==="create") return <CreateScreen onBack={()=>setScreen("home")} onCreated={id=>{setTripId(id);setScreen("trip");}} />;
  if (screen==="families") return <FamiliesScreen onBack={()=>setScreen("home")} />;
  return <TripScreen tripId={tripId} onBack={()=>setScreen("home")} />;
}

// ── Styles ───────────────────────────────────────────────
const s = {
  center:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(180deg, #d8e8de 0%, #f1f8f4 100%)",padding:16},
  card:{background:"#fff",borderRadius:20,padding:28,width:"100%",maxWidth:460,boxShadow:"0 8px 32px rgba(45,106,79,0.15)"},
  bigTitle:{margin:"12px 0 6px",color:"#1b4332",fontSize:32,fontWeight:800,lineHeight:1.1,letterSpacing:-0.5},
  subtitle:{color:"#52796f",margin:0,fontSize:15,lineHeight:1.4},
  title:{margin:"4px 0 0",color:"#1b4332",fontSize:22,fontWeight:700},
  header:{background:"#fff",padding:"14px 16px",display:"flex",alignItems:"center",gap:8,boxShadow:"0 2px 12px rgba(45,106,79,0.1)",position:"sticky",top:0,zIndex:10},
  headerTitle:{fontWeight:700,color:"#1b4332",fontSize:17},
  headerSub:{fontSize:12,color:"#52796f",marginTop:2},
  stats:{display:"flex",background:"linear-gradient(135deg, #2d6a4f 0%, #40916c 100%)",color:"#fff",padding:"4px"},
  stat:{flex:1,textAlign:"center",padding:"16px 8px"},
  statDivider:{width:1,background:"rgba(255,255,255,0.25)",margin:"12px 0"},
  statVal:{fontSize:18,fontWeight:700,marginTop:4},
  statLbl:{fontSize:12,opacity:.9,fontWeight:500},
  tabs:{display:"flex",background:"#fff",borderBottom:"2px solid #e8f3ec",padding:"0 4px"},
  tab:{flex:1,padding:"14px 4px",border:"none",background:"transparent",cursor:"pointer",color:"#888",fontSize:14,fontWeight:600},
  tabActive:{flex:1,padding:"14px 4px",border:"none",borderBottom:"3px solid #2d6a4f",background:"transparent",cursor:"pointer",color:"#2d6a4f",fontSize:14,fontWeight:700,marginBottom:-2},
  btnPrimary:{width:"100%",padding:"15px",background:"#2d6a4f",color:"#fff",border:"none",borderRadius:12,fontSize:16,fontWeight:700,cursor:"pointer",marginBottom:8,boxShadow:"0 4px 12px rgba(45,106,79,0.25)"},
  btnSecondary:{width:"100%",padding:"13px",background:"#fff",color:"#2d6a4f",border:"2px solid #b7dcc1",borderRadius:12,fontSize:15,fontWeight:600,cursor:"pointer"},
  btnAdd:{background:"#fff",border:"2px dashed #b7dcc1",color:"#2d6a4f",padding:"10px 12px",borderRadius:10,cursor:"pointer",fontSize:14,fontWeight:600,marginBottom:8,width:"100%"},
  btnAddFam:{background:"#e8f3ec",border:"1px solid #b7dcc1",color:"#2d6a4f",padding:"10px 12px",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:600,width:"100%"},
  btnRemove:{background:"#fce8e8",color:"#c1121f",border:"none",borderRadius:8,padding:"0 10px",cursor:"pointer",fontSize:14,height:46,fontWeight:700},
  btnDel:{background:"none",border:"none",cursor:"pointer",fontSize:18,padding:"0 6px",color:"#ccc"},
  input:{width:"100%",padding:"13px 14px",border:"2px solid #d8e8de",borderRadius:12,fontSize:16,marginBottom:14,boxSizing:"border-box",outline:"none",background:"#fff",color:"#1b4332"},
  label:{display:"block",fontSize:14,fontWeight:700,color:"#1b4332",marginBottom:6},
  miniLabel:{fontSize:12,color:"#52796f",fontWeight:600,paddingBottom:4},
  helpText:{fontSize:13,color:"#52796f",margin:"-4px 0 12px"},
  err:{color:"#c1121f",fontSize:14,margin:"0 0 10px",fontWeight:500},
  back:{background:"none",border:"none",color:"#2d6a4f",cursor:"pointer",fontSize:15,padding:"4px 0",fontWeight:600},
  listLabel:{color:"#52796f",fontSize:13,marginBottom:10,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5},
  tripRow:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 14px",background:"#f1f8f4",borderRadius:12,marginBottom:8,cursor:"pointer",border:"1px solid #d8e8de"},
  tripName:{fontWeight:700,color:"#1b4332",fontSize:15,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},
  tripMeta:{color:"#52796f",fontSize:13,marginTop:3},
  expCard:{display:"flex",alignItems:"center",gap:8,background:"#fff",borderRadius:14,padding:"16px",marginBottom:10,boxShadow:"0 2px 8px rgba(45,106,79,0.08)"},
  expDesc:{fontWeight:700,color:"#1b4332",fontSize:15},
  expWho:{fontSize:13,color:"#666",marginTop:3},
  expAmount:{fontWeight:800,color:"#2d6a4f",fontSize:17},
  expEdit:{fontSize:10,color:"#aaa",marginTop:2},
  fab:{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#2d6a4f",color:"#fff",border:"none",borderRadius:50,padding:"16px 32px",fontSize:16,fontWeight:700,cursor:"pointer",boxShadow:"0 6px 20px rgba(45,106,79,0.4)",whiteSpace:"nowrap"},
  overlay:{position:"fixed",inset:0,background:"rgba(27,67,50,0.5)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100},
  modal:{background:"#fff",borderRadius:"24px 24px 0 0",padding:"28px 24px",width:"100%",maxWidth:480},
  section:{background:"#fff",borderRadius:14,padding:"18px",marginBottom:12,boxShadow:"0 2px 8px rgba(45,106,79,0.08)"},
  sectionTitle:{margin:"0 0 14px",fontSize:15,fontWeight:800,color:"#1b4332"},
  debtRow:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0",borderBottom:"1px solid #f1f8f4",gap:8,flexWrap:"wrap"},
  debtFrom:{fontWeight:700,color:"#c1121f",fontSize:15},
  debtArrow:{color:"#aaa",fontSize:18},
  debtTo:{fontWeight:700,color:"#2d6a4f",fontSize:15},
  debtAmount:{fontWeight:800,color:"#1b4332",fontSize:16},
  sameFamTag:{background:"#e8f3ec",color:"#2d6a4f",fontSize:10,padding:"3px 7px",borderRadius:6,fontWeight:600},
  personCard:{background:"#f1f8f4",borderRadius:12,padding:"14px",marginBottom:10,border:"1px solid #d8e8de"},
  personName:{fontWeight:700,color:"#1b4332",fontSize:16},
  personDays:{fontSize:13,color:"#52796f",fontWeight:600},
  personRow:{display:"flex",justifyContent:"space-between",fontSize:14,padding:"4px 0"},
  configRow:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0",borderBottom:"1px solid #f1f8f4"},
  empty:{textAlign:"center",color:"#52796f",padding:"50px 20px",fontSize:14,background:"#fff",borderRadius:14,boxShadow:"0 2px 8px rgba(45,106,79,0.08)"},
  btnSmall:{background:"#e8f3ec",color:"#2d6a4f",border:"none",borderRadius:10,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:"pointer"},
  btnDanger:{width:"100%",padding:"13px",background:"#fce8e8",color:"#c1121f",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"},
  btnDelHome:{background:"none",border:"none",cursor:"pointer",fontSize:18,padding:"8px",color:"#ccc",borderRadius:6,marginLeft:8},
  familyCard:{background:"#f1f8f4",borderRadius:12,padding:"14px",marginBottom:10,border:"1px solid #d8e8de"},
  familyName:{fontWeight:700,color:"#1b4332",fontSize:15},
  memberTag:{background:"#fff",color:"#1b4332",fontSize:13,padding:"4px 10px",borderRadius:14,border:"1px solid #d8e8de",fontWeight:500},
  suggestions:{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:"2px solid #b7dcc1",borderRadius:12,marginTop:-12,maxHeight:240,overflowY:"auto",zIndex:20,boxShadow:"0 4px 16px rgba(45,106,79,0.15)"},
  suggestionItem:{padding:"10px 12px",cursor:"pointer",borderBottom:"1px solid #f1f8f4",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8},
  suggestionFam:{fontSize:11,color:"#52796f",fontWeight:600},
  familyPickRow:{width:"100%",background:"#f1f8f4",border:"1px solid #d8e8de",borderRadius:10,padding:"12px 14px",marginBottom:8,cursor:"pointer",textAlign:"left"},
};
