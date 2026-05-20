import { useState, useEffect } from "react";

const STORAGE_KEY = "travel-split-v2";

function genId() { return Math.random().toString(36).slice(2, 10).toUpperCase(); }
function fmt(n) { return "$" + Math.round(n).toLocaleString("es-CO") + " COP"; }

async function loadTrips() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch { return {}; }
}
async function saveTrips(trips) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trips)); }
  catch (e) { console.error("Error guardando:", e); }
}

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

  const debts = [];
  const pos = Object.entries(balance).filter(([,v]) => v > 0.5).map(([k,v]) => ({name:k,val:v}));
  const neg = Object.entries(balance).filter(([,v]) => v < -0.5).map(([k,v]) => ({name:k,val:-v}));
  let i=0, j=0;
  while (i < pos.length && j < neg.length) {
    const amt = Math.min(pos[i].val, neg[j].val);
    debts.push({ from: neg[j].name, to: pos[i].name, amount: amt });
    pos[i].val -= amt; neg[j].val -= amt;
    if (pos[i].val < 0.5) i++;
    if (neg[j].val < 0.5) j++;
  }

  return { perDayPerPerson, shouldPay, paid, balance, debts };
}

function HomeScreen({ onOpen, onCreate }) {
  const [trips, setTrips] = useState(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { loadTrips().then(setTrips); }, []);

  function handleJoin() {
    const c = code.trim().toUpperCase();
    if (trips && trips[c]) onOpen(c);
    else setErr("No se encontró ningún viaje con ese código.");
  }

  async function handleDelete(e, tripId, tripName) {
    e.stopPropagation();
    if (!window.confirm(`¿Eliminar el viaje "${tripName}"? Esta acción no se puede deshacer.`)) return;
    const all = await loadTrips();
    delete all[tripId];
    await saveTrips(all);
    setTrips({...all});
  }

  return (
    <div style={s.center}>
      <div style={s.card}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:52}}>🧳</div>
          <h1 style={{margin:"8px 0 4px",color:"#1a1a2e",fontSize:26}}>Travel Split</h1>
          <p style={{color:"#888",margin:0,fontSize:14}}>Divide los gastos del viaje fácilmente</p>
        </div>
        <button style={s.btnPrimary} onClick={onCreate}>+ Crear nuevo viaje</button>
        <div style={s.divider}><span style={{background:"#fff",padding:"0 10px",color:"#aaa",fontSize:13}}>o entra con un código</span></div>
        <input style={s.input} placeholder="Código del viaje" value={code}
          onChange={e=>{setCode(e.target.value.toUpperCase());setErr("");}}
          onKeyDown={e=>e.key==="Enter"&&handleJoin()}
        />
        {err && <p style={s.err}>{err}</p>}
        <button style={s.btnSecondary} onClick={handleJoin}>Entrar al viaje</button>
        {trips && Object.keys(trips).length > 0 && (
          <div style={{marginTop:24}}>
            <p style={{color:"#aaa",fontSize:12,marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>Viajes recientes</p>
            {Object.values(trips).sort((a,b)=>b.createdAt-a.createdAt).map(t => (
              <div key={t.id} style={s.tripRow} onClick={()=>onOpen(t.id)}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>🏕 {t.name}</div>
                  <div style={{color:"#aaa",fontSize:11,fontFamily:"monospace",marginTop:2}}>{t.id}</div>
                </div>
                <button style={s.btnDelHome} onClick={(e)=>handleDelete(e, t.id, t.name)} title="Eliminar viaje">🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateScreen({ onBack, onCreated }) {
  const [name, setName] = useState("");
  const [participants, setParticipants] = useState([{name:"",days:""}]);
  const [err, setErr] = useState("");

  function addP() { setParticipants([...participants,{name:"",days:""}]); }
  function updateP(i,field,val) { const p=[...participants]; p[i]={...p[i],[field]:val}; setParticipants(p); }
  function removeP(i) { setParticipants(participants.filter((_,j)=>j!==i)); }

  async function handleCreate() {
    if (!name.trim()) return setErr("Ponle un nombre al viaje.");
    const valid = participants.filter(p=>p.name.trim()&&+p.days>0);
    if (valid.length < 2) return setErr("Agrega al menos 2 participantes con sus días.");
    const dup = valid.map(p=>p.name.trim().toLowerCase());
    if (new Set(dup).size !== dup.length) return setErr("Hay nombres repetidos.");
    const trip = {
      id: genId(),
      name: name.trim(),
      participants: valid.map(p=>({name:p.name.trim(), days:+p.days})),
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
      <div style={s.card}>
        <button style={s.back} onClick={onBack}>← Volver</button>
        <h2 style={{...s.title,marginTop:8}}>Nuevo viaje 🏕</h2>
        <label style={s.label}>Nombre del viaje</label>
        <input style={s.input} placeholder="Ej: Finca El Peñol" value={name} onChange={e=>setName(e.target.value)} />
        <label style={s.label}>Participantes y días que estuvieron</label>
        <div style={{display:"grid",gridTemplateColumns:"1fr 80px 32px",gap:"0 8px",marginBottom:4}}>
          <span style={{fontSize:12,color:"#aaa",paddingBottom:4}}>Nombre</span>
          <span style={{fontSize:12,color:"#aaa",paddingBottom:4}}>Días</span>
          <span/>
        </div>
        {participants.map((p,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 80px 32px",gap:"0 8px",marginBottom:8}}>
            <input style={{...s.input,margin:0}} placeholder={`Persona ${i+1}`} value={p.name} onChange={e=>updateP(i,"name",e.target.value)} />
            <input style={{...s.input,margin:0}} type="number" min="1" placeholder="0" value={p.days} onChange={e=>updateP(i,"days",e.target.value)} />
            {participants.length>1
              ? <button style={s.btnRemove} onClick={()=>removeP(i)}>✕</button>
              : <span/>}
          </div>
        ))}
        <button style={s.btnAdd} onClick={addP}>+ Agregar persona</button>
        {err && <p style={s.err}>{err}</p>}
        <button style={{...s.btnPrimary,marginTop:12}} onClick={handleCreate}>Crear viaje</button>
      </div>
    </div>
  );
}

function TripScreen({ tripId, onBack }) {
  const [trip, setTrip] = useState(null);
  const [view, setView] = useState("gastos");
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editingParticipants, setEditingParticipants] = useState(false);
  const [copied, setCopied] = useState(false);

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
    if (!window.confirm("¿Eliminar este gasto?")) return;
    const trips = await loadTrips();
    trips[tripId].expenses.splice(idx,1);
    await saveTrips(trips);
    setTrip({...trips[tripId]});
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
    if (!window.confirm("¿Eliminar este viaje permanentemente? Esta acción no se puede deshacer.")) return;
    const trips = await loadTrips();
    delete trips[tripId];
    await saveTrips(trips);
    onBack();
  }

  function copyCode() {
    navigator.clipboard.writeText(tripId);
    setCopied(true); setTimeout(()=>setCopied(false),2000);
  }

  if (!trip) return <div style={s.center}><p>Cargando...</p></div>;

  const { perDayPerPerson, shouldPay, paid, balance, debts } = calcDebts(trip);
  const totalSpent = trip.expenses.reduce((a,e)=>a+e.amount,0);
  const totalDays = trip.participants.reduce((a,p)=>a+p.days,0);

  return (
    <div style={{minHeight:"100vh",background:"#f5f6fa"}}>
      <div style={s.header}>
        <button style={s.back} onClick={onBack}>← Inicio</button>
        <div style={{flex:1,textAlign:"center"}}>
          <div style={{fontWeight:700,color:"#1a1a2e",fontSize:16}}>{trip.name}</div>
          <div style={{fontSize:11,color:"#888"}}>{trip.participants.length} personas · {totalDays} días en total</div>
        </div>
        <button style={s.codeBtn} onClick={copyCode}>{copied?"✓ Copiado":`# ${tripId}`}</button>
      </div>

      <div style={s.stats}>
        <div style={s.stat}><div style={s.statVal}>{fmt(totalSpent)}</div><div style={s.statLbl}>Total gastado</div></div>
        <div style={s.stat}><div style={s.statVal}>{fmt(perDayPerPerson)}</div><div style={s.statLbl}>Por persona/día</div></div>
      </div>

      <div style={s.tabs}>
        <button style={view==="gastos"?s.tabActive:s.tab} onClick={()=>setView("gastos")}>Gastos</button>
        <button style={view==="resumen"?s.tabActive:s.tab} onClick={()=>setView("resumen")}>Resumen</button>
        <button style={view==="config"?s.tabActive:s.tab} onClick={()=>setView("config")}>Personas</button>
      </div>

      <div style={{padding:"12px 16px 100px"}}>
        {view==="gastos" && (
          <>
            {trip.expenses.length===0 && <div style={s.empty}>Aún no hay gastos. ¡Agrega el primero!</div>}
            {trip.expenses.map((exp,idx)=>(
              <div key={idx} style={s.expCard}>
                <div style={{flex:1,cursor:"pointer"}} onClick={()=>setEditingExpense(idx)}>
                  <div style={{fontWeight:600,color:"#1a1a2e"}}>{exp.description}</div>
                  <div style={{fontSize:12,color:"#888",marginTop:2}}>Pagó: <b>{exp.paidBy}</b></div>
                </div>
                <div style={{textAlign:"right",marginRight:8,cursor:"pointer"}} onClick={()=>setEditingExpense(idx)}>
                  <div style={{fontWeight:700,color:"#4f46e5",fontSize:15}}>{fmt(exp.amount)}</div>
                  <div style={{fontSize:10,color:"#aaa"}}>Tocar para editar</div>
                </div>
                <button style={s.btnDel} onClick={()=>deleteExpense(idx)}>🗑</button>
              </div>
            ))}
          </>
        )}

        {view==="resumen" && (
          <>
            <div style={s.section}>
              <h3 style={s.sectionTitle}>💸 Transferencias para saldar</h3>
              {debts.length===0
                ? <p style={{color:"#16a34a",fontSize:14,margin:0}}>¡Todo está saldado! 🎉</p>
                : debts.map((d,i)=>(
                  <div key={i} style={s.debtRow}>
                    <div>
                      <span style={{fontWeight:700,color:"#dc2626"}}>{d.from}</span>
                      <span style={{color:"#aaa",margin:"0 6px"}}>→</span>
                      <span style={{fontWeight:700,color:"#16a34a"}}>{d.to}</span>
                    </div>
                    <span style={{fontWeight:700,color:"#1a1a2e",fontSize:15}}>{fmt(d.amount)}</span>
                  </div>
                ))
              }
            </div>

            <div style={s.section}>
              <h3 style={s.sectionTitle}>👤 Detalle por persona</h3>
              {trip.participants.map(p=>(
                <div key={p.name} style={s.personCard}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontWeight:700,color:"#1a1a2e"}}>{p.name}</span>
                    <span style={{fontSize:12,color:"#888"}}>{p.days} días</span>
                  </div>
                  <div style={s.personRow}>
                    <span style={{color:"#888"}}>Debe pagar</span>
                    <span style={{fontWeight:600}}>{fmt(shouldPay[p.name]||0)}</span>
                  </div>
                  <div style={s.personRow}>
                    <span style={{color:"#888"}}>Ya pagó</span>
                    <span style={{fontWeight:600,color:"#4f46e5"}}>{fmt(paid[p.name]||0)}</span>
                  </div>
                  <div style={{...s.personRow,borderTop:"1px solid #f0f0f0",paddingTop:6,marginTop:4}}>
                    <span style={{fontWeight:600}}>Balance</span>
                    <span style={{fontWeight:700, color: (balance[p.name]||0)>=0?"#16a34a":"#dc2626"}}>
                      {(balance[p.name]||0)>=0 ? `+${fmt(balance[p.name]||0)}` : `-${fmt(Math.abs(balance[p.name]||0))}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{...s.section,background:"#f0f0ff",border:"1px solid #c7d2fe"}}>
              <h3 style={{...s.sectionTitle,color:"#4f46e5"}}>🧮 Cómo se calculó</h3>
              <p style={{fontSize:13,color:"#555",margin:0,lineHeight:1.6}}>
                Total gastado: <b>{fmt(totalSpent)}</b><br/>
                Total días (suma de todos): <b>{totalDays} días</b><br/>
                Valor por persona/día: <b>{fmt(perDayPerPerson)}</b><br/>
                Cada persona paga ese valor multiplicado por los días que estuvo.
              </p>
            </div>
          </>
        )}

        {view==="config" && (
          <>
            <div style={s.section}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <h3 style={{...s.sectionTitle,margin:0}}>👥 Participantes</h3>
                <button style={s.btnSmall} onClick={()=>setEditingParticipants(true)}>✏️ Editar</button>
              </div>
              {trip.participants.map(p=>(
                <div key={p.name} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #f0f0f0"}}>
                  <span style={{fontWeight:500,color:"#444"}}>👤 {p.name}</span>
                  <span style={{color:"#888",fontSize:13}}>{p.days} días</span>
                </div>
              ))}
            </div>

            <div style={s.section}>
              <h3 style={s.sectionTitle}>⚠️ Zona peligrosa</h3>
              <button style={s.btnDanger} onClick={deleteTrip}>🗑 Eliminar viaje</button>
            </div>
          </>
        )}
      </div>

      {view==="gastos" && (
        <button style={s.fab} onClick={()=>setShowForm(true)}>+ Agregar gasto</button>
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
    <div style={s.overlay}>
      <div style={s.modal}>
        <h3 style={{margin:"0 0 16px",color:"#1a1a2e"}}>{isEdit ? "Editar gasto ✏️" : "Nuevo gasto 💰"}</h3>
        <label style={s.label}>Descripción</label>
        <input style={s.input} placeholder="Ej: Mercado, gasolina, asado..." value={desc} onChange={e=>setDesc(e.target.value)} />
        <label style={s.label}>Monto (COP)</label>
        <input style={s.input} type="number" min="0" placeholder="0" value={amount} onChange={e=>setAmount(e.target.value)} />
        <label style={s.label}>¿Quién pagó?</label>
        <select style={s.input} value={paidBy} onChange={e=>setPaidBy(e.target.value)}>
          {participants.map(p=><option key={p.name} value={p.name}>{p.name} ({p.days} días)</option>)}
        </select>
        {err && <p style={s.err}>{err}</p>}
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <button style={{...s.btnSecondary,flex:1}} onClick={onClose}>Cancelar</button>
          <button style={{...s.btnPrimary,flex:1,margin:0}} onClick={handleAdd}>{isEdit ? "Guardar" : "Agregar"}</button>
        </div>
      </div>
    </div>
  );
}

function EditParticipantsModal({ participants, onSave, onClose }) {
  const [parts, setParts] = useState(participants.map(p=>({...p, days: p.days.toString()})));
  const [err, setErr] = useState("");

  function update(i, field, val) {
    const p = [...parts]; p[i] = {...p[i], [field]: val}; setParts(p);
  }
  function addP() { setParts([...parts, {name:"", days:""}]); }
  function removeP(i) { setParts(parts.filter((_,j)=>j!==i)); }

  function handleSave() {
    const valid = parts.filter(p => p.name.trim() && +p.days > 0);
    if (valid.length < 2) return setErr("Debe haber al menos 2 personas con sus días.");
    const names = valid.map(p=>p.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return setErr("Hay nombres repetidos.");
    onSave(valid.map(p=>({name:p.name.trim(), days:+p.days})));
  }

  return (
    <div style={s.overlay}>
      <div style={{...s.modal,maxHeight:"85vh",overflowY:"auto"}}>
        <h3 style={{margin:"0 0 8px",color:"#1a1a2e"}}>Editar participantes ✏️</h3>
        <p style={{fontSize:12,color:"#888",marginTop:0,marginBottom:14}}>
          Si eliminas una persona, también se borrarán los gastos que ella pagó.
        </p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 80px 32px",gap:"0 8px",marginBottom:4}}>
          <span style={{fontSize:12,color:"#aaa"}}>Nombre</span>
          <span style={{fontSize:12,color:"#aaa"}}>Días</span>
          <span/>
        </div>
        {parts.map((p,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 80px 32px",gap:"0 8px",marginBottom:8}}>
            <input style={{...s.input,margin:0}} placeholder={`Persona ${i+1}`} value={p.name} onChange={e=>update(i,"name",e.target.value)} />
            <input style={{...s.input,margin:0}} type="number" min="1" placeholder="0" value={p.days} onChange={e=>update(i,"days",e.target.value)} />
            {parts.length>1 ? <button style={s.btnRemove} onClick={()=>removeP(i)}>✕</button> : <span/>}
          </div>
        ))}
        <button style={s.btnAdd} onClick={addP}>+ Agregar persona</button>
        {err && <p style={s.err}>{err}</p>}
        <div style={{display:"flex",gap:8,marginTop:8}}>
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
  if (screen==="home") return <HomeScreen onOpen={id=>{setTripId(id);setScreen("trip");}} onCreate={()=>setScreen("create")} />;
  if (screen==="create") return <CreateScreen onBack={()=>setScreen("home")} onCreated={id=>{setTripId(id);setScreen("trip");}} />;
  return <TripScreen tripId={tripId} onBack={()=>setScreen("home")} />;
}

const s = {
  center:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f5f6fa",padding:16},
  card:{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:440,boxShadow:"0 4px 24px rgba(0,0,0,0.08)"},
  header:{background:"#fff",padding:"12px 16px",display:"flex",alignItems:"center",gap:8,boxShadow:"0 1px 8px rgba(0,0,0,0.07)",position:"sticky",top:0,zIndex:10},
  stats:{display:"flex",background:"#4f46e5",color:"#fff"},
  stat:{flex:1,textAlign:"center",padding:"16px 8px"},
  statVal:{fontSize:15,fontWeight:700},
  statLbl:{fontSize:11,opacity:.8,marginTop:2},
  tabs:{display:"flex",background:"#fff",borderBottom:"2px solid #f0f0f0"},
  tab:{flex:1,padding:"12px",border:"none",background:"transparent",cursor:"pointer",color:"#888",fontSize:14,fontWeight:500},
  tabActive:{flex:1,padding:"12px",border:"none",borderBottom:"2px solid #4f46e5",background:"transparent",cursor:"pointer",color:"#4f46e5",fontSize:14,fontWeight:700,marginBottom:-2},
  btnPrimary:{width:"100%",padding:"13px",background:"#4f46e5",color:"#fff",border:"none",borderRadius:10,fontSize:15,fontWeight:600,cursor:"pointer",marginBottom:8},
  btnSecondary:{width:"100%",padding:"12px",background:"#f5f6fa",color:"#444",border:"1px solid #e5e7eb",borderRadius:10,fontSize:14,fontWeight:500,cursor:"pointer"},
  btnAdd:{background:"none",border:"1px dashed #c7d2fe",color:"#4f46e5",padding:"8px 12px",borderRadius:8,cursor:"pointer",fontSize:13,marginBottom:8,width:"100%"},
  btnRemove:{background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:8,padding:"0 10px",cursor:"pointer",fontSize:14,height:42},
  btnDel:{background:"none",border:"none",cursor:"pointer",fontSize:16,padding:"0 4px",color:"#ddd"},
  input:{width:"100%",padding:"11px 12px",border:"1px solid #e5e7eb",borderRadius:10,fontSize:14,marginBottom:12,boxSizing:"border-box",outline:"none"},
  label:{display:"block",fontSize:13,fontWeight:600,color:"#444",marginBottom:4},
  divider:{textAlign:"center",color:"#aaa",margin:"16px 0",borderTop:"1px solid #f0f0f0",position:"relative",top:10},
  err:{color:"#dc2626",fontSize:13,margin:"0 0 8px"},
  back:{background:"none",border:"none",color:"#4f46e5",cursor:"pointer",fontSize:14,padding:"4px 0",fontWeight:500},
  codeBtn:{background:"#f0f0ff",border:"none",color:"#4f46e5",borderRadius:8,padding:"6px 10px",fontSize:12,cursor:"pointer",fontWeight:600,whiteSpace:"nowrap"},
  tripRow:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:"#f9fafb",borderRadius:10,marginBottom:8,cursor:"pointer",border:"1px solid #e5e7eb"},
  expCard:{display:"flex",alignItems:"center",gap:8,background:"#fff",borderRadius:12,padding:"14px",marginBottom:10,boxShadow:"0 1px 6px rgba(0,0,0,0.06)"},
  fab:{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#4f46e5",color:"#fff",border:"none",borderRadius:50,padding:"14px 28px",fontSize:15,fontWeight:600,cursor:"pointer",boxShadow:"0 4px 16px rgba(79,70,229,0.4)",whiteSpace:"nowrap"},
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100},
  modal:{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px",width:"100%",maxWidth:480},
  section:{background:"#fff",borderRadius:12,padding:"16px",marginBottom:12,boxShadow:"0 1px 6px rgba(0,0,0,0.05)"},
  sectionTitle:{margin:"0 0 12px",fontSize:14,fontWeight:700,color:"#1a1a2e"},
  debtRow:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #f5f5f5"},
  personCard:{background:"#f9fafb",borderRadius:10,padding:"12px",marginBottom:10,border:"1px solid #f0f0f0"},
  personRow:{display:"flex",justifyContent:"space-between",fontSize:13,padding:"3px 0"},
  empty:{textAlign:"center",color:"#aaa",padding:"40px 0",fontSize:14},
  title:{margin:"0 0 16px",color:"#1a1a2e",fontSize:20},
  btnSmall:{background:"#f0f0ff",color:"#4f46e5",border:"none",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer"},
  btnDanger:{width:"100%",padding:"12px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:10,fontSize:14,fontWeight:600,cursor:"pointer"},
  btnDelHome:{background:"none",border:"none",cursor:"pointer",fontSize:16,padding:"6px 8px",color:"#ccc",borderRadius:6,marginLeft:8},
};
